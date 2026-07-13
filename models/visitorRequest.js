const mongoose = require("mongoose");

const visitorRequestSchema = new mongoose.Schema({

    student: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Student",
        required: true
    },

    visitorName: {
        type: String,
        required: true
    },

    visitorCNIC: {
        type: String,
        required: true
    },

    relation: {
        type: String,
        required: true
    },

    // Total headcount for the visit (primary visitor + anyone accompanying
    // them). Only the primary visitor's name/CNIC are recorded — keeps the
    // form simple while still letting a guest room request downstream know
    // how many people are actually coming.
    numberOfGuests: {
        type: Number,
        default: 1,
        min: 1,
        max: 3 // matches Guest Room's fixed capacity of 3
    },

    visitDate: {
        type: Date,
        required: true
    },

    visitTime: {
        type: String,
        default: ""
    },

    purpose: {
        type: String,
        default: ""
    },

    // Simple flow — no escalation, no admin step. Warden is the sole
    // approver here (unlike LeaveRequest's guardian-verification path).
    status: {
        type: String,
        enum: ["Pending", "Approved", "Rejected", "Cancelled"],
        default: "Pending"
    },

    wardenDecision: {
        note: String,
        by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        at: Date
    }

}, {
    timestamps: true
});

module.exports = mongoose.model("VisitorRequest", visitorRequestSchema);