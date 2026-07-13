const mongoose = require("mongoose");

const roomRequestSchema = new mongoose.Schema({

    student: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Student",
        required: true
    },

    requestType: {
        type: String,
        enum: ["Transfer", "Vacate"],
        required: true
    },

    reason: {
        type: String,
        default: ""
    },

    // Student's free-text preference (e.g. "A-101"), NOT a room reference.
    // The actual destination room is chosen by admin at approval time
    // (see roomRequestActions.js adminApproveTransfer) — this is purely
    // informational, so it stays a plain string to match the text input
    // in views/student/room.ejs. Using ObjectId/ref here previously
    // caused a CastError (and silent request-submission failure)
    // whenever a student typed a room number instead of a real ID.
    preferredRoom: {
        type: String,
        default: ""
    },

    vacateDate: {
        type: Date,
        default: null
    },

    // Overall lifecycle status
    status: {
        type: String,
        enum: ["Pending", "Warden Reviewed", "Approved", "Rejected", "Cancelled"],
        default: "Pending"
    },

    // Warden's recommendation step
    wardenApproval: {
        status: { type: String, enum: ["Pending", "Recommended", "Rejected"], default: "Pending" },
        note: String,
        by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        at: Date
    },

    // Admin's final decision step
    adminApproval: {
        status: { type: String, enum: ["Pending", "Approved", "Rejected"], default: "Pending" },
        note: String,
        by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        at: Date
    },

    // Filled in only once admin approves a Transfer — audit trail of
    // exactly where the student ended up.
    newRoom: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Room",
        default: null
    },
    newBedNo: Number

}, {
    timestamps: true
});

module.exports = mongoose.model("RoomRequest", roomRequestSchema);