// =====================================================================
// services/mobileLoadActions.js
//
// Shared state-change + notification logic for Mobile Load requests,
// used by BOTH wardenController.js and operationController.js — same
// pattern as leaveActions.js / messActions.js / laundryActions.js, so
// warden and admin behavior can never silently drift apart.
//
// Normal flow (warden, and admin without override):
//   Pending -> Payment Done -> Completed
//   Pending/Payment Done -> Rejected
//
// Admin-only escape hatch: adminOverrideStatus() lets admin jump to ANY
// status from ANY current status (the "full supervisor override" —
// mirrors the allowOverride pattern already used in mess/laundry).
// =====================================================================

const MobileLoad   = require('../models/mobileLoad');
const Due          = require('../models/due');
const Payment      = require('../models/payment');
const Notification = require('../models/notification');

async function loadWithStudent(id) {
    return MobileLoad.findById(id)
        .populate({ path: 'student', populate: { path: 'user', select: '_id fullname' } });
}

// ─────────────────────────────────────────────────────────────
// Mark cash received (Pending -> Payment Done)
// allowOverride: admin can call this even if status isn't Pending
// ─────────────────────────────────────────────────────────────
async function markCashReceived(id, actor, { allowOverride = false } = {}) {
    const ml = await loadWithStudent(id);
    if (!ml) return { ok: false, error: 'Request not found.' };

    if (!allowOverride && ml.requestStatus !== 'Pending') {
        return { ok: false, error: 'Cash can only be marked received for pending requests.' };
    }

    const previousStatus = ml.requestStatus;
    ml.requestStatus = 'Payment Done';
    await ml.save();

    const due = await Due.findOne({ sourceType: 'MobileLoad', sourceRef: ml._id });
    if (due && due.status !== 'Paid') {
        due.status     = 'Paid';
        due.paidAmount = due.amount;
        await due.save();

        await Payment.create({
            student      : ml.student._id,
            paymentType  : due.dueType,
            paymentMethod: 'Cash',
            amount       : due.amount,
            status       : 'Verified',
            source       : 'Manual',
            verifiedBy   : actor._id,
            verifiedAt   : new Date(),
            dues         : [due._id],
            remarks      : (actor.role === 'admin'
                ? `Cash collected by admin (override from ${previousStatus}) for mobile load top-up`
                : 'Cash collected by warden for mobile load top-up')
        });
    }

    try {
        await Notification.create({
            title    : 'Mobile Load Payment Confirmed',
            message  : `Cash received for your mobile load request (${ml.network} — ${ml.mobileNumber}). Top-up will be processed shortly.`,
            recipient: ml.student.user._id,
            category : 'Payments',
            relatedTo: { model: 'MobileLoad', docId: ml._id },
            createdBy: actor._id
        });
    } catch (_) {}

    return { ok: true, record: ml };
}

// ─────────────────────────────────────────────────────────────
// Complete (Payment Done -> Completed)
// ─────────────────────────────────────────────────────────────
async function complete(id, actor, { allowOverride = false } = {}) {
    const ml = await loadWithStudent(id);
    if (!ml) return { ok: false, error: 'Request not found.' };

    if (!allowOverride && ml.requestStatus !== 'Payment Done') {
        return { ok: false, error: 'Payment must be confirmed first.' };
    }

    ml.requestStatus = 'Completed';
    ml.fulfilledBy   = actor._id;
    ml.fulfilledAt   = new Date();
    await ml.save();

    try {
        await Notification.create({
            title    : 'Mobile Load Completed',
            message  : `Rs. ${ml.amount} has been topped up to ${ml.mobileNumber} (${ml.network}).`,
            recipient: ml.student.user._id,
            category : 'Requests',
            relatedTo: { model: 'MobileLoad', docId: ml._id },
            createdBy: actor._id
        });
    } catch (_) {}

    return { ok: true, record: ml };
}

// ─────────────────────────────────────────────────────────────
// Reject (any non-completed status -> Rejected)
// ─────────────────────────────────────────────────────────────
async function reject(id, actor, { reason } = {}) {
    const ml = await loadWithStudent(id);
    if (!ml) return { ok: false, error: 'Request not found.' };

    ml.requestStatus = 'Rejected';
    ml.remarks       = reason || 'No reason provided.';
    await ml.save();

    try {
        await Notification.create({
            title    : 'Mobile Load Request Rejected',
            message  : `Your mobile load request was rejected. Reason: ${ml.remarks}`,
            recipient: ml.student.user._id,
            category : 'Requests',
            relatedTo: { model: 'MobileLoad', docId: ml._id },
            createdBy: actor._id
        });
    } catch (_) {}

    return { ok: true, record: ml };
}

// ─────────────────────────────────────────────────────────────
// ADMIN-ONLY: full override — jump to ANY status from ANY current
// status, bypassing the normal Pending -> Payment Done -> Completed
// flow entirely. Keeps the linked Due in sync and always leaves an
// audit trail in ml.remarks (previous -> new, by whom).
//
// Wardens never get access to this function — call it only from
// operationController.js.
// ─────────────────────────────────────────────────────────────
async function adminOverrideStatus(id, actor, { newStatus, note } = {}) {
    const VALID = ['Pending', 'Payment Done', 'Completed', 'Rejected'];
    if (!VALID.includes(newStatus)) return { ok: false, error: 'Invalid status.' };

    const ml = await loadWithStudent(id);
    if (!ml) return { ok: false, error: 'Request not found.' };

    const previousStatus = ml.requestStatus;
    ml.requestStatus = newStatus;
    ml.remarks = `[Admin override: ${previousStatus} → ${newStatus}]` + (note ? ` ${note}` : '');

    if (newStatus === 'Completed') {
        ml.fulfilledBy = actor._id;
        ml.fulfilledAt = new Date();
    } else {
        // Overriding AWAY from Completed clears the fulfillment stamp —
        // it's no longer true that this request was topped up.
        if (previousStatus === 'Completed') {
            ml.fulfilledBy = null;
            ml.fulfilledAt = null;
        }
    }
    await ml.save();

    // Keep the linked Due in sync so Fee & Payment stays accurate.
    const due = await Due.findOne({ sourceType: 'MobileLoad', sourceRef: ml._id });
    if (due) {
        if (['Payment Done', 'Completed'].includes(newStatus) && due.status !== 'Paid') {
            due.status     = 'Paid';
            due.paidAmount = due.amount;
            await due.save();
        } else if (newStatus === 'Pending' && due.status === 'Paid') {
            due.status     = 'Pending';
            due.paidAmount = 0;
            await due.save();
        }
    }

    try {
        await Notification.create({
            title    : 'Mobile Load Request Updated',
            message  : `Your mobile load request status was changed to "${newStatus}" by admin.${note ? ' Note: ' + note : ''}`,
            recipient: ml.student.user._id,
            category : 'Requests',
            relatedTo: { model: 'MobileLoad', docId: ml._id },
            createdBy: actor._id
        });
    } catch (_) {}

    return { ok: true, record: ml, previousStatus };
}

module.exports = { markCashReceived, complete, reject, adminOverrideStatus };
