const mongoose = require("mongoose");

const roomSchema = new mongoose.Schema({

    roomNo: {
        type: String,
        required: true,
        unique: true
    },

    block: {
        type: String,
        enum: ["A", "B", "C"],
        required: true
    },

    floor: {
        type: Number,
        required: true
    },

    capacity: {
        type: Number,
        required: true,
        default: 2
    },

    occupiedBeds: {
        type: Number,
        default: 0
    },

    roomType: {
        type: String,
        enum: ["Single", "Double", "Triple"],
        default: "Double"
    },

    roomCategory: {
        type: String,
        enum: ["Student", "Guest"],
        default: "Student"
    },
    
    monthlyFee: {
        type: Number,
        default: 0
    },

    feePerNight: {
        type: Number,
        default: 0
    },
    
    status: {
        type: String,
        enum: [
            "Available",
            "Occupied",
            "Maintenance"
        ],
        default: "Available"
    },

    description: String

}, {
    timestamps: true
});

module.exports = mongoose.model("Room", roomSchema);