const mongoose = require('mongoose');

const fineSchema = new mongoose.Schema({

    student: {
        type     : mongoose.Schema.Types.ObjectId,
        ref      : 'Student',
        required : true
    },

    reason: {
        type     : String,
        required : true
    },

    amount: {
        type     : Number,
        required : true
    },

    imposedBy: {
        type : mongoose.Schema.Types.ObjectId,
        ref  : 'User'
    },

    // ── Due reference ──────────────────────────────────────────────────
    // A Due document is created when the fine is applied.
    // Paid / unpaid status is tracked via the Due, not duplicated here.
    // This reference lets the fine detail screen show payment status
    // without a separate query.
    due: {
        type    : mongoose.Schema.Types.ObjectId,
        ref     : 'Due',
        default : null
    },

    // ── Status ─────────────────────────────────────────────────────────
    // Kept as a quick lookup field on the fine itself.
    // Should always stay in sync with the linked Due's status:
    //   Due Pending   → Fine Pending
    //   Due Paid      → Fine Paid
    //   Waived        → Fine Waived (no Due settlement needed)
    status: {
        type    : String,
        enum    : ['Pending', 'Paid', 'Waived'],
        default : 'Pending'
    }

}, { timestamps: true });

module.exports = mongoose.model('Fine', fineSchema);