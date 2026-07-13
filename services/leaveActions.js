// =====================================================================
// services/leaveActions.js
//
// Shared LeaveRequest mutation logic — called by BOTH
// controllers/wardenController.js and controllers/adminController.js.
//
// WHY THIS EXISTS: warden and admin both need to verify guardians,
// approve, and reject leave requests. Keeping the actual state-change
// + notification logic in one place means the two portals can never
// silently drift apart (e.g. admin's reject forgetting to notify the
// student). Each controller just wraps these with its own
// res.redirect(...) / res.render(...) calls.
//
// "Override" semantics: any of these functions can be called by either
// a warden or an admin. If a leave request was already decided
// (Approved/Rejected) by someone else and a DIFFERENT user calls these
// again, that's treated as an admin override — the original actor gets
// notified. Guardian-verification is required before approval unless
// the caller explicitly passes allowWithoutGuardianVerification: true
// (admin-only — see adminController.js).
// =====================================================================

const LeaveRequest = require('../models/leave');
const Notification  = require('../models/notification');
const User           = require('../models/user');

async function notifyStudent(leave, actingUser, { title, message, priority }) {
    try {
        const recipientId = leave.student?.user?._id;
        if (!recipientId) return;
        await Notification.create({
            title,
            message,
            recipient: recipientId,
            category : 'Requests',
            relatedTo: { model: 'LeaveRequest', docId: leave._id },
            createdBy: actingUser._id,
            priority : priority || 'Medium'
        });
    } catch (err) {
        console.error('notifyStudent (leaveActions):', err);
    }
}

async function notifyOverriddenActor(leave, actingUser, previousApprovedBy, resultLabel) {
    if (!previousApprovedBy) return;
    if (previousApprovedBy.toString() === actingUser._id.toString()) return; // same person re-acting
    try {
        await Notification.create({
            title    : 'Leave Decision Overridden by Admin',
            message  : `A leave request you previously handled was reviewed and ${resultLabel} by admin.`,
            recipient: previousApprovedBy,
            category : 'Requests',
            relatedTo: { model: 'LeaveRequest', docId: leave._id },
            createdBy: actingUser._id,
            priority : 'Medium'
        });
    } catch (err) {
        console.error('notifyOverriddenActor (leaveActions):', err);
    }
}

// ═══════════════════════════════════════════════════════════════════
// Guardian verification
// ═══════════════════════════════════════════════════════════════════
exports.verifyGuardian = async function (leaveId, actingUser, { verificationStatus, notes }) {
    const leave = await LeaveRequest.findById(leaveId)
        .populate({ path: 'student', populate: { path: 'user', select: '_id fullname' } });

    if (!leave) return { ok: false, error: 'Request not found.' };
    if (leave.status !== 'Pending') return { ok: false, error: 'Request already processed.' };

    if (verificationStatus === 'verified') {
        leave.guardianVerified          = true;
        leave.guardianVerifiedAt        = new Date();
        leave.guardianConfirmedBy       = actingUser._id;
        leave.guardianVerificationNotes = notes || 'Guardian confirmed via call.';
        await leave.save();

        await notifyStudent(leave, actingUser, {
            title   : 'Guardian Verified',
            message : `Your guardian has been successfully contacted and verified for your ${leave.leaveType} leave request. Final approval is pending.`,
            priority: 'Medium'
        });

    } else {
        leave.guardianVerified          = false;
        leave.guardianVerificationNotes = 'Contact Attempted — Unreachable. ' + (notes || '');

        // Only escalate to admin if it was a warden who couldn't reach the
        // guardian — no point notifying admin about their own action.
        // Gated by escalationNotifiedAt so this leave doesn't ALSO fire
        // the 24h-timeout job's notification later for the same issue.
        if (actingUser.role !== 'admin' && !leave.escalationNotifiedAt) {
            try {
                const adminUser = await User.findOne({ role: 'admin' }).lean();
                if (adminUser) {
                    await Notification.create({
                        title    : 'Guardian Unreachable — Leave Escalation',
                        message  : 'Warden could not reach guardian for leave request. Manual review required.',
                        recipient: adminUser._id,
                        category : 'Requests',
                        relatedTo: { model: 'LeaveRequest', docId: leave._id },
                        createdBy: actingUser._id,
                        priority : 'High'
                    });
                    leave.escalationNotifiedAt = new Date();
                }
            } catch (_) {}
        }

        await leave.save();

        await notifyStudent(leave, actingUser, {
            title   : 'Guardian Contact Attempted',
            message : `Contact with your guardian could not be confirmed for your ${leave.leaveType} leave request. Your request has been escalated for further review.`,
            priority: 'High'
        });
    }

    return { ok: true, leave };
};

// ═══════════════════════════════════════════════════════════════════
// Approve
// allowWithoutGuardianVerification — admin-only escape hatch. Warden
// callers must never pass true for this.
// ═══════════════════════════════════════════════════════════════════
exports.approveLeave = async function (leaveId, actingUser, { note, allowWithoutGuardianVerification = false }) {
    const leave = await LeaveRequest.findById(leaveId)
        .populate({ path: 'student', populate: { path: 'user', select: '_id fullname' } });

    if (!leave) return { ok: false, error: 'Request not found.' };
    if (!leave.guardianVerified && !allowWithoutGuardianVerification) {
        return { ok: false, error: 'Guardian must be verified first.' };
    }

    const previousApprovedBy = leave.approvedBy || null;
    const wasAlreadyDecided  = leave.status === 'Approved' || leave.status === 'Rejected';

    leave.status          = 'Approved';
    leave.approvedBy      = actingUser._id;
    leave.approvedAt      = new Date();
    leave.rejectionReason = null;
    leave.remarks         = note || null;
    await leave.save();

    const fromStr = new Date(leave.fromDate).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' });
    const toStr   = new Date(leave.toDate).toLocaleDateString('en-PK',   { day: '2-digit', month: 'short', year: 'numeric' });

    await notifyStudent(leave, actingUser, {
        title   : wasAlreadyDecided ? 'Leave Request Approved (Updated) ✅' : 'Leave Request Approved ✅',
        message : `Your ${leave.leaveType} leave from ${fromStr} to ${toStr} has been approved.` + (note ? ` Note: ${note}` : ''),
        priority: 'High'
    });

    if (wasAlreadyDecided) {
        await notifyOverriddenActor(leave, actingUser, previousApprovedBy, 'approved');
    }

    return { ok: true, leave };
};

// ═══════════════════════════════════════════════════════════════════
// Reject
// ═══════════════════════════════════════════════════════════════════
exports.rejectLeave = async function (leaveId, actingUser, { reason }) {
    const leave = await LeaveRequest.findById(leaveId)
        .populate({ path: 'student', populate: { path: 'user', select: '_id fullname' } });

    if (!leave) return { ok: false, error: 'Request not found.' };

    const previousApprovedBy = leave.approvedBy || null;
    const wasAlreadyDecided  = leave.status === 'Approved' || leave.status === 'Rejected';

    leave.status          = 'Rejected';
    leave.rejectionReason = reason || 'No reason provided.';
    leave.approvedBy      = actingUser._id;
    leave.approvedAt      = new Date();
    await leave.save();

    await notifyStudent(leave, actingUser, {
        title   : wasAlreadyDecided ? 'Leave Request Rejected (Updated)' : 'Leave Request Rejected',
        message : `Your ${leave.leaveType} leave request has been rejected. Reason: ${leave.rejectionReason}`,
        priority: 'Medium'
    });

    if (wasAlreadyDecided) {
        await notifyOverriddenActor(leave, actingUser, previousApprovedBy, 'rejected');
    }

    return { ok: true, leave };
};