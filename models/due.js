const mongoose = require("mongoose");

const dueSchema = new mongoose.Schema({

    student: {
        type     : mongoose.Schema.Types.ObjectId,
        ref      : 'Student',
        required : true
    },

    dueType: {
        type : String,
        enum : [
            'Hostel Fee',
            'Mess Order',
            'Mobile Load',
            'Fine',
            'Laundry',
            'Guest Room'
        ]
    },

    amount: {
        type     : Number,
        required : true
    },

    // Amount already paid (for Partially Paid tracking)
    paidAmount: {
        type    : Number,
        default : 0
    },

    dueDate: {
        type     : Date,
        required : true
    },

    status: {
        type    : String,
        enum    : ['Pending', 'Partially Paid', 'Paid', 'Overdue'],
        default : 'Pending'
    },

    description: String,

    // ── Source reference ────────────────────────────────────────────────
    // Links this Due back to the service record that generated it,
    // so Pending Payments can deep-link to the original order/request.
    // e.g. sourceType: 'FoodOrder', sourceRef: <FoodOrder._id>
    sourceType: {
        type    : String,
        enum    : ['FoodOrder', 'MobileLoad', 'LaundryRequest', 'Fine', 'Allocation', 'GuestRoomBooking', null],
        default : null
    },

    sourceRef: {
        type    : mongoose.Schema.Types.ObjectId,
        default : null
    },

    // ── Billing period ────────────────────────────────────────────────
    // Only used for recurring Hostel Fee dues (sourceType: 'Allocation').
    // Format 'YYYY-MM' — lets the monthly job check "has this student's
    // fee for this month already been generated?" with a single indexed
    // query instead of a fuzzy dueDate range comparison.
    billingPeriod: {
        type    : String,
        default : null
    }

}, { timestamps: true });

// Fast lookup for the monthly hostel-fee job: "does this allocation
// already have a Due for this billing period?"
dueSchema.index({ sourceType: 1, sourceRef: 1, billingPeriod: 1 });

// ── Index for student pending payments (student + status) ──────
dueSchema.index({ student: 1, status: 1 });

module.exports = mongoose.model('Due', dueSchema);