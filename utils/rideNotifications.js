/**
 * rideNotifications.js
 *
 * Centralized catalog of ride-lifecycle notifications for students and
 * drivers. Every CabBooking-related notification in driverController.js /
 * studentController.js / operationController.js goes through
 * notifyStudent()/notifyDriver() here instead of hand-writing
 * title/message/priority at each call site, so wording can't drift
 * between call sites and there's one place to audit the full catalog.
 *
 * Persistence and unread/read tracking are handled entirely by the
 * existing Notification model (models/notification.js) — recipient +
 * readBy array — this module only standardizes what gets written there.
 */
const Notification = require('../models/notification');

function money(n) { return 'Rs ' + Number(n || 0).toLocaleString(); }

// ── Student-facing events ────────────────────────────────────────────
const STUDENT_EVENTS = {
    RIDE_SUBMITTED: {
        priority: 'Low',
        title: () => 'Ride Submitted',
        message: (ctx) => `Your ride request from "${ctx.pickup}" to "${ctx.dropoff}" has been submitted and is now visible to available drivers.`
    },
    DRIVER_OFFERED_FARE: {
        priority: 'Medium',
        title: (ctx) => `Driver Offered Fare — ${money(ctx.fare)} from ${ctx.driverName}`,
        message: (ctx) => {
            let msg = `🚗 Driver: ${ctx.driverName}\n💰 Fare: ${money(ctx.fare)}`;
            if (ctx.eta) msg += `\n⏱ ETA: ${ctx.eta}`;
            msg += `\n📍 Route: ${ctx.pickup} → ${ctx.dropoff}`;
            if (ctx.comments) msg += `\n💬 Note: "${ctx.comments}"`;
            return msg;
        }
    },
    RIDE_CONFIRMED: {
        priority: 'Medium',
        title: () => 'Ride Confirmed',
        message: (ctx) => `Your ride from "${ctx.pickup}" to "${ctx.dropoff}" with ${ctx.driverName} is confirmed. Fare: ${money(ctx.fare)}.`
    },
    DRIVER_ON_THE_WAY: {
        priority: 'Medium',
        title: () => 'Driver On The Way',
        message: (ctx) => `${ctx.driverName} is on the way to pick you up from "${ctx.pickup}".`
    },
    DRIVER_ARRIVED: {
        priority: 'Medium',
        title: () => 'Driver Arrived',
        message: (ctx) => `${ctx.driverName} has arrived at "${ctx.pickup}". Please head out to meet them.`
    },
    RIDE_STARTED: {
        priority: 'Medium',
        title: () => 'Ride Started',
        message: (ctx) => `Your ride with ${ctx.driverName} has started — on the way to "${ctx.dropoff}".`
    },
    RIDE_COMPLETED: {
        priority: 'Medium',
        title: () => 'Ride Completed',
        message: (ctx) => `Your ride with ${ctx.driverName} is complete. Don't forget to rate your trip!`
    },
    RIDE_CANCELLED: {
        priority: 'High',
        title: () => 'Ride Cancelled',
        message: (ctx) => {
            let msg = `Your ride from "${ctx.pickup}" to "${ctx.dropoff}" was cancelled${ctx.by ? ' by ' + ctx.by : ''}.`;
            if (ctx.reason) msg += ` Reason: ${ctx.reason}.`;
            if (ctx.refundNote) msg += ` ${ctx.refundNote}`;
            return msg;
        }
    }
};

// ── Driver-facing events ─────────────────────────────────────────────
const DRIVER_EVENTS = {
    NEW_RIDE_REQUEST: {
        priority: 'Medium',
        title: () => 'New Ride Request',
        message: (ctx) => `${ctx.studentName} needs a ride on ${ctx.date} from "${ctx.pickup}" to "${ctx.dropoff}". Be the first to reserve!`
    },
    RIDE_RESERVED: {
        priority: 'Low',
        title: () => 'Ride Reserved',
        message: (ctx) => `You reserved the ride from "${ctx.pickup}" to "${ctx.dropoff}". You have 2 minutes to submit a fare quote.`
    },
    STUDENT_ACCEPTED: {
        priority: 'Medium',
        title: () => 'Student Accepted',
        message: (ctx) => `${ctx.studentName} accepted your fare quote of ${money(ctx.fare)} for the ride from "${ctx.pickup}" to "${ctx.dropoff}".`
    },
    STUDENT_REJECTED: {
        priority: 'Medium',
        title: () => 'Student Rejected',
        message: (ctx) => `${ctx.studentName} declined your fare quote of ${money(ctx.fare)} for the ride from "${ctx.pickup}" to "${ctx.dropoff}". The request is now open for other drivers.`
    },
    STUDENT_CANCELLED: {
        priority: 'Low',
        title: () => 'Student Cancelled',
        message: (ctx) => `${ctx.studentName} cancelled the ride request from "${ctx.pickup}" to "${ctx.dropoff}". Reason: ${ctx.reason || 'No reason provided'}.`
    },
    STUDENT_COMING: {
        priority: 'Medium',
        title: () => 'Student Coming',
        message: (ctx) => `${ctx.studentName} is on the way out to meet you at "${ctx.pickup}".`
    },
    RIDE_COMPLETED: {
        priority: 'Low',
        title: () => 'Ride Completed',
        message: (ctx) => `Your ride with ${ctx.studentName} (${money(ctx.fare)}) is complete.`
    }
};

async function _notify(events, eventKey, { recipient, actorId, ctx = {}, bookingId }) {
    const def = events[eventKey];
    if (!def) throw new Error(`Unknown ride notification event: ${eventKey}`);
    if (!recipient) return null; // nothing to notify — e.g. no driver assigned yet

    return Notification.create({
        title    : def.title(ctx),
        message  : def.message(ctx),
        recipient,
        category : 'Requests',
        relatedTo: { model: 'CabBooking', docId: bookingId },
        createdBy: actorId,
        priority : def.priority
    });
}

function notifyStudent(eventKey, opts) { return _notify(STUDENT_EVENTS, eventKey, opts); }
function notifyDriver(eventKey, opts) { return _notify(DRIVER_EVENTS, eventKey, opts); }

module.exports = { STUDENT_EVENTS, DRIVER_EVENTS, notifyStudent, notifyDriver };
