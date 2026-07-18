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
    // The ride request workflow:
    //   Pending (open for reservation) → Reserved (by a driver) →
    //   Awaiting Student (driver submitted fare) → Confirmed (student accepted)
    //   → In Progress → Completed
    //   Cancelled can happen at any open stage.
    //
    // Pending:          Student submitted, waiting for a driver to reserve.
    // Reserved:         A driver has reserved this request for 2 minutes
    //                   to submit a fare quote. Hidden from other drivers.
    // Awaiting Student: Driver submitted fare + ETA. Student must accept
    //                   or reject. 2-min timer still applies.
    // Confirmed:        Student accepted the fare. Ride is assigned.
    // In Progress:      Driver has started the ride.
    // Completed:        Ride finished successfully.
    //
    status: {
        type: String,
        enum: ['Pending', 'Reserved', 'Awaiting Student', 'Confirmed', 'In Progress', 'Completed', 'Cancelled'],
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

    // Admin override / driver confirmation audit
    confirmedAt: {
        type: Date,
        default: null
    },

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

    paymentStatus: {
        type: String,
        enum: ['Unpaid', 'Paid'],
        default: 'Unpaid'
    },

    // Gateway Payment record that settled this booking's fare
    payment: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Payment',
        default: null
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
