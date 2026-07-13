const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({

    title: {
        type     : String,
        required : true
    },

    message: {
        type     : String,
        required : true
    },

    // ── Delivery mode: broadcast OR individual ─────────────────────────
    // Use EITHER target (broadcast) OR recipient (individual) — not both.
    //
    // target     → general announcements sent to a role group
    //              (e.g. "Mess closed today" to all Students)
    // recipient  → per-student event notifications
    //              (e.g. "Your leave request was approved")

    // Broadcast target — ignored when recipient is set
    target: {
        type    : String,
        enum    : ['All', 'Students', 'Wardens', 'Admins', null],
        default : null
    },

    // Individual recipient — takes priority over target
    recipient: {
        type    : mongoose.Schema.Types.ObjectId,
        ref     : 'User',
        default : null
    },

    // ── Category — maps to sidebar tabs in the student portal ─────────
    category: {
        type    : String,
        enum    : ['Payments', 'Requests', 'Announcements', 'General'],
        default : 'General'
    },

    // ── Deep-link reference ───────────────────────────────────────────
    // Points to the source document (LeaveRequest, Complaint, FoodOrder,
    // etc.) so tapping the notification navigates to the relevant record.
    relatedTo: {
        model : {
            type    : String,
            enum    : [
                'LeaveRequest',
                'Complaint',
                'FoodOrder',
                'LaundryRequest',
                'MobileLoad',
                'Payment',
                'Due',
                'Fine',
                'RoomRequest',
                'VisitorRequest',
                'GuestRoomBooking',
                'Attendance'
            ],
            default : null
        },
        docId : {
            type    : mongoose.Schema.Types.ObjectId,
            default : null
        }
    },

    priority: {
        type    : String,
        enum    : ['Low', 'Medium', 'High'],
        default : 'Medium'
    },

    // Tracks which users have read this notification
    readBy: [{
        type : mongoose.Schema.Types.ObjectId,
        ref  : 'User'
    }],

    createdBy: {
        type     : mongoose.Schema.Types.ObjectId,
        ref      : 'User',
        required : true
    },

    expiresAt: {
        type    : Date,
        default : null
    },

    isActive: {
        type    : Boolean,
        default : true
    }

}, { timestamps: true });

module.exports = mongoose.model('Notification', notificationSchema);