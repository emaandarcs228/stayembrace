const mongoose = require('mongoose');

const mobileLoadSchema = new mongoose.Schema({

    student: {
        type     : mongoose.Schema.Types.ObjectId,
        ref      : 'Student',
        required : true
    },

    mobileNumber: {
        type     : String,
        required : true
    },

    network: {
        type : String,
        enum : ['Jazz', 'Zong', 'Ufone', 'Telenor']
    },

    amount: {
        type     : Number,
        required : true
    },

    // ── Payment flow ───────────────────────────────────────────────────
    // A Due is created when the request is placed.
    // The warden only fulfills the load AFTER payment is confirmed.
    due: {
        type    : mongoose.Schema.Types.ObjectId,
        ref     : 'Due',
        default : null
    },

    // ── Request status ─────────────────────────────────────────────────
    // Pending        → request placed, awaiting payment
    // Payment Done   → student paid (online verified by admin, or cash
    //                  marked received by warden); warden notified
    // Completed      → warden has topped up the SIM
    // Rejected       → request rejected by warden / admin
    requestStatus: {
        type    : String,
        enum    : ['Pending', 'Payment Done', 'Completed', 'Rejected'],
        default : 'Pending'
    },

    // Warden who fulfilled the request
    fulfilledBy: {
        type    : mongoose.Schema.Types.ObjectId,
        ref     : 'User',
        default : null
    },

    fulfilledAt: {
        type    : Date,
        default : null
    },

    remarks: {
        type    : String,
        default : null
    }

}, { timestamps: true });

module.exports = mongoose.model('MobileLoad', mobileLoadSchema);