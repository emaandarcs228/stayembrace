const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({

    student: {
        type     : mongoose.Schema.Types.ObjectId,
        ref      : 'Student',
        required : true
    },

    // 'Multiple' is used when student pays several dues in one transaction
    paymentType: {
        type     : String,
        enum     : ['Hostel Fee', 'Mess Order', 'Mobile Load', 'Fine', 'Laundry', 'Cab Booking', 'Multiple'],
        required : true
    },

    paymentMethod: {
        type     : String,
        enum     : ['Cash', 'Easypaisa', 'JazzCash'],
        required : true
    },

    amount: {
        type     : Number,
        required : true
    },

    // ── Dues settled by this payment ───────────────────────────────────
    // A student can select multiple pending Dues and pay in one transaction.
    dues: [
        {
            type : mongoose.Schema.Types.ObjectId,
            ref  : 'Due'
        }
    ],

    // Set instead of `dues` when this payment settles a CabBooking's fare
    // (cab bookings aren't tracked via the Due model).
    cabBooking: {
        type    : mongoose.Schema.Types.ObjectId,
        ref     : 'CabBooking',
        default : null
    },

    paymentDate: {
        type    : Date,
        default : Date.now
    },

    transactionId: String,

    // Receipt image uploaded by student (for online payments)
    receiptImage: String,

    // ── Source ──────────────────────────────────────────────────────────
    // 'Gateway' → created automatically by a payment gateway callback
    //             (e.g. JazzCash) — already verified by the gateway itself.
    // 'Manual'  → typed in by admin/warden (cash, or a manual gateway
    //             reference entered after seeing a screenshot).
    // Drives the Gateway/Manual badge in feeM's Payments table.
    source: {
        type    : String,
        enum    : ['Manual', 'Gateway'],
        default : 'Manual'
    },

    // Raw response code from the gateway (e.g. JazzCash pp_ResponseCode).
    // Kept for debugging failed/edge-case gateway transactions — not
    // shown to students, admin-only diagnostic field.
    gatewayResponseCode: String,

    status: {
        type    : String,
        enum    : ['Pending', 'Cash Received', 'Verified', 'Rejected'],
        default : 'Pending'
    },

    verifiedBy: {
        type : mongoose.Schema.Types.ObjectId,
        ref  : 'User'
    },

    verifiedAt: Date,

    remarks: String

}, { timestamps: true });

module.exports = mongoose.model('Payment', paymentSchema);