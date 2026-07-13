const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema({

    // ── Foreign Key → User ──────────────────────────────────────────
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true          // one Student document per User
    },

    // ── Academic ────────────────────────────────────────────────────
    department: {
        type: String,
        default: null
    },

    institution: {
        type: String,
        default: null
    },

    admissionDate: {
        type: Date,
        default: null
    },

    // ── Identity ────────────────────────────────────────────────────
    cnic: {
        type: String,
        default: null
    },

    bloodGroup: {
        type: String,
        enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', null],
        default: null
    },

    homeAddress: {
        type: String,
        default: null
    },

    emergencyContact: {
        type: String,
        default: null
    },

    // ── Guardian ────────────────────────────────────────────────────
    guardianName: {
        type: String,
        default: null
    },

    guardianContact: {
        type: String,
        default: null
    },

    guardianRelation: {
        type: String,
        default: null
    },

    // ── Hostel ──────────────────────────────────────────────────────
    // room will be linked once Room model exists
    room: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Room',
        default: null
    },
    
    currentAllocation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Allocation"
    },
    
    hostelStatus: {
        type: String,
        enum: ['active', 'inactive', 'suspended'],
        default: 'active'
    }

}, { timestamps: true });

module.exports = mongoose.model('Student', studentSchema);