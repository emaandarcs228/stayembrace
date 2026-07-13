const mongoose = require("mongoose");

const guestRoomBookingSchema = new mongoose.Schema({

    // A booking may only be created against a VisitorRequest that is
    // already Approved (enforced in guestBookingActions.js, not here).
    visitorRequest: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "VisitorRequest",
        required: true
    },

    student: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Student",
        required: true
    },

    room: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Room",
        required: true
    },

    fromDate: {
        type: Date,
        required: true
    },

    toDate: {
        type: Date,
        required: true
    },

    // Admin-only approval — Room Management (and by extension, Guest
    // Rooms) is admin's domain. No warden step here.
    status: {
        type: String,
        enum: ["Pending", "Approved", "Rejected", "Cancelled"],
        default: "Pending"
    },

    adminDecision: {
        note: String,
        by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        at: Date
    }

}, {
    timestamps: true
});

// Basic date-range sanity check at the schema level too, so a bad
// fromDate/toDate pair can never be saved even if a controller forgets
// to validate it upstream.
guestRoomBookingSchema.pre("validate", function () {
    if (this.fromDate && this.toDate && this.toDate <= this.fromDate) {
        throw new Error("toDate must be after fromDate.");
    }
});

module.exports = mongoose.model("GuestRoomBooking", guestRoomBookingSchema);