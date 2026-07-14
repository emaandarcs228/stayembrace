// utils/sidebarBadges.js
const User             = require('../models/user');
const Notification     = require('../models/notification');
const Attendance       = require('../models/attendance');
const LeaveRequest     = require('../models/leave');
const Complaint        = require('../models/complaint');
const RoomRequest      = require('../models/roomRequest');
const VisitorRequest   = require('../models/visitorRequest');
const GuestRoomBooking = require('../models/guestRoomBooking');
const MobileLoad       = require('../models/mobileLoad');
const Payment          = require('../models/payment');
const Student          = require('../models/student');
const Allocation       = require('../models/allocation');

function timeAgo(date) {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1)  return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return hrs + 'h ago';
    const days = Math.floor(hrs / 24);
    if (days < 7)  return days + 'd ago';
    return new Date(date).toLocaleDateString();
}

// Call this ONCE inside every admin controller before res.render()
// and spread the result into your render locals: { ...badges, ... }
async function getSidebarBadges(user) {
    const [
        unreadCount,
        recentNotifsRaw,
        pendingApprovalsCount,
        pendingDriverCount,
        pendingPaymentsCount,
        opsPendingDisputes,
        opsEscalatedLeaves,
        opsStaleComplaints,
        opsPendingRoomRequests,
        opsPendingVisitors,
        opsPendingBookings,
        opsPendingMobileLoad,
        activeAllocStudentIds
    ] = await Promise.all([
        Notification.countDocuments({
            isActive: true,
            $or: [
                { target: { $in: ['All', 'Admins'] }, readBy: { $nin: [user._id] } },
                { recipient: user._id, readBy: { $nin: [user._id] } }
            ]
        }),
        Notification.find({
            isActive: true,
            $or: [
                { target: { $in: ['All', 'Admins'] } },
                { recipient: user._id }
            ]
        }).sort({ createdAt: -1 }).limit(5).lean(),
        User.countDocuments({ role: 'student', status: 'pending' }),
        User.countDocuments({ role: 'driver', status: 'pending' }),
        Payment.countDocuments({ status: { $in: ['Pending', 'Cash Received'] } }),
        Attendance.countDocuments({ notes: { $regex: /^\[DISPUTE\]/ } }),
        LeaveRequest.countDocuments({
            status: 'Pending',
            $or: [
                { guardianVerificationNotes: { $regex: /unreachable/i } },
                { createdAt: { $lte: new Date(Date.now() - 24 * 3600000) } }
            ]
        }),
        Complaint.countDocuments({
            status: { $in: ['Submitted', 'Acknowledged', 'In Progress'] },
            expectedResolutionDate: { $lte: new Date() }
        }),
        RoomRequest.countDocuments({ 'wardenApproval.status': 'Recommended', status: 'Warden Reviewed' }),
        VisitorRequest.countDocuments({ status: 'Pending' }),
        GuestRoomBooking.countDocuments({ status: 'Pending' }),
        MobileLoad.countDocuments({ requestStatus: 'Pending' }),
        Allocation.distinct('student', { status: 'Active' })
    ]);

    const unassignedStudentsCount = await Student.countDocuments({
        _id: { $nin: activeAllocStudentIds }
    });

    const recentNotifs = recentNotifsRaw.map(n => {
        n._timeAgo = timeAgo(n.createdAt);
        return n;
    });

    return {
        unreadCount,
        recentNotifs,
        pendingApprovalsCount: pendingApprovalsCount + pendingDriverCount,
        pendingPaymentsCount: pendingPaymentsCount,
        opsPendingDisputes,
        opsEscalatedLeaves,
        opsStaleComplaints,
        opsPendingRoomRequests,
        opsPendingGuestBookings: opsPendingVisitors + opsPendingBookings,
        opsPendingMobileLoad,
        unassignedStudentsCount
    };
}

module.exports = { getSidebarBadges, timeAgo };