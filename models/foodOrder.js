const mongoose = require('mongoose');

const foodOrderSchema = new mongoose.Schema({

    student: {
        type     : mongoose.Schema.Types.ObjectId,
        ref      : 'Student',
        required : true
    },

    items: [
        {
            menuItem: {
                type     : mongoose.Schema.Types.ObjectId,
                ref      : 'MenuItem',
                required : true
            },
            quantity: {
                type    : Number,
                default : 1
            },
            priceAtOrder: {
                type     : Number,
                required : true
            }
        }
    ],

    totalAmount: {
        type     : Number,
        required : true
    },

    // ── Due reference ──────────────────────────────────────────────────
    // Created automatically when the order is placed.
    // All payment tracking (online / cash) happens via Due → Payment.
    // This replaces the old direct `payment` field so the centralized
    // Pending Payments screen has a single source of truth.
    due: {
        type    : mongoose.Schema.Types.ObjectId,
        ref     : 'Due',
        default : null
    },

    // ── Cancellation ───────────────────────────────────────────────────
    // Cancellation is allowed with a partial refund / fee.
    // The refund amount is recorded here; the actual refund transaction
    // is handled separately as a negative Payment or credit note.
    cancelledAt: {
        type    : Date,
        default : null
    },

    refundAmount: {
        type    : Number,
        default : null
    },

    // ── Order status ───────────────────────────────────────────────────
    // Separate state machine from payment (tracked via Due).
    // Warden updates this after payment is confirmed.
    orderStatus: {
        type    : String,
        enum    : ['Pending', 'Accepted', 'Preparing', 'Delivered', 'Cancelled'],
        default : 'Pending'
    },

    handledBy: {
        type : mongoose.Schema.Types.ObjectId,
        ref  : 'User'   // Warden
    },

    orderDate: {
        type    : Date,
        default : Date.now
    }

}, { timestamps: true });

module.exports = mongoose.model('FoodOrder', foodOrderSchema);