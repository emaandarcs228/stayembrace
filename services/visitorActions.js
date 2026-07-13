// =====================================================================
// services/visitorActions.js
//
// Warden's approve/reject logic for VisitorRequest, plus the student's
// own cancel action. Simple, single-step flow — no guardian-verification-
// style escalation, no admin step.
//
// approveVisitorRequest / rejectVisitorRequest are called by wardenController.js.
// cancelVisitorRequest is called by studentController.js.
// =====================================================================

const VisitorRequest = require('../models/visitorRequest');
const Student         = require('../models/student');
const Notification    = require('../models/notification');
const GuestRoomBooking = require('../models/guestRoomBooking');

async function notifyStudent(vr, actingUserId, { title, message, priority }) {
    try {
        const student = await Student.findById(vr.student).populate('user', '_id');
        if (!student || !student.user) return;
        await Notification.create({
            title,
            message,
            recipient: student.user._id,
            category : 'Requests',
            relatedTo: { model: 'VisitorRequest', docId: vr._id },
            createdBy: actingUserId,
            priority : priority || 'Medium'
        });
    } catch (err) {
        console.error('notifyStudent (visitorActions):', err);
    }
}

exports.approveVisitorRequest = async function (id, wardenUser, { note }) {
    const vr = await VisitorRequest.findById(id);
    if (!vr) return { ok: false, error: 'Visitor request not found.' };
    if (vr.status !== 'Pending') return { ok: false, error: 'This request has already been decided.' };

    vr.status         = 'Approved';
    vr.wardenDecision  = { note: note || '', by: wardenUser._id, at: new Date() };
    await vr.save();

    await notifyStudent(vr, wardenUser._id, {
        title   : 'Visitor Request Approved',
        message : `Your visitor request for ${vr.visitorName} on ${new Date(vr.visitDate).toLocaleDateString('en-PK', { day:'2-digit', month:'short', year:'numeric' })} has been approved.`,
        priority: 'High'
    });

    return { ok: true, request: vr };
};

exports.rejectVisitorRequest = async function (id, wardenUser, { reason }) {
    const vr = await VisitorRequest.findById(id);
    if (!vr) return { ok: false, error: 'Visitor request not found.' };
    if (vr.status !== 'Pending') return { ok: false, error: 'This request has already been decided.' };

    vr.status        = 'Rejected';
    vr.wardenDecision = { note: reason || '', by: wardenUser._id, at: new Date() };
    await vr.save();

    await notifyStudent(vr, wardenUser._id, {
        title   : 'Visitor Request Rejected',
        message : `Your visitor request for ${vr.visitorName} has been rejected. Reason: ${reason || 'No reason provided.'}`,
        priority: 'Medium'
    });

    return { ok: true, request: vr };
};

// Student-initiated cancel — only allowed while still Pending (once a
// warden has decided, the record is historical and shouldn't move).
// studentId is passed in for ownership verification so one student
// can't cancel another's request via a guessed/tampered ID.
exports.cancelVisitorRequest = async function (id, studentId) {
    const vr = await VisitorRequest.findById(id);
    if (!vr) return { ok: false, error: 'Visitor request not found.' };
    if (String(vr.student) !== String(studentId)) {
        return { ok: false, error: 'You are not authorized to cancel this request.' };
    }
    if (vr.status !== 'Pending') {
        return { ok: false, error: 'Only pending requests can be cancelled.' };
    }

    vr.status = 'Cancelled';
    await vr.save();

    return { ok: true, request: vr };
};

// ── add near the top of visitorActions.js ──


// ── append to visitorActions.js ──

// Admin-only supervisory override. Unlike approve/rejectVisitorRequest
// (warden, Pending-only), this can flip an ALREADY-decided request —
// e.g. warden Approved, admin later decides to Reject it (or vice
// versa). Mirrors leaveActions.approveLeave's allowWithoutGuardianVerification
// pattern: same state-machine, admin just gets a wider door.
exports.adminOverrideDecision = async function (id, adminUser, { newStatus, note }) {
    const vr = await VisitorRequest.findById(id);
    if (!vr) return { ok: false, error: 'Visitor request not found.' };
    if (!['Approved', 'Rejected'].includes(newStatus)) {
        return { ok: false, error: 'Invalid status.' };
    }
    if (vr.status === 'Cancelled') {
        return { ok: false, error: 'Cannot override a cancelled request — the student withdrew it.' };
    }
    if (vr.status === newStatus) {
        return { ok: false, error: `Request is already ${newStatus}.` };
    }

    const previousStatus = vr.status;
    vr.status         = newStatus;
    vr.wardenDecision = {
        note: note || `Overridden by admin (was ${previousStatus})`,
        by  : adminUser._id,
        at  : new Date()
    };
    await vr.save();

    // ── Cascade: overriding an Approved request to Rejected auto-cancels
    // any live GuestRoomBooking tied to it — a visitor who's no longer
    // approved can't still have a room reserved (per your earlier design
    // decision: auto-cancel, don't leave it for admin to notice later).
    let cancelledBooking = null;
    if (newStatus === 'Rejected') {
        const booking = await GuestRoomBooking.findOne({
            visitorRequest: vr._id,
            status: { $in: ['Pending', 'Approved'] }
        });
        if (booking) {
            booking.status        = 'Cancelled';
            booking.adminDecision = {
                note: 'Auto-cancelled: linked visitor request was rejected by admin override.',
                by  : adminUser._id,
                at  : new Date()
            };
            await booking.save();
            cancelledBooking = booking;

            try {
                const student = await Student.findById(vr.student).populate('user', '_id');
                if (student && student.user) {
                    await Notification.create({
                        title    : 'Guest Room Booking Cancelled',
                        message  : `Your guest room booking was automatically cancelled because the visitor request for ${vr.visitorName} was rejected.`,
                        recipient: student.user._id,
                        category : 'Requests',
                        relatedTo: { model: 'GuestRoomBooking', docId: booking._id },
                        createdBy: adminUser._id,
                        priority : 'High'
                    });
                }
            } catch (err) {
                console.error('Guest booking cascade-cancel notify error:', err);
            }
        }
    }

    await notifyStudent(vr, adminUser._id, {
        title  : `Visitor Request ${newStatus} (Admin Override)`,
        message: newStatus === 'Approved'
            ? `Your visitor request for ${vr.visitorName} has been approved by admin, overriding the warden's earlier decision.`
            : `Your visitor request for ${vr.visitorName} has been rejected by admin.${note ? ' Reason: ' + note : ''}`,
        priority: 'High'
    });

    return { ok: true, request: vr, cancelledBooking, previousStatus };
};