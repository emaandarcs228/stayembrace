// =====================================================================
// services/attendanceActions.js
//
// Shared Attendance mutation logic — called by BOTH
// controllers/wardenController.js and controllers/operationController.js.
//
// Mirrors services/leaveActions.js: the state-change + notification logic
// lives here once, so warden and admin behavior can never silently drift
// apart. Each controller just wraps these with its own res.redirect(...).
//
// DISPUTE CONVENTION (unchanged, still lives in `notes`):
//   '[DISPUTE] <reason>'              → dispute open, awaiting review
//   'Corrected by warden...'          → dispute accepted, status corrected
//   'Dispute rejected: <reason>'      → dispute rejected
// This file does not touch that convention — studentController.js and both
// EJS views already depend on it. What it adds is reliable timestamps
// (disputeRaisedAt / resolvedAt) and a resolver identity (resolvedBy) that
// the notes convention can't express on its own.
//
// "Override" semantics for resolveDispute: unlike leave, attendance has no
// third party (no guardian) that can be "unreachable" — so there's no
// event-driven escalation case here, only the time-based one (handled by
// jobs/attendanceEscalationJob.js). The real admin-specific case is
// different: once a warden resolves a dispute, the student currently has
// no way to reopen it if they still disagree. So resolveDispute is written
// to allow acting on a dispute REGARDLESS of its current resolution state
// — if admin corrects a warden's earlier decision, the warden gets
// notified, same shape as leaveActions.notifyOverriddenActor.
// =====================================================================

const Attendance   = require('../models/attendance');
const Student       = require('../models/student');
const Notification  = require('../models/notification');

const DISPUTE_PREFIX = '[DISPUTE]';

function isDisputeOpen(notes) {
    return !!(notes && notes.startsWith(DISPUTE_PREFIX));
}

async function notifyStudent(record, actingUser, { title, message, priority }) {
    try {
        const recipientId = record.student?.user?._id;
        if (!recipientId) return;
        await Notification.create({
            title,
            message,
            recipient: recipientId,
            category : 'Requests',
            relatedTo: { model: 'Attendance', docId: record._id },
            createdBy: actingUser._id,
            priority : priority || 'Medium'
        });
    } catch (err) {
        console.error('notifyStudent (attendanceActions):', err);
    }
}

async function notifyOverriddenActor(record, actingUser, previousResolvedBy, resultLabel) {
    if (!previousResolvedBy) return;
    if (previousResolvedBy.toString() === actingUser._id.toString()) return; // same person re-acting
    try {
        await Notification.create({
            title    : 'Attendance Dispute Decision Overridden by Admin',
            message  : `An attendance dispute you previously resolved was reviewed again and ${resultLabel} by admin.`,
            recipient: previousResolvedBy,
            category : 'Requests',
            relatedTo: { model: 'Attendance', docId: record._id },
            createdBy: actingUser._id,
            priority : 'Medium'
        });
    } catch (err) {
        console.error('notifyOverriddenActor (attendanceActions):', err);
    }
}

// ═══════════════════════════════════════════════════════════════════
// Mark attendance (create today's record, or edit an existing one)
//
// FIX vs old wardenController.markAttendance: refuses to change status
// on a record that currently has an open dispute. Previously, editing
// status from e.g. the Today's Log inline form (which sends no `notes`)
// silently kept the stale "[DISPUTE] ..." note forever, and the student
// never got a proper dispute-resolution notification — just a generic
// "Attendance Marked" one. Open disputes must now go through
// resolveDispute instead.
// ═══════════════════════════════════════════════════════════════════
exports.markAttendance = async function (actingUser, { studentId, status, notes, entryTime, exitTime }) {
    // Updated to allow 'Leave' status for admin emergency marking
    if (!studentId || !['In', 'Out', 'Late', 'Missed', 'Leave'].includes(status)) {
        return { ok: false, error: 'Invalid attendance data.' };
    }

    const today      = new Date();
    const todayStart = new Date(today); todayStart.setHours(0, 0, 0, 0);
    const todayEnd   = new Date(today); todayEnd.setHours(23, 59, 59, 999);

    const existing = await Attendance.findOne({
        student: studentId,
        date   : { $gte: todayStart, $lte: todayEnd }
    });

    if (existing && isDisputeOpen(existing.notes)) {
        return {
            ok   : false,
            error: 'This record has an open dispute — resolve it from the Disputes tab before re-marking.'
        };
    }

    let record;
    if (existing) {
        existing.status     = status;
        existing.recordedBy = actingUser._id;
        existing.notes      = notes || existing.notes;
        // Update times if provided, else set based on status
        if (entryTime) existing.entryTime = new Date(entryTime);
        else if (status === 'In' || status === 'Late') existing.entryTime = new Date();
        else if (status === 'Leave') existing.entryTime = null;
        if (exitTime) existing.exitTime = new Date(exitTime);
        else if (status === 'Out') existing.exitTime = new Date();
        else if (status === 'Leave') existing.exitTime = null;

        // If we're manually updating a record that might have had a stale dispute flag,
        // we clear it for safety (the check above ensures no open dispute, so it's safe)
        existing.isDisputed = false;

        record = await existing.save();
    } else {
        let newEntryTime = null, newExitTime = null;
        if (entryTime) newEntryTime = new Date(entryTime);
        else if (status === 'In' || status === 'Late') newEntryTime = new Date();
        if (exitTime) newExitTime = new Date(exitTime);
        else if (status === 'Out') newExitTime = new Date();
        // For 'Leave', both remain null

        record = await Attendance.create({
            student   : studentId,
            date      : new Date(),
            status,
            entryTime : newEntryTime,
            exitTime  : newExitTime,
            recordedBy: actingUser._id,
            notes     : notes || null,
            isDisputed: false   // new record starts without dispute
        });
    }

    try {
        const studentDoc = await Student.findById(studentId).populate('user', '_id').lean();
        if (studentDoc && studentDoc.user) {
            const statusLabels = {
                'In'     : '✅ Present (In)',
                'Late'   : '⏰ Late',
                'Out'    : '🚪 Checked Out',
                'Missed' : '❌ Missed',
                'Leave'  : '📅 On Leave'
            };
            await Notification.create({
                title    : 'Attendance Marked',
                message  : `Your attendance for today has been marked as: ${statusLabels[status] || status}.`,
                recipient: studentDoc.user._id,
                category : 'General',
                createdBy: actingUser._id,
                priority : 'Low'
            });
        }
    } catch (_) {}

    return { ok: true, record };
};

// ═══════════════════════════════════════════════════════════════════
// Resolve a dispute — action: 'correct' | 'reject'
//
// FIX vs old wardenController.resolveDispute: no longer overwrites
// recordedBy (original marker is preserved for audit trail); now sets
// resolvedBy/resolvedAt separately. Also now callable on a dispute
// regardless of whether it was already resolved, so admin can override
// a warden's earlier decision — the warden gets notified when that
// happens, same as leave's override pattern.
// ═══════════════════════════════════════════════════════════════════
exports.resolveDispute = async function (recordId, actingUser, { action, newStatus, reason }) {
    const record = await Attendance.findById(recordId)
        .populate({ path: 'student', populate: { path: 'user', select: '_id fullname' } });

    if (!record) return { ok: false, error: 'Record not found.' };
    if (!record.notes || !/(\[DISPUTE\]|Corrected by warden|Dispute rejected)/.test(record.notes)) {
        return { ok: false, error: 'This record has no dispute to resolve.' };
    }

    const previousResolvedBy = record.resolvedBy || null;
    const wasAlreadyResolved = !isDisputeOpen(record.notes);

    let notifTitle, notifMessage, resultLabel;

    if (action === 'correct' && newStatus) {
        record.status = newStatus;
        record.notes  = 'Corrected by warden after dispute review.';
        notifTitle    = wasAlreadyResolved ? 'Dispute Decision Updated' : 'Dispute Accepted — Attendance Corrected';
        notifMessage  = `Your attendance dispute has been reviewed. Your status has been corrected to: ${newStatus}.`;
        resultLabel   = 'corrected';
    } else if (action === 'reject') {
        record.notes  = 'Dispute rejected: ' + (reason || 'No reason provided.');
        notifTitle    = wasAlreadyResolved ? 'Dispute Decision Updated' : 'Dispute Rejected';
        notifMessage  = `Your attendance dispute was reviewed but rejected. Reason: ${reason || 'No reason provided.'}`;
        resultLabel   = 'rejected';
    } else {
        return { ok: false, error: 'Invalid action.' };
    }

    record.resolvedBy = actingUser._id;
    record.resolvedAt = new Date();
    // recordedBy is deliberately left untouched — preserves who made the
    // original attendance mark, independent of who resolved the dispute.

    // ✨ CLOSE THE DISPUTE FLAG – so the cron job no longer picks it up
    record.isDisputed = false;

    await record.save();

    await notifyStudent(record, actingUser, {
        title   : notifTitle,
        message : notifMessage,
        priority: 'Medium'
    });

    if (wasAlreadyResolved) {
        await notifyOverriddenActor(record, actingUser, previousResolvedBy, resultLabel);
    }

    return { ok: true, record };
};

exports.isDisputeOpen = isDisputeOpen;