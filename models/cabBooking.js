const mongoose = require('mongoose');

const cabBookingSchema = new mongoose.Schema({

    // ── Who booked ────────────────────────────────────────────────
    student: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Student',
        required: true
    },

    // ── Who is the transport provider (driver) ────────────────────
    // References the User record of the approved driver, not the
    // Driver profile directly, so we can display name/phone without
    // an extra lookup.
    driver: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },

    // Denormalised fields for fast display without population
    driverName: {
        type: String,
        required: true
    },

    driverPhone: {
        type: String,
        default: '—'
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

    notes: {
        type: String,
        default: ''
    },

    // ── Status tracking ───────────────────────────────────────────
    status: {
        type: String,
        enum: ['Pending', 'Confirmed', 'In Progress', 'Completed', 'Cancelled'],
        default: 'Pending'
    },

    // Tracks who cancelled and why
    cancellation: {
        by: {
            type: String,
            enum: ['student', 'driver', 'admin', null],
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

module.exports = mongoose.model('CabBooking', cabBookingSchema);
