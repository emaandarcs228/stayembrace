const mongoose = require('mongoose');

const wardenActivityLogSchema = new mongoose.Schema({

    // ── Who performed the action ─────────────────────────────────
    warden: {
        type     : mongoose.Schema.Types.ObjectId,
        ref      : 'User',
        required : true
    },

    wardenName: {
        type    : String,
        default : null
    },

    wardenUserId: {
        type    : String,
        default : null
    },

    // ── What action was performed ────────────────────────────────
    action: {
        type     : String,
        required : true,
        enum     : [
            'LOGIN',
            'LOGOUT',
            'ATTENDANCE_MARK',
            'ATTENDANCE_DISPUTE_RESOLVE',
            'LEAVE_APPROVE',
            'LEAVE_REJECT',
            'LEAVE_GUARDIAN_VERIFY',
            'COMPLAINT_STATUS_UPDATE',
            'ROOM_REQUEST_RECOMMEND',
            'ROOM_REQUEST_REJECT',
            'MESS_ORDER_STATUS_UPDATE',
            'MESS_CASH_RECEIVED',
            'LAUNDRY_STATUS_UPDATE',
            'LAUNDRY_CASH_RECEIVED',
            'MOBILE_LOAD_CASH_RECEIVED',
            'MOBILE_LOAD_COMPLETE',
            'MOBILE_LOAD_REJECT',
            'VISITOR_APPROVE',
            'VISITOR_REJECT',
            'NOTIFICATION_SEND',
            'PROFILE_UPDATE',
            'MESS_MENU_ADD',
            'MESS_MENU_ITEM_ADD',
            'MESS_MENU_ITEM_EDIT',
            'MESS_MENU_ITEM_DELETE',
            'MESS_MENU_PUBLISH'
        ]
    },

    // ── Human-readable description ───────────────────────────────
    description: {
        type    : String,
        default : ''
    },

    // ── Target entity (optional — what was acted upon) ──────────
    targetModel: {
        type    : String,
        default : null
    },

    targetId: {
        type    : mongoose.Schema.Types.ObjectId,
        default : null
    },

    // ── Related student info (if applicable) ─────────────────────
    relatedStudent: {
        type    : mongoose.Schema.Types.ObjectId,
        ref     : 'User',
        default : null
    },

    relatedStudentName: {
        type    : String,
        default : null
    },

    relatedStudentUserId: {
        type    : String,
        default : null
    },

    // ── Metadata ─────────────────────────────────────────────────
    details: {
        type    : mongoose.Schema.Types.Mixed,
        default : {}
    },

    ip: {
        type    : String,
        default : null
    }

}, {
    timestamps : true
});

// Index for efficient querying
wardenActivityLogSchema.index({ warden: 1, createdAt: -1 });
wardenActivityLogSchema.index({ action: 1, createdAt: -1 });
wardenActivityLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('WardenActivityLog', wardenActivityLogSchema);