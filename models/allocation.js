const mongoose = require("mongoose");

const allocationSchema = new mongoose.Schema({

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

    allocatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
    },

    bedNo: {
        type: Number
    },

    allocationDate: {
        type: Date,
        default: Date.now
    },

    vacatedDate: Date,

    status: {
        type: String,
        enum: [
            "Active",
            "Vacated",
            "Transferred"
        ],
        default: "Active"
    },

    remarks: String

}, {
    timestamps: true
});

// ── Index for hostelFeeJob (filters by status) ──────────────────
allocationSchema.index({ status: 1 });

module.exports = mongoose.model("Allocation",allocationSchema);