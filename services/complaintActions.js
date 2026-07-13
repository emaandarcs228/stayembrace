// =====================================================================
// services/complaintActions.js
//
// Shared Complaint mutation logic — called by BOTH
// controllers/wardenController.js and controllers/operationController.js.
//
// Wardens handle every category except Ragging/Harassment, which is
// admin-only end to end (wardens never see these in their queue —
// filtered out at the query level in wardenController.getComplaints).
// Admin additionally has oversight + override on everything else a
// warden has already acted on, using the exact same status-update path
// so behavior can never silently drift between the two portals.
//
// "Override" semantics mirror leaveActions.js: if a complaint was
// already handled (Acknowledged/In Progress/Resolved) by someone else
// and a different actor calls this again, that's an override — the
// original handler gets notified.
// =====================================================================

const Complaint    = require('../models/complaint');
const Notification = require('../models/notification');

const VALID_STATUSES = ['Submitted', 'Acknowledged', 'In Progress', 'Resolved'];

async function notifyStudent(complaint, actingUser, { title, message, priority }) {
    try {
        const recipientId = complaint.student?.user?._id;
        if (!recipientId) return;
        await Notification.create({
            title,
            message,
            recipient: recipientId,
            category : 'Requests',
            relatedTo: { model: 'Complaint', docId: complaint._id },
            createdBy: actingUser._id,
            priority : priority || 'Medium'
        });
    } catch (err) {
        console.error('notifyStudent (complaintActions):', err);
    }
}

async function notifyOverriddenActor(complaint, actingUser, previousHandler, newStatus) {
    if (!previousHandler) return;
    if (previousHandler.toString() === actingUser._id.toString()) return; // same person re-acting
    try {
        await Notification.create({
            title    : 'Complaint Decision Overridden by Admin',
            message  : `A complaint you previously handled ("${complaint.subject}") was reviewed and updated to: ${newStatus} by admin.`,
            recipient: previousHandler,
            category : 'Requests',
            relatedTo: { model: 'Complaint', docId: complaint._id },
            createdBy: actingUser._id,
            priority : 'Medium'
        });
    } catch (err) {
        console.error('notifyOverriddenActor (complaintActions):', err);
    }
}

// ═══════════════════════════════════════════════════════════════════
// Update status — covers warden's normal update, admin's harassment
// handling, and admin's override, all through one path.
// ═══════════════════════════════════════════════════════════════════
exports.updateStatus = async function (complaintId, actingUser, { newStatus, note }) {
    if (!VALID_STATUSES.includes(newStatus)) {
        return { ok: false, error: 'Invalid status.' };
    }
    if (!note || !note.trim()) {
        return { ok: false, error: 'A note is required for every status update.' };
    }

    const complaint = await Complaint.findById(complaintId)
        .populate({ path: 'student', populate: { path: 'user', select: '_id fullname' } });

    if (!complaint) return { ok: false, error: 'Complaint not found.' };

    // Harassment cases are admin-only, end to end — defense in depth on
    // top of the warden query already excluding them.
    if (complaint.category === 'Ragging/Harassment' && actingUser.role !== 'admin') {
        return { ok: false, error: 'Only admin can handle Ragging/Harassment complaints.' };
    }

    const previousHandler   = complaint.handledBy || null;
    const wasAlreadyHandled = complaint.status !== 'Submitted';

    complaint.status        = newStatus;
    complaint.handledBy     = actingUser._id;
    complaint.adminResponse = ((complaint.adminResponse || '') + `\n[${newStatus}] ${note}`).trim();
    if (newStatus === 'Resolved') complaint.resolvedAt = new Date();
    await complaint.save();

    await notifyStudent(complaint, actingUser, {
        title   : wasAlreadyHandled ? `Complaint Update: ${newStatus} (Updated)` : `Complaint Update: ${newStatus}`,
        message : `Your complaint "${complaint.subject}" has been updated to: ${newStatus}. ${note}`,
        priority: complaint.category === 'Ragging/Harassment' ? 'High' : 'Medium'
    });

    if (wasAlreadyHandled) {
        await notifyOverriddenActor(complaint, actingUser, previousHandler, newStatus);
    }

    return { ok: true, complaint };
};