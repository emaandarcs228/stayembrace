const mongoose = require('mongoose');

const leaveRequestSchema = new mongoose.Schema({

    // ── Foreign Key → Student ──────────────────────────────────────────
    student: {
        type     : mongoose.Schema.Types.ObjectId,
        ref      : 'Student',
        required : true
    },

    // ── Leave Type ─────────────────────────────────────────────────────
    // Home / Local: 3-day advance rule applies.
    // Medical: same-day allowed.
    // Emergency: same-day allowed but full warden + guardian approval
    //            still required (no shortcut).
    leaveType: {
        type     : String,
        enum     : ['Home', 'Local', 'Medical', 'Emergency'],
        required : true
    },

    // ── Leave Details ──────────────────────────────────────────────────
    fromDate: {
        type     : Date,
        required : true
    },

    toDate: {
        type     : Date,
        required : true
    },

    reason: {
        type     : String,
        required : true
    },

    destination: {
        type    : String,
        default : 'Home'
    },

    // ── Emergency Contact (student-provided, could differ from guardian) ──
    emergencyContact: {
        type     : String,
        required : true
    },

    // ── Applied At (for 3-day rule check) ──────────────────────────────
    appliedAt: {
        type    : Date,
        default : Date.now
    },

    // ── Guardian Verification ──────────────────────────────────────────
    guardianVerified: {
        type    : Boolean,
        default : false
    },

    guardianVerifiedAt: {
        type    : Date,
        default : null
    },

    guardianVerificationNotes: {
        type    : String,
        default : null
    },

    guardianConfirmedBy: {
        type    : mongoose.Schema.Types.ObjectId,
        ref     : 'User',   // Warden who called / confirmed
        default : null
    },

    // ── Warden Approval ────────────────────────────────────────────────
    status: {
        type    : String,
        enum    : ['Pending', 'Approved', 'Rejected', 'Cancelled'],
        default : 'Pending'
    },

    approvedBy: {
        type    : mongoose.Schema.Types.ObjectId,
        ref     : 'User',
        default : null
    },

    approvedAt: {
        type    : Date,
        default : null
    },

    rejectionReason: {
        type    : String,
        default : null
    },

    // ── Return Tracking ────────────────────────────────────────────────
    returnDate: {
        type    : Date,
        default : null
    },

    returnConfirmed: {
        type    : Boolean,
        default : false
    },

    returnConfirmedBy: {
        type    : mongoose.Schema.Types.ObjectId,
        ref     : 'User',
        default : null
    },

    remarks: {
        type    : String,
        default : null
    },

    // ── Escalation notification gate ────────────────────────────────────
    // Set the FIRST time admin is sent a High-priority escalation
    // notification for this leave — whether triggered by the
    // guardian-unreachable event (leaveActions.verifyGuardian) or by
    // the 24h-timeout job (jobs/leaveEscalationJob.js). Shared by both
    // paths so a leave that goes unreachable AND then also crosses 24h
    // only ever pings admin once, not twice.
    escalationNotifiedAt: {
        type    : Date,
        default : null
    }

}, { timestamps: true });


// ── Virtual: Check if applied less than 3 days before leave starts ──
// Medical and Emergency are exempt from the 3-day rule.
leaveRequestSchema.virtual('isLate').get(function () {
    if (this.leaveType === 'Medical' || this.leaveType === 'Emergency') return false;
    const daysDiff = Math.ceil(
        (this.fromDate - this.appliedAt) / (1000 * 60 * 60 * 24)
    );
    return daysDiff < 3;
});

// ── Virtual: Whether guardian verification is still pending ────────
leaveRequestSchema.virtual('needsGuardianVerification').get(function () {
    return this.status === 'Pending' && !this.guardianVerified;
});

leaveRequestSchema.index({ status: 1, escalationNotifiedAt: 1, createdAt: 1 });

module.exports = mongoose.model('LeaveRequest', leaveRequestSchema);