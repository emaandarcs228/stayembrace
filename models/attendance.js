const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
    student: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Student',
        required: true
    },
    date: {
        type: Date,
        required: true,
        default: Date.now
    },
    status: {
        type: String,
        enum: ['In', 'Out', 'Late', 'Leave', 'Missed'],
        required: true
    },
    entryTime: {
        type: Date,
        default: null
    },
    exitTime: {
        type: Date,
        default: null
    },
    recordedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User', // Warden (or original marker — never overwritten by dispute resolution)
        required: true
    },
    notes: {
        type: String,
        default: null
    },

    // ── Dispute lifecycle (added for admin oversight) ──────────────
    // Set when a student raises a dispute (studentController.postAttendanceDispute).
    // Reliable even after resolution, unlike relying on updatedAt.
    disputeRaisedAt: {
        type: Date,
        default: null
    },
    // Who resolved the dispute — warden or admin. Kept separate from
    // recordedBy so the audit trail shows both who marked attendance
    // AND who settled the dispute over it.
    resolvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    resolvedAt: {
        type: Date,
        default: null
    },
    // Gates jobs/attendanceEscalationJob.js so a dispute is only ever
    // escalated to admin once per open-dispute window.
    escalationNotifiedAt: {
        type: Date,
        default: null
    },

    isDisputed: {
        type: Boolean,
        default: false
    }

}, { timestamps: true });

// Index for quick queries
attendanceSchema.index({ student: 1, date: -1 });

// ── index for attendanceEscalationJob ──────────────────────────
attendanceSchema.index({ isDisputed: 1, escalationNotifiedAt: 1, disputeRaisedAt: 1 });

module.exports = mongoose.model('Attendance', attendanceSchema);