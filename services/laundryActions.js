// =====================================================================
// services/laundryActions.js
//
// Shared laundry logic used by both wardenController.js (routine
// pickup/delivery handling) and operationController.js (admin
// oversight — view + override only). Mirrors the messActions.js
// pattern: one service, two controllers, warden and admin can never
// silently drift apart.
// =====================================================================

const LaundryRequest = require('../models/laundry');
const Due            = require('../models/due');
const Payment         = require('../models/payment');
const Notification    = require('../models/notification');

function getCurrentWeekKey(date = new Date()) {
    const d    = new Date(date);
    const day  = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const mon  = new Date(d.setDate(diff));
    const yr   = mon.getFullYear();
    const wk   = Math.ceil(((mon - new Date(yr, 0, 1)) / 86400000 + 1) / 7);
    return `${yr}-W${String(wk).padStart(2, '0')}`;
}

async function getLaundryPageData({ weekKey }) {
    const resolvedWeek = weekKey || getCurrentWeekKey();

    const requests = await LaundryRequest.find({ weekKey: resolvedWeek })
        .populate({ path: 'student', populate: { path: 'user', select: 'fullname userId' } })
        .populate('due')
        .sort({ isChargeable: 1, createdAt: 1 })
        .lean();

    const freeRequests = requests.filter(r => !r.isChargeable);
    const paidRequests = requests.filter(r => r.isChargeable);

    const weekOptions = [];
    for (let i = 0; i < 8; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i * 7);
        weekOptions.push(getCurrentWeekKey(d));
    }

    return { freeRequests, paidRequests, weekKey: resolvedWeek, weekOptions };
}

// allowOverride: admin-only escape hatch — force a status change on a
// paid request even if the payment hasn't been confirmed yet. Wardens
// can never pass this as true (see wardenController.js).
async function updateStatus(id, actingUser, { newStatus, allowOverride = false }) {
    const validStatuses = ['Picked Up', 'Processing', 'Delivered'];
    if (!validStatuses.includes(newStatus)) {
        return { ok: false, error: 'Invalid status.' };
    }

    const lr = await LaundryRequest.findById(id)
        .populate({ path: 'student', populate: { path: 'user', select: '_id' } });
    if (!lr) return { ok: false, error: 'Request not found.' };

    if (lr.isChargeable && !allowOverride) {
        const due = await Due.findOne({ sourceType: 'LaundryRequest', sourceRef: lr._id });
        if (due && due.status !== 'Paid') {
            return { ok: false, error: 'Payment must be confirmed before processing this request.' };
        }
    }

    lr.status    = newStatus;
    lr.handledBy = actingUser._id;
    await lr.save();

    try {
        await Notification.create({
            title     : 'Laundry Update',
            message   : `Your laundry is now: ${newStatus}.` + (allowOverride ? ' (updated by admin)' : ''),
            recipient : lr.student.user._id,
            category  : 'Requests',
            relatedTo : { model: 'LaundryRequest', docId: lr._id },
            createdBy : actingUser._id
        });
    } catch (_) {}

    return { ok: true, weekKey: lr.weekKey };
}

// Warden-only in practice (no admin route calls this) — kept here so
// the cash + Due + Payment logic lives in one place, same as mess.
async function markCashReceived(id, actingUser) {
    const lr = await LaundryRequest.findById(id)
        .populate({ path: 'student', populate: { path: 'user', select: '_id' } });
    if (!lr) return { ok: false, error: 'Request not found.' };

    const due = await Due.findOne({ sourceType: 'LaundryRequest', sourceRef: lr._id });
    if (due) {
        due.status     = 'Paid';
        due.paidAmount = due.amount;
        await due.save();

        await Payment.create({
            student      : lr.student._id,
            paymentType  : due.dueType,
            paymentMethod: 'Cash',
            amount       : due.amount,
            status       : 'Verified',
            source       : 'Manual',
            verifiedBy   : actingUser._id,
            verifiedAt   : new Date(),
            dues         : [due._id],
            remarks      : 'Cash collected for laundry request'
        });
    }

    try {
        await Notification.create({
            title     : 'Laundry Payment Confirmed',
            message   : 'Cash received for your paid laundry request. Processing will begin shortly.',
            recipient : lr.student.user._id,
            category  : 'Payments',
            createdBy : actingUser._id
        });
    } catch (_) {}

    return { ok: true, weekKey: lr.weekKey };
}

module.exports = { getCurrentWeekKey, getLaundryPageData, updateStatus, markCashReceived };