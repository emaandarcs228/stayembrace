const mongoose = require('mongoose');

const cabBookingSchema = new mongoose.Schema({

    // ── Who booked ────────────────────────────────────────────────
    student: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Student',
        required: true
    },

    // ── Who is the transport provider (driver) ────────────────────
    // Only set once the student accepts the driver's fare quote.
    // Until then, the driver who reserves is tracked in reservedBy.
    driver: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },

    // Denormalised fields for fast display without population
    driverName: {
        type: String,
        default: null
    },

    driverPhone: {
        type: String,
        default: null
    },

    // ── Vehicle info (snapshot at booking time) ───────────────────
    vehicleType: {
        type: String,
        default: null
    },

    vehicleRegistration: {
        type: String,
        default: null
    },

    // ── Trip details ──────────────────────────────────────────────
    pickupLocation: {
        type: String,
        required: true
    },

    dropoffLocation: {
        type: String,
        required: true
    },

    pickupDate: {
        type: Date,
        required: true
    },

    pickupTime: {
        type: String,
        default: ''
    },

    passengerCount: {
        type: Number,
        default: 1,
        min: 1,
        max: 10
    },

    // Trip purpose (e.g. Personal, Academic, Medical, Airport, Other)
    purpose: {
        type: String,
        default: ''
    },

    // Maximum budget the student is willing to pay
    budget: {
        type: Number,
        default: null,
        min: 0
    },

    notes: {
        type: String,
        default: ''
    },

    // ── Ride Reservation Workflow ─────────────────────────────────
    // Pending → Reserved by Driver → Waiting for Student Confirmation →
    // Ride Confirmed → Driver On the Way → Driver Arrived → Student Coming
    // → Ride Started → Ride Completed.
    // Cancelled is only reachable from Pending / Reserved by Driver /
    // Waiting for Student Confirmation.
    //
    // See utils/rideStatus.js for the full transition table, badge
    // classes, and semantic group helpers — this enum must stay in exact
    // sync with STATUS_ORDER exported there.
    status: {
        type: String,
        enum: [
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
        ],
        default: 'Pending'
    },

    // Which driver currently has this request reserved
    reservedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },

    // When the reservation started
    reservedAt: {
        type: Date,
        default: null
    },

    // When the reservation expires (reservedAt + 2 minutes)
    reservationExpiresAt: {
        type: Date,
        default: null
    },

    // The driver's quote: fare + estimated arrival time + optional comments
    quote: {
        fare: { type: Number, default: null, min: 0 },
        eta:  { type: String, default: '' },
        comments: { type: String, default: '' },
        submittedAt: { type: Date, default: null }
    },

    // The student's decision on the driver's quote
    studentDecision: {
        status: {
            type: String,
            enum: ['pending', 'accepted', 'rejected', 'expired'],
            default: 'pending'
        },
        decidedAt: { type: Date, default: null }
    },

    // Tracks who cancelled and why
    cancellation: {
        by: {
            type: String,
            enum: ['student', 'driver', 'admin', 'system', null],
            default: null
        },
        reason: {
            type: String,
            default: ''
        },
        at: {
            type: Date,
            default: null
        }
    },

    // ── Status History (audit trail) ──────────────────────────────
    // One entry appended on every transition, including system-initiated
    // ones (reservationTimeoutJob), where changedBy is null and
    // changedByRole is 'system'. Append-only — distinct from the flat
    // confirmedAt/completedAt/driverArrivedAt-etc. "current stage"
    // timestamp fields below, which remain the fast-path read for
    // "when did X happen" without needing to scan this array.
    statusHistory: [{
        status: {
            type: String,
            enum: [
                'Pending', 'Reserved by Driver', 'Waiting for Student Confirmation',
                'Ride Confirmed', 'Driver On the Way', 'Driver Arrived',
                'Student Coming', 'Ride Started', 'Ride Completed', 'Cancelled'
            ],
            required: true
        },
        changedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null
        },
        changedByRole: {
            type: String,
            enum: ['student', 'driver', 'admin', 'system', null],
            default: null
        },
        at: { type: Date, default: Date.now },
        note: { type: String, default: '' }
    }],

    // Admin override / driver confirmation audit
    confirmedAt: {
        type: Date,
        default: null
    },

    // ── Driver progress sub-stage timestamps (post-confirmation) ──
    driverOnWayAt: { type: Date, default: null },
    driverArrivedAt: { type: Date, default: null },
    studentComingAt: { type: Date, default: null },
    rideStartedAt: { type: Date, default: null },

    completedAt: {
        type: Date,
        default: null
    },

    // ── Fare & Payment ──────────────────────────────────────────────
    // Set when the student accepts the driver's quote.
    fare: {
        type: Number,
        default: null,
        min: 0
    },

    // 'Refund Pending' — the student had already paid in full when they
    // cancelled a Ride Confirmed-or-later booking; the hostel owes them
    // (fare - cancellationFee) back. There's no payment-gateway refund
    // API in this codebase, so this is settled manually by an admin.
    paymentStatus: {
        type: String,
        enum: ['Unpaid', 'Paid', 'Refund Pending'],
        default: 'Unpaid'
    },

    // Gateway Payment record that settled this booking's fare
    payment: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Payment',
        default: null
    },

    // Hostel cancellation policy: cancelling a Ride Confirmed-or-later
    // booking (before Ride Started) carries a flat 50% fee on the agreed
    // fare. Set only when that fee applies; null for free (pre-confirmation)
    // cancellations. See utils/rideStatus.js CANCELLATION_FEE_FROM.
    cancellationFee: {
        type: Number,
        default: null,
        min: 0
    },

    // ── Rating & Review (student → driver, only for Completed rides) ──
    rating: {
        type: Number,
        min: 1,
        max: 5,
        default: null
    },

    review: {
        type: String,
        default: ''
    },

    ratedAt: {
        type: Date,
        default: null
    }

}, { timestamps: true });

// ── Index for quick reservation expiry queries ─────────────────
cabBookingSchema.index({ status: 1, reservationExpiresAt: 1 });

module.exports = mongoose.model('CabBooking', cabBookingSchema);
