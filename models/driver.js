const mongoose = require('mongoose');

const driverSchema = new mongoose.Schema({

    // ── Foreign Key → User ──────────────────────────────────────────
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },

    // ── Identity ────────────────────────────────────────────────────
    cnic: {
        type: String,
        default: null
    },

    // ── License ─────────────────────────────────────────────────────
    licenseNumber: {
        type: String,
        default: null
    },

    licenseExpiry: {
        type: Date,
        default: null
    },

    // ── Vehicle ─────────────────────────────────────────────────────
    vehicleType: {
        type: String,
        enum: ['car', 'van', 'bus', 'rickshaw', 'motorcycle', 'other'],
        default: null
    },

    vehicleRegistration: {
        type: String,
        default: null
    },

    vehicleModel: {
        type: String,
        default: null
    },

    // ── Professional ────────────────────────────────────────────────
    serviceArea: {
        type: String,
        default: null
    },

    experienceYears: {
        type: Number,
        default: null
    },

    // ── Documents ───────────────────────────────────────────────────
    // CNIC front image
    cnicFrontImage: {
        type: String,
        default: null
    },

    // CNIC back image
    cnicBackImage: {
        type: String,
        default: null
    },

    // Driving license image
    licenseImage: {
        type: String,
        default: null
    },

    // Vehicle registration document image
    vehicleDocImage: {
        type: String,
        default: null
    },

    // ── Status ──────────────────────────────────────────────────────
    isVerified: {
        type: Boolean,
        default: false
    },

    isActive: {
        type: Boolean,
        default: true
    }

}, { timestamps: true });

module.exports = mongoose.model('Driver', driverSchema);
