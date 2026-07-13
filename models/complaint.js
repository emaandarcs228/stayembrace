const mongoose = require('mongoose');

const complaintSchema = new mongoose.Schema({

    student: {
        type     : mongoose.Schema.Types.ObjectId,
        ref      : 'Student',
        required : true
    },

    subject: {
        type     : String,
        required : true
    },

    description: {
        type     : String,
        required : true
    },

    // ── Category ───────────────────────────────────────────────────────
    // 'Ragging / Harassment' allows anonymous submission.
    // 'Maintenance' requires a photo attachment.
    // 'Other' opens a free-text field (covered by the description field).
    category: {
        type    : String,
        enum    : [
            'Maintenance',
            'Mess',
            'Laundry',
            'Roommate Issue',
            'Cleanliness',
            'Ragging/Harassment',
            'Other'
        ],
        default : 'Other'
    },

    // ── Anonymous flag ─────────────────────────────────────────────────
    // Only meaningful for 'Ragging / Harassment' category.
    // When true, the student's identity is hidden from the warden.
    isAnonymous: {
        type    : Boolean,
        default : false
    },

    // ── Attachment ─────────────────────────────────────────────────────
    // Required for Maintenance complaints; optional for others.
    // Stores the uploaded file path / URL.
    attachment: {
        type    : String,
        default : null
    },

    priority: {
        type    : String,
        enum    : ['Low', 'Medium', 'High', 'Urgent'],
        default : 'Medium'
    },

    // ── Status — 4-stage tracking ──────────────────────────────────────
    status: {
        type    : String,
        enum    : ['Submitted', 'Acknowledged', 'In Progress', 'Resolved'],
        default : 'Submitted'
    },

    // ── SLA / expected resolution deadline ────────────────────────────
    // Set by the system or warden based on category SLA rules.
    // Shown to the student so they know when to expect resolution.
    expectedResolutionDate: {
        type    : Date,
        default : null
    },

    adminResponse: {
        type    : String,
        default : null
    },

    handledBy: {
        type    : mongoose.Schema.Types.ObjectId,
        ref     : 'User',   // Warden
        default : null
    },

    resolvedAt: {
        type    : Date,
        default : null
    }

}, { timestamps: true });

module.exports = mongoose.model('Complaint', complaintSchema);