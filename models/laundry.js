const mongoose = require('mongoose');

const laundryRequestSchema = new mongoose.Schema({

    student: {
        type     : mongoose.Schema.Types.ObjectId,
        ref      : 'Student',
        required : true
    },

    // Week identifier — e.g. '2025-W10'
    weekKey: {
        type     : String,
        required : true
    },

    pickupDate: {
        type     : Date,
        required : true
    },

    deliveryDate: {
        type     : Date,
        required : true
    },

    itemCount: {
        type    : Number,
        default : 0   // updated when items are physically collected
    },

    // Student can opt-out of the auto-enrolled weekly cycle
    requested: {
        type    : Boolean,
        default : true
    },

    // ── Chargeable flag ────────────────────────────────────────────────
    // false → first request of the week (free, included in hostel fee)
    // true  → second request of the week (paid; generates a Due)
    isChargeable: {
        type    : Boolean,
        default : false
    },

    // ── Due reference ──────────────────────────────────────────────────
    // Populated only when isChargeable is true.
    due: {
        type    : mongoose.Schema.Types.ObjectId,
        ref     : 'Due',
        default : null
    },

    status: {
        type    : String,
        enum    : ['Pending Pickup', 'Picked Up', 'Processing', 'Delivered', 'Cancelled'],
        default : 'Pending Pickup'
    },

    cancelledBy: {
        type    : mongoose.Schema.Types.ObjectId,
        ref     : 'Student',
        default : null
    },

    handledBy: {
        type    : mongoose.Schema.Types.ObjectId,
        ref     : 'User',
        default : null
    },

    notes: {
        type    : String,
        default : null
    }

}, { timestamps: true });

// ── FIXED: unique on student + weekKey + isChargeable ─────────────────
// This allows one free request AND one paid request per student per week.
// The old index { student, weekKey } was unique and prevented this.
laundryRequestSchema.index(
    { student: 1, weekKey: 1, isChargeable: 1 },
    { unique: true }
);

module.exports = mongoose.model('LaundryRequest', laundryRequestSchema);