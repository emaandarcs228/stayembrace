/**
 * rideStatus.js
 *
 * Single source of truth for the CabBooking ride-status vocabulary,
 * valid transitions, and display/grouping helpers. Every controller that
 * reads or writes CabBooking.status should import from here instead of
 * hardcoding literal strings, so the transition rules and display maps
 * can never drift out of sync between driver/student/admin/warden code.
 *
 * Each existing atomic findOneAndUpdate() in the controllers still
 * corresponds to exactly one transition edge — this module only supplies
 * the validated predecessor/successor sets so those filters stop
 * hand-duplicating literals; it is not a generic "set any status" API.
 */

// ── Canonical status order ──────────────────────────────────────────
const STATUS_ORDER = [
    'Pending',
    'Reserved by Driver',
    'Waiting for Student Confirmation',
    'Ride Confirmed',
    'Driver On the Way',
    'Driver Arrived',
    'Student Coming',
    'Ride Started',
    'Ride Completed',
    'Cancelled'
];

// ── Transition table: status -> array of directly reachable statuses ──
// A student may cancel any time up through 'Student Coming' — once the
// driver marks 'Ride Started' there is no cancellation path. See
// CANCELLABLE_FROM / CANCELLATION_FEE_FROM below for the fee policy that
// applies to the post-confirmation subset of these edges.
const TRANSITIONS = {
    'Pending'                          : ['Reserved by Driver', 'Cancelled'],
    'Reserved by Driver'               : ['Waiting for Student Confirmation', 'Pending', 'Cancelled'],
    'Waiting for Student Confirmation' : ['Ride Confirmed', 'Pending', 'Cancelled'],
    'Ride Confirmed'                   : ['Driver On the Way', 'Cancelled'],
    'Driver On the Way'                : ['Driver Arrived', 'Cancelled'],
    'Driver Arrived'                   : ['Student Coming', 'Cancelled'],
    'Student Coming'                   : ['Ride Started', 'Cancelled'],
    'Ride Started'                     : ['Ride Completed'],
    'Ride Completed'                   : [],
    'Cancelled'                        : []
};

// ── Strictly-sequential driver progress chain (post-confirmation) ──
// Drives the single "Advance" action: one click always moves to the very
// next entry, computed from the current DB status — never a jump ahead.
const DRIVER_PROGRESS_CHAIN = [
    'Ride Confirmed',
    'Driver On the Way',
    'Driver Arrived',
    'Student Coming',
    'Ride Started',
    'Ride Completed'
];

function getNextStage(currentStatus) {
    const idx = DRIVER_PROGRESS_CHAIN.indexOf(currentStatus);
    if (idx === -1 || idx === DRIVER_PROGRESS_CHAIN.length - 1) return null;
    return DRIVER_PROGRESS_CHAIN[idx + 1];
}

function canTransition(from, to) {
    return Array.isArray(TRANSITIONS[from]) && TRANSITIONS[from].includes(to);
}

// Every status that can legally transition INTO `target` — lets a
// controller build { status: { $in: getValidPredecessors(target) } } as
// part of its own atomic findOneAndUpdate filter.
function getValidPredecessors(target) {
    return Object.keys(TRANSITIONS).filter(from => TRANSITIONS[from].includes(target));
}

// ── Deliberate carve-out: legacy direct-assign bookings (created with
// `driver` pre-set by an admin, skipping the whole reservation cycle)
// jump straight from Pending to Ride Confirmed via acceptBooking(). This
// bypasses TRANSITIONS on purpose — it's a separate legacy edge, not part
// of the reservation-marketplace state machine. ──
const LEGACY_DIRECT_CONFIRM_FROM = ['Pending'];

// ── Hostel cancellation policy ───────────────────────────────────────
// Free to cancel before a driver is confirmed. Once 'Ride Confirmed' (or
// any later pre-start stage), cancelling is still allowed but carries a
// flat cancellation fee — the driver has already committed to the trip.
// No cancellation is possible once 'Ride Started'.
const FREE_CANCEL_FROM = ['Pending', 'Reserved by Driver', 'Waiting for Student Confirmation'];
const CANCELLATION_FEE_FROM = ['Ride Confirmed', 'Driver On the Way', 'Driver Arrived', 'Student Coming'];
const CANCELLABLE_FROM = FREE_CANCEL_FROM.concat(CANCELLATION_FEE_FROM);
const CANCELLATION_FEE_RATE = 0.5; // 50% of the agreed fare

function isCancellable(status) { return CANCELLABLE_FROM.includes(status); }
function cancellationIncursFee(status) { return CANCELLATION_FEE_FROM.includes(status); }

// ── Driver-initiated cancellation: only before reaching the pickup
// location. Once 'Driver Arrived' the driver is on-site, so backing out
// this way no longer makes sense — from there the ride either proceeds
// or the student cancels it themselves (subject to the fee policy above).
const DRIVER_CANCELLABLE_FROM = ['Ride Confirmed', 'Driver On the Way'];
function isDriverCancellable(status) { return DRIVER_CANCELLABLE_FROM.includes(status); }

// ── "Assigned to a driver, ride not yet completed" — replaces every old
// ['Confirmed','In Progress'].includes(status) check (Pay Now gating,
// "Assigned Driver" box, driver's Active Rides list). ──
const ASSIGNED_GROUP = ['Ride Confirmed', 'Driver On the Way', 'Driver Arrived', 'Student Coming', 'Ride Started'];
function isAssignedToDriver(status) { return ASSIGNED_GROUP.includes(status); }

function isTerminal(status) { return status === 'Ride Completed' || status === 'Cancelled'; }

// ── Badge CSS classes — one map for every view that displays a status ──
const BADGE_CLASS = {
    'Pending'                          : 'badge-warning',
    'Reserved by Driver'               : 'badge-info',
    'Waiting for Student Confirmation' : 'badge-purple',
    'Ride Confirmed'                   : 'badge-info',
    'Driver On the Way'                : 'badge-primary',
    'Driver Arrived'                   : 'badge-primary',
    'Student Coming'                   : 'badge-primary',
    'Ride Started'                     : 'badge-primary',
    'Ride Completed'                   : 'badge-success',
    'Cancelled'                        : 'badge-danger'
};

// ── "What will the Advance button do next" — driver views render this
// directly instead of hardcoding a Start/Complete button pair. ──
const NEXT_STAGE_LABEL = {
    'Ride Confirmed'    : 'Mark: Driver On the Way',
    'Driver On the Way' : 'Mark: Driver Arrived',
    'Driver Arrived'    : 'Mark: Student Coming',
    'Student Coming'    : 'Mark: Ride Started',
    'Ride Started'      : 'Mark: Ride Completed'
};

module.exports = {
    STATUS_ORDER,
    TRANSITIONS,
    DRIVER_PROGRESS_CHAIN,
    getNextStage,
    canTransition,
    getValidPredecessors,
    LEGACY_DIRECT_CONFIRM_FROM,
    FREE_CANCEL_FROM,
    CANCELLATION_FEE_FROM,
    CANCELLATION_FEE_RATE,
    CANCELLABLE_FROM,
    isCancellable,
    cancellationIncursFee,
    DRIVER_CANCELLABLE_FROM,
    isDriverCancellable,
    ASSIGNED_GROUP,
    isAssignedToDriver,
    isTerminal,
    BADGE_CLASS,
    NEXT_STAGE_LABEL
};
