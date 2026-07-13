// =====================================================================
// wardenController.js
// Handles all warden portal routes.
// Every handler attaches: warden (User doc), unreadCount, pendingCounts,
// recentNotifs — so the shared warden-header partial always has what it needs.
// =====================================================================

const User           = require('../models/user');
const Student        = require('../models/student');
const Attendance     = require('../models/attendance');
const LeaveRequest   = require('../models/leave');
const Complaint      = require('../models/complaint');
const FoodOrder      = require('../models/foodOrder');
const LaundryRequest = require('../models/laundry');
const MobileLoad     = require('../models/mobileLoad');
const Due            = require('../models/due');
const Payment        = require('../models/payment');
const Notification   = require('../models/notification');
const leaveActions   = require('../services/leaveActions');
const attendanceActions = require('../services/attendanceActions');
const complaintActions  = require('../services/complaintActions');
const visitorActions = require('../services/visitorActions');
const VisitorRequest  = require('../models/visitorRequest');
const messActions = require('../services/messActions');
const Menu     = require('../models/mess');
const MenuItem = require('../models/menuItem');
const MessLog  = require('../models/messDailyLog');
const laundryActions = require('../services/laundryActions');
const mobileLoadActions = require('../services/mobileLoadActions');

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

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

function currentGreeting() {
    const h = new Date().getHours();
    if (h < 12) return 'morning';
    if (h < 17) return 'afternoon';
    return 'evening';
}

async function buildBaseLocals(req) {
    const userId = req.user._id;

    const warden = await User.findById(userId).lean();
    if (!warden) throw new Error('Warden user not found');

    const unreadCount = await Notification.countDocuments({
        isActive : true,
        $or: [
            { target: { $in: ['All', 'Wardens'] }, readBy: { $nin: [userId] } },
            { recipient: userId, readBy: { $nin: [userId] } }
        ]
    });

    const recentNotifs = await Notification.find({
        isActive : true,
        $or: [
            { target: { $in: ['All', 'Wardens'] } },
            { recipient: userId }
        ]
    }).sort({ createdAt: -1 }).limit(5).lean();

    recentNotifs.forEach(n => { n._timeAgo = timeAgo(n.createdAt); });

    const today      = new Date();
    const todayStart = new Date(today); todayStart.setHours(0, 0, 0, 0);

    const pendingDisputes = await Attendance.countDocuments({
        notes : { $regex: /^\[DISPUTE\]/ }
    });

    const pendingLeaves = await LeaveRequest.countDocuments({ status: 'Pending' });

    const openComplaints = await Complaint.countDocuments({
        status: { $in: ['Submitted', 'Acknowledged', 'In Progress'] }
    });

    let pendingRoomRequests = 0;
    try {
        const RoomRequest = require('../models/roomRequest');
        pendingRoomRequests = await RoomRequest.countDocuments({
            'wardenApproval.status': 'Pending'
        });
    } catch (_) {}

    const activeMess = await FoodOrder.countDocuments({
        orderStatus: { $in: ['Pending', 'Accepted', 'Preparing'] }
    });

    const pendingMobileLoad = await MobileLoad.countDocuments({
        requestStatus: 'Pending'
    });
    
    const pendingVisitorRequests = await VisitorRequest.countDocuments({
        status: 'Pending' 
    });
    
    const currentWeek = laundryActions.getCurrentWeekKey();
    const opsPendingLaundry = await LaundryRequest.countDocuments({
        weekKey     : currentWeek,
        isChargeable: true,
        status      : { $nin: ['Delivered', 'Cancelled'] }
    });

    return {
        warden,
        unreadCount,
        recentNotifs,
        pendingDisputes,
        pendingLeaves,
        openComplaints,
        pendingRoomRequests,
        activeMess,
        pendingMobileLoad,
        pendingVisitorRequests,
        opsPendingLaundry
    };
}

// ─────────────────────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────────────────────
exports.getDashboard = async (req, res) => {
    try {
        const base = await buildBaseLocals(req);

        const today      = new Date();
        const todayStart = new Date(today); todayStart.setHours(0, 0, 0, 0);
        const todayEnd   = new Date(today); todayEnd.setHours(23, 59, 59, 999);

        const [attendanceIn, attendanceLate, attendanceMissed] = await Promise.all([
            Attendance.countDocuments({ date: { $gte: todayStart, $lte: todayEnd }, status: 'In' }),
            Attendance.countDocuments({ date: { $gte: todayStart, $lte: todayEnd }, status: 'Late' }),
            Attendance.countDocuments({ date: { $gte: todayStart, $lte: todayEnd }, status: 'Missed' })
        ]);

        const recentActivity = await Notification.find({
            isActive : true,
            $or: [
                { target: { $in: ['All', 'Wardens'] } },
                { recipient: req.user._id }
            ]
        }).sort({ createdAt: -1 }).limit(8).lean();

        recentActivity.forEach(n => { n._timeAgo = timeAgo(n.createdAt); });

        const pendingGuardianVerification = await LeaveRequest.countDocuments({
            status           : 'Pending',
            guardianVerified : false
        });
        
        const currentWeek = laundryActions.getCurrentWeekKey();
    const opsPendingLaundry = await LaundryRequest.countDocuments({
        weekKey     : currentWeek,
        isChargeable: true,
        status      : { $nin: ['Delivered', 'Cancelled'] }
    });

        res.render('warden/dashboard', {
            ...base,
            activePage          : 'dashboard',
            pageTitle           : 'Good ' + currentGreeting() + ', ' + base.warden.fullname.split(' ')[0],
            topbarGreeting      : 'Welcome back, ' + base.warden.fullname.split(' ')[0] + '!',
            pageSubtitle        : today.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
            showProfileDropdown : true,
            currentDate         : today.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
            currentGreeting     : currentGreeting(),
            opsPendingLaundry,
            stats: {
                attendanceIn,
                attendanceLate,
                attendanceMissed,
                pendingLeaves              : base.pendingLeaves,
                openComplaints             : base.openComplaints,
                activeMess                 : base.activeMess,
                pendingMobileLoad          : base.pendingMobileLoad,
                pendingRoomRequests        : base.pendingRoomRequests,
                pendingGuardianVerification
            },
            recentActivity,
            successMessage : req.query.success || null,
            errorMessage   : req.query.error   || null
        });
    } catch (err) {
        console.error('Warden getDashboard:', err);
        res.status(500).send('Server Error');
    }
};

// ─────────────────────────────────────────────────────────────
// ATTENDANCE
// ─────────────────────────────────────────────────────────────
exports.getAttendance = async (req, res) => {
    try {
        const base = await buildBaseLocals(req);

        const today      = new Date();
        const todayStart = new Date(today); todayStart.setHours(0, 0, 0, 0);
        const todayEnd   = new Date(today); todayEnd.setHours(23, 59, 59, 999);

        // Today's log
        const todayLog = await Attendance.find({
            date: { $gte: todayStart, $lte: todayEnd }
        })
        .populate({ path: 'student', populate: { path: 'user', select: 'fullname userId' } })
        .sort({ createdAt: -1 })
        .lean();

        // Dispute queue — ALL disputes including today's
        const disputes = await Attendance.find({
            notes: { $regex: /^\[DISPUTE\]/ }
        })
        .populate({ path: 'student', populate: { path: 'user', select: 'fullname userId' } })
        .sort({ date: -1 })
        .lean();

        disputes.forEach(d => {
            d._disputeReason = d.notes.replace('[DISPUTE] ', '');
        });

        // Not marked yet
        const markedStudentIds = todayLog
            .filter(r => r.student)
            .map(r => r.student._id.toString());

        const allActiveStudents = await Student.find({ hostelStatus: 'active' })
            .populate('user', 'fullname userId')
            .populate('room', 'roomNo block')
            .lean();

        const notMarked = allActiveStudents.filter(s =>
            !markedStudentIds.includes(s._id.toString())
        );

        // ── Monthly / Yearly overview ─────────────────────────────────
        const selectedYear  = parseInt(req.query.year  || today.getFullYear());
        const selectedMonth = parseInt(req.query.month || today.getMonth() + 1);
        const viewMode      = req.query.viewMode || 'monthly';
        const searchStudent = req.query.student  || '';

        const monthStart = new Date(selectedYear, selectedMonth - 1, 1);
        const monthEnd   = new Date(selectedYear, selectedMonth, 1);
        const yearStart  = new Date(selectedYear, 0, 1);
        const yearEnd    = new Date(selectedYear + 1, 0, 1);

        const dateRange = viewMode === 'yearly'
            ? { $gte: yearStart, $lt: yearEnd }
            : { $gte: monthStart, $lt: monthEnd };

        const monthlyRecords = await Attendance.find({ date: dateRange })
            .populate({ path: 'student', populate: { path: 'user', select: 'fullname userId' } })
            .sort({ student: 1, date: 1 })
            .lean();

        const studentMap = {};
        monthlyRecords.forEach(function(r) {
            if (!r.student || !r.student.user) return;
            const sid = r.student._id.toString();
            if (!studentMap[sid]) {
                studentMap[sid] = {
                    student : r.student,
                    records : [],
                    In      : 0,
                    Late    : 0,
                    Out     : 0,
                    Missed  : 0,
                    Leave   : 0
                };
            }
            studentMap[sid].records.push(r);
            if (studentMap[sid][r.status] !== undefined) studentMap[sid][r.status]++;
        });

        let monthlyStudents = Object.values(studentMap).map(function(entry) {
            const total   = entry.records.length;
            const present = entry.In + entry.Late;
            entry.total   = total;
            entry.present = present;
            entry.pct     = total > 0 ? Math.round((present / total) * 100) : 0;
            return entry;
        });

        if (searchStudent.trim()) {
            const q = searchStudent.trim().toLowerCase();
            monthlyStudents = monthlyStudents.filter(function(entry) {
                const name = entry.student?.user?.fullname?.toLowerCase() ?? '';
                const uid  = entry.student?.user?.userId?.toLowerCase()  ?? '';
                return name.includes(q) || uid.includes(q);
            });
        }

        monthlyStudents.sort(function(a, b) { return a.pct - b.pct; });

        res.render('warden/attendance', {
            ...base,
            activePage     : 'attendance',
            pageTitle      : 'Attendance',
            pageSubtitle   : 'Mark attendance & resolve disputes',
            todayLog,
            disputes,
            notMarked,
            monthlyStudents,
            selectedYear,
            selectedMonth,
            viewMode,
            searchStudent,
            todayDate      : today.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
            successMessage : req.query.success || null,
            errorMessage   : req.query.error   || null
        });
    } catch (err) {
        console.error('Warden getAttendance:', err);
        res.status(500).send('Server Error');
    }
};

// Search student by name or ID (AJAX)
exports.searchStudent = async (req, res) => {
    try {
        const q = req.query.q || '';
        if (!q || q.length < 2) return res.json({ student: null });

        const user = await User.findOne({
            role   : 'student',
            status : 'approved',
            $or: [
                { fullname : { $regex: q, $options: 'i' } },
                { userId   : { $regex: q, $options: 'i' } }
            ]
        }).lean();

        if (!user) return res.json({ student: null });

        const student = await Student.findOne({ user: user._id })
            .populate('room', 'roomNo block')
            .lean();

        if (!student) return res.json({ student: null });

        const today      = new Date();
        const todayStart = new Date(today); todayStart.setHours(0, 0, 0, 0);
        const todayEnd   = new Date(today); todayEnd.setHours(23, 59, 59, 999);

        const todayRecord = await Attendance.findOne({
            student : student._id,
            date    : { $gte: todayStart, $lte: todayEnd }
        }).lean();

        res.json({
            student: {
                _id      : student._id,
                fullname : user.fullname,
                userId   : user.userId,
                room     : student.room ? student.room.roomNo + ' (Block ' + student.room.block + ')' : 'Not assigned'
            },
            todayRecord : todayRecord || null
        });
    } catch (err) {
        console.error('searchStudent:', err);
        res.status(500).json({ error: 'Server error' });
    }
};

// POST /warden/attendance/mark
exports.markAttendance = async (req, res) => {
    try {
        const { studentId, status, notes } = req.body;
        const result = await attendanceActions.markAttendance(req.user, { studentId, status, notes });
        if (!result.ok) return res.redirect('/warden/attendance?error=' + encodeURIComponent(result.error));
        res.redirect('/warden/attendance?success=Attendance+marked+successfully.');
    } catch (err) {
        console.error('markAttendance:', err);
        res.redirect('/warden/attendance?error=Failed+to+mark+attendance.');
    }
};
// POST /warden/attendance/dispute/:id
exports.resolveDispute = async (req, res) => {
    try {
        const { action, newStatus, reason } = req.body;
        const result = await attendanceActions.resolveDispute(req.params.id, req.user, { action, newStatus, reason });
        if (!result.ok) return res.redirect('/warden/attendance?error=' + encodeURIComponent(result.error));
        res.redirect('/warden/attendance?success=Dispute+resolved.');
    } catch (err) {
        console.error('resolveDispute:', err);
        res.redirect('/warden/attendance?error=Failed+to+resolve+dispute.');
    }
};

// ─────────────────────────────────────────────────────────────
// LEAVE REQUESTS
// ─────────────────────────────────────────────────────────────

exports.getLeaveRequests = async (req, res) => {
    try {
        const base   = await buildBaseLocals(req);
        const filter = req.query.filter || 'all';

        let query = {};
        if (filter === 'pending')     query = { status: 'Pending', guardianVerified: false };
        if (filter === 'guardian')    query = { status: 'Pending', guardianVerified: true  };
        if (filter === 'approved')    query = { status: 'Approved' };
        if (filter === 'rejected')    query = { status: 'Rejected' };
        if (filter === 'unreachable') query = { status: 'Pending', guardianVerificationNotes: { $regex: /unreachable/i } };

        const leaves = await LeaveRequest.find(query)
            .populate({
                path    : 'student',
                select  : 'guardianName guardianRelation guardianContact emergencyContact',
                populate: {
                    path  : 'user',
                    select: 'fullname userId phoneNumber'
                }
            })
            .sort({ createdAt: -1 })
            .lean();

        const [
            allCount,
            pendingCount,
            guardianCount,
            approvedCount,
            rejectedCount,
            unreachableCount
        ] = await Promise.all([
            LeaveRequest.countDocuments({}),
            LeaveRequest.countDocuments({ status: 'Pending', guardianVerified: false }),
            LeaveRequest.countDocuments({ status: 'Pending', guardianVerified: true  }),
            LeaveRequest.countDocuments({ status: 'Approved' }),
            LeaveRequest.countDocuments({ status: 'Rejected' }),
            LeaveRequest.countDocuments({ status: 'Pending', guardianVerificationNotes: { $regex: /unreachable/i } })
        ]);

        res.render('warden/leaveRequests', {
            ...base,
            activePage   : 'leave',
            pageTitle    : 'Leave Requests',
            pageSubtitle : 'Verify guardians and approve or reject student leave',
            leaves,
            activeFilter : filter,
            counts: {
                all         : allCount,
                pending     : pendingCount,
                guardian    : guardianCount,
                approved    : approvedCount,
                rejected    : rejectedCount,
                unreachable : unreachableCount
            },
            successMessage : req.query.success || null,
            errorMessage   : req.query.error   || null
        });
    } catch (err) {
        console.error('getLeaveRequests:', err);
        res.status(500).send('Server Error');
    }
};

// NOTE: the actual state-change + notification logic now lives in
// services/leaveActions.js, shared with adminController.js, so warden
// and admin can never silently drift apart on leave-request behavior.
exports.markGuardianVerification = async (req, res) => {
    try {
        const { verificationStatus, notes } = req.body;
        const result = await leaveActions.verifyGuardian(req.params.id, req.user, { verificationStatus, notes });
        if (!result.ok) return res.redirect('/warden/leave-requests?error=' + encodeURIComponent(result.error));
        res.redirect('/warden/leave-requests?success=Guardian+verification+status+updated.');
    } catch (err) {
        console.error('markGuardianVerification:', err);
        res.redirect('/warden/leave-requests?error=Failed+to+update+verification.');
    }
};

exports.approveLeave = async (req, res) => {
    try {
        const { note } = req.body;
        // Wardens can never bypass guardian verification — that escape
        // hatch is admin-only (see adminController.js).
        const result = await leaveActions.approveLeave(req.params.id, req.user, {
            note,
            allowWithoutGuardianVerification: false
        });
        if (!result.ok) return res.redirect('/warden/leave-requests?error=' + encodeURIComponent(result.error));
        res.redirect('/warden/leave-requests?success=Leave+approved.');
    } catch (err) {
        console.error('approveLeave:', err);
        res.redirect('/warden/leave-requests?error=Failed+to+approve+leave.');
    }
};

exports.rejectLeave = async (req, res) => {
    try {
        const { reason } = req.body;
        const result = await leaveActions.rejectLeave(req.params.id, req.user, { reason });
        if (!result.ok) return res.redirect('/warden/leave-requests?error=' + encodeURIComponent(result.error));
        res.redirect('/warden/leave-requests?success=Leave+rejected.');
    } catch (err) {
        console.error('rejectLeave:', err);
        res.redirect('/warden/leave-requests?error=Failed+to+reject+leave.');
    }
};
// ─────────────────────────────────────────────────────────────
// COMPLAINTS
// ─────────────────────────────────────────────────────────────
exports.getComplaints = async (req, res) => {
    try {
        const base     = await buildBaseLocals(req);
        const category = req.query.category || 'all';
        const status   = req.query.status   || 'all';

        // Ragging/Harassment is admin-only end to end — never surfaced
        // to warden, not even as a locked row (see complaintActions.js).
        const query = { category: { $ne: 'Ragging/Harassment' } };
        if (category !== 'all') query.category = category;
        if (status   !== 'all') query.status   = status;

        const complaints = await Complaint.find(query)
            .populate({ path: 'student', populate: { path: 'user', select: 'fullname userId' } })
            .sort({ createdAt: -1 })
            .lean();

        complaints.forEach(c => {
            if (c.isAnonymous) {
                c.student = { user: { fullname: 'Anonymous', userId: '—' } };
            }
        });

        res.render('warden/complaints', {
            ...base,
            activePage     : 'complaints',
            pageTitle      : 'Complaints',
            pageSubtitle   : 'Review and resolve student complaints',
            complaints,
            activeCategory : category,
            activeStatus   : status,
            successMessage : req.query.success || null,
            errorMessage   : req.query.error   || null
        });
    } catch (err) {
        console.error('getComplaints:', err);
        res.status(500).send('Server Error');
    }
};

exports.updateComplaintStatus = async (req, res) => {
    try {
        const { newStatus, note } = req.body;
        const result = await complaintActions.updateStatus(req.params.id, req.user, { newStatus, note });
        if (!result.ok) return res.redirect('/warden/complaints?error=' + encodeURIComponent(result.error));
        res.redirect('/warden/complaints?success=Complaint+status+updated.');
    } catch (err) {
        console.error('updateComplaintStatus:', err);
        res.redirect('/warden/complaints?error=Failed+to+update+complaint.');
    }
};

// ─────────────────────────────────────────────────────────────
// ROOM REQUESTS
// ─────────────────────────────────────────────────────────────
exports.getRoomRequests = async (req, res) => {
    try {
        const base = await buildBaseLocals(req);

        let RoomRequest;
        try { RoomRequest = require('../models/roomRequest'); } catch (_) {
            return res.render('warden/roomRequests', {
                ...base,
                activePage     : 'room-requests',
                pageTitle      : 'Room Requests',
                pageSubtitle   : 'Transfer and vacate requests',
                requests       : [],
                modelMissing   : true,
                successMessage : null,
                errorMessage   : null
            });
        }

        const typeFilter   = req.query.type   || 'all';
        const statusFilter = req.query.status || 'all';

        const query = {};
        if (typeFilter   !== 'all') query.requestType              = typeFilter;
        if (statusFilter !== 'all') query['wardenApproval.status'] = statusFilter;

        const requests = await RoomRequest.find(query)
    .populate({ 
        path: 'student', 
        populate: [
            { path: 'user', select: 'fullname userId' },
            { path: 'room', select: 'roomNo block' }
        ]
    })
    .populate('preferredRoom', 'roomNo block floor')
    .sort({ createdAt: -1 })
    .lean();

        res.render('warden/roomRequests', {
            ...base,
            activePage     : 'room-requests',
            pageTitle      : 'Room Requests',
            pageSubtitle   : 'Transfer and vacate requests from students',
            requests,
            typeFilter,
            statusFilter,
            modelMissing   : false,
            successMessage : req.query.success || null,
            errorMessage   : req.query.error   || null
        });
    } catch (err) {
        console.error('getRoomRequests:', err);
        res.status(500).send('Server Error');
    }
};

exports.recommendRoomRequest = async (req, res) => {
    try {
        const { note } = req.body;
        const RoomRequest = require('../models/roomRequest');
        const rr = await RoomRequest.findById(req.params.id)
            .populate({ path: 'student', populate: { path: 'user', select: '_id' } });
        if (!rr) return res.redirect('/warden/room-Requests?error=Request+not+found.');

        rr.wardenApproval = { status: 'Recommended', note: note || '', by: req.user._id, at: new Date() };
        rr.status         = 'Warden Reviewed';
        await rr.save();

        try {
            const adminUser = await User.findOne({ role: 'admin' }).lean();
            if (adminUser) {
                await Notification.create({
                    title     : 'Room Request Recommended by Warden',
                    message   : `A ${rr.requestType} request has been recommended by the warden and needs your approval.`,
                    recipient : adminUser._id,
                    category  : 'Requests',
                    relatedTo : { model: 'RoomRequest', docId: rr._id },
                    createdBy : req.user._id,
                    priority  : 'High'
                });
            }
        } catch (_) {}

        res.redirect('/warden/room-requests?success=Request+recommended+to+admin.');
    } catch (err) {
        console.error('recommendRoomRequest:', err);
        res.redirect('/warden/room-requests?error=Failed+to+recommend.');
    }
};

exports.rejectRoomRequest = async (req, res) => {
    try {
        const { reason } = req.body;
        const RoomRequest = require('../models/roomRequest');
        const rr = await RoomRequest.findById(req.params.id)
            .populate({ path: 'student', populate: { path: 'user', select: '_id' } });
        if (!rr) return res.redirect('/warden/room-requests?error=Request+not+found.');

        rr.wardenApproval = { status: 'Rejected', note: reason || 'No reason provided.', by: req.user._id, at: new Date() };
        rr.status         = 'Rejected';
        await rr.save();

        try {
            await Notification.create({
                title     : 'Room Request Rejected',
                message   : `Your ${rr.requestType} request has been rejected by the warden. Reason: ${reason || 'No reason provided.'}`,
                recipient : rr.student.user._id,
                category  : 'Requests',
                relatedTo : { model: 'RoomRequest', docId: rr._id },
                createdBy : req.user._id
            });
        } catch (_) {}

        res.redirect('/warden/room-requests?success=Request+rejected.');
    } catch (err) {
        console.error('rejectRoomRequest:', err);
        res.redirect('/warden/room-requests?error=Failed+to+reject.');
    }
};

// ─────────────────────────────────────────────────────────────
// MESS ORDERS
// ─────────────────────────────────────────────────────────────
exports.getMessOrders = async (req, res) => {
    try {
        const base         = await buildBaseLocals(req);
        const statusFilter = req.query.status || 'active';
        const mealFilter   = req.query.meal   || 'all';

        let query = {};
        if (statusFilter === 'active') {
            query.orderStatus = { $in: ['Pending', 'Accepted', 'Preparing'] };
        } else if (statusFilter !== 'all') {
            query.orderStatus = statusFilter;
        }

        const orders = await FoodOrder.find(query)
            .populate({ path: 'student', populate: { path: 'user', select: 'fullname userId' } })
            .populate('items.menuItem', 'name price')
            .populate('due')
            .sort({ orderDate: -1 })
            .lean();

        res.render('warden/mess', {
            ...base,
            activePage     : 'mess',
            pageTitle      : 'Mess Orders',
            pageSubtitle   : 'Manage food orders and fulfillment',
            orders,
            statusFilter,
            mealFilter,
            successMessage : req.query.success || null,
            errorMessage   : req.query.error   || null
        });
    } catch (err) {
        console.error('getMessOrders:', err);
        res.status(500).send('Server Error');
    }
};

exports.updateMessStatus = async (req, res) => {
    try {
        const { newStatus } = req.body;
        const validStatuses = ['Accepted', 'Preparing', 'Delivered', 'Cancelled'];
        if (!validStatuses.includes(newStatus)) {
            return res.redirect('/warden/mess?error=Invalid+status.');
        }

        const order = await FoodOrder.findById(req.params.id)
            .populate({ path: 'student', populate: { path: 'user', select: '_id' } });
        if (!order) return res.redirect('/warden/mess?error=Order+not+found.');

        order.orderStatus = newStatus;
        order.handledBy   = req.user._id;
        await order.save();

        try {
            await Notification.create({
                title     : 'Mess Order Update',
                message   : `Your mess order is now: ${newStatus}.`,
                recipient : order.student.user._id,
                category  : 'Requests',
                relatedTo : { model: 'FoodOrder', docId: order._id },
                createdBy : req.user._id
            });
        } catch (_) {}

        res.redirect('/warden/mess?success=Order+status+updated.');
    } catch (err) {
        console.error('updateMessStatus:', err);
        res.redirect('/warden/mess?error=Failed+to+update+status.');
    }
};

exports.markMessCashReceived = async (req, res) => {
    try {
        const order = await FoodOrder.findById(req.params.id)
            .populate({ path: 'student', populate: { path: 'user', select: '_id' } });
        if (!order) return res.redirect('/warden/mess?error=Order+not+found.');

        const due = await Due.findOne({ sourceType: 'FoodOrder', sourceRef: order._id });
        if (due) {
            due.status     = 'Paid';
            due.paidAmount = due.amount;
            await due.save();

            // FIX: warden cash confirmations never created a Payment record,
            // so this money was invisible to admin's income stats and the
            // Payments table on feeM. Mirrors feeController.markDuePaid.
            await Payment.create({
                student      : order.student._id,
                paymentType  : due.dueType,
                paymentMethod: 'Cash',
                amount       : due.amount,
                status       : 'Verified',
                source       : 'Manual',
                verifiedBy   : req.user._id,
                verifiedAt   : new Date(),
                dues         : [due._id],
                remarks      : 'Cash collected by warden for mess order'
            });
        }

        try {
            await Notification.create({
                title     : 'Mess Payment Confirmed',
                message   : `Cash received for your mess order. Order is now being processed.`,
                recipient : order.student.user._id,
                category  : 'Payments',
                createdBy : req.user._id
            });
        } catch (_) {}

        res.redirect('/warden/mess?success=Cash+marked+as+received.');
    } catch (err) {
        console.error('markMessCashReceived:', err);
        res.redirect('/warden/mess?error=Failed+to+mark+cash+received.');
    }
};

// ─────────────────────────────────────────────────────────────
// LAUNDRY
// ─────────────────────────────────────────────────────────────
exports.getLaundryRequests = async (req, res) => {
    try {
        const base = await buildBaseLocals(req);
        const laundryData = await laundryActions.getLaundryPageData({ weekKey: req.query.week });

        res.render('warden/laundry', {
            ...base,
            activePage     : 'laundry',
            pageTitle      : 'Laundry',
            pageSubtitle   : 'Weekly pickup and delivery management',
            ...laundryData,
            successMessage : req.query.success || null,
            errorMessage   : req.query.error   || null
        });
    } catch (err) {
        console.error('getLaundryRequests:', err);
        res.status(500).send('Server Error');
    }
};

exports.updateLaundryStatus = async (req, res) => {
    try {
        const { newStatus } = req.body;
        const result = await laundryActions.updateStatus(req.params.id, req.user, { newStatus, allowOverride: false });
        if (!result.ok) return res.redirect('/warden/laundry?error=' + encodeURIComponent(result.error));
        res.redirect('/warden/laundry?success=Laundry+status+updated.&week=' + result.weekKey);
    } catch (err) {
        console.error('updateLaundryStatus:', err);
        res.redirect('/warden/laundry?error=Failed+to+update+status.');
    }
};

exports.markLaundryCashReceived = async (req, res) => {
    try {
        const result = await laundryActions.markCashReceived(req.params.id, req.user);
        if (!result.ok) return res.redirect('/warden/laundry?error=' + encodeURIComponent(result.error));
        res.redirect('/warden/laundry?success=Cash+marked+as+received.&week=' + result.weekKey);
    } catch (err) {
        console.error('markLaundryCashReceived:', err);
        res.redirect('/warden/laundry?error=Failed+to+mark+cash.');
    }
};

// ─────────────────────────────────────────────────────────────
// MOBILE LOAD
// ─────────────────────────────────────────────────────────────
exports.getMobileLoad = async (req, res) => {
    try {
        const base          = await buildBaseLocals(req);
        const statusFilter  = req.query.status  || 'all';
        const networkFilter = req.query.network || 'all';

        const query = {};
        if (statusFilter  !== 'all') query.requestStatus = statusFilter;
        if (networkFilter !== 'all') query.network        = networkFilter;

        const requests = await MobileLoad.find(query)
            .populate({ path: 'student', populate: { path: 'user', select: 'fullname userId' } })
            .populate('due')
            .sort({ createdAt: -1 })
            .lean();

        res.render('warden/mobileLoad', {
            ...base,
            activePage     : 'mobile-load',
            pageTitle      : 'Mobile Load',
            pageSubtitle   : 'Manage mobile balance top-up requests',
            requests,
            statusFilter,
            networkFilter,
            successMessage : req.query.success || null,
            errorMessage   : req.query.error   || null
        });
    } catch (err) {
        console.error('getMobileLoad:', err);
        res.status(500).send('Server Error');
    }
};

exports.markMobileLoadCashReceived = async (req, res) => {
    try {
        const result = await mobileLoadActions.markCashReceived(req.params.id, req.user, { allowOverride: false });
        if (!result.ok) return res.redirect('/warden/mobile-load?error=' + encodeURIComponent(result.error));
        res.redirect('/warden/mobile-load?success=Cash+marked+as+received.');
    } catch (err) {
        console.error('markMobileLoadCashReceived:', err);
        res.redirect('/warden/mobile-load?error=Failed+to+mark+cash.');
    }
};

exports.completeMobileLoad = async (req, res) => {
    try {
        const result = await mobileLoadActions.complete(req.params.id, req.user, { allowOverride: false });
        if (!result.ok) return res.redirect('/warden/mobile-load?error=' + encodeURIComponent(result.error));
        res.redirect('/warden/mobile-load?success=Mobile+load+completed.');
    } catch (err) {
        console.error('completeMobileLoad:', err);
        res.redirect('/warden/mobile-load?error=Failed+to+complete.');
    }
};

exports.rejectMobileLoad = async (req, res) => {
    try {
        const { reason } = req.body;
        const result = await mobileLoadActions.reject(req.params.id, req.user, { reason });
        if (!result.ok) return res.redirect('/warden/mobile-load?error=' + encodeURIComponent(result.error));
        res.redirect('/warden/mobile-load?success=Request+rejected.');
    } catch (err) {
        console.error('rejectMobileLoad:', err);
        res.redirect('/warden/mobile-load?error=Failed+to+reject.');
    }
};

// ─────────────────────────────────────────────────────────────
// NOTIFICATIONS
// ─────────────────────────────────────────────────────────────
exports.getNotifications = async (req, res) => {
    try {
        const base   = await buildBaseLocals(req);
        const userId = req.user._id;
        const tab    = req.query.tab || 'action';

        let query = {
            isActive : true,
            $or: [
                { target: { $in: ['All', 'Wardens'] } },
                { recipient: userId }
            ]
        };

        if (tab === 'action') {
            query.category = { $in: ['Requests', 'Payments'] };
        } else if (tab === 'general') {
            query.category = { $in: ['Announcements', 'General'] };
        }

        const notifications = await Notification.find(query)
            .sort({ createdAt: -1 })
            .lean();

        notifications.forEach(n => {
            n._isUnread = !n.readBy || !n.readBy.map(String).includes(String(userId));
            n._timeAgo  = timeAgo(n.createdAt);
        });

        res.render('warden/notifications', {
            ...base,
            activePage     : 'notifications',
            pageTitle      : 'Notifications',
            pageSubtitle   : 'Action required, general updates, and broadcasts',
            notifications,
            activeTab      : tab,
            successMessage : req.query.success || null,
            errorMessage   : req.query.error   || null
        });
    } catch (err) {
        console.error('getNotifications:', err);
        res.status(500).send('Server Error');
    }
};

exports.sendNotification = async (req, res) => {
    try {
        const { title, message, targetType, studentId } = req.body;
        if (!title || !message) {
            return res.redirect('/warden/notifications?error=Title+and+message+are+required.&tab=compose');
        }

        const notifData = {
            title,
            message,
            category  : 'Announcements',
            createdBy : req.user._id
        };

        if (targetType === 'individual' && studentId) {
            const studentDoc = await Student.findById(studentId).populate('user', '_id').lean();
            if (!studentDoc) return res.redirect('/warden/notifications?error=Student+not+found.&tab=compose');
            notifData.recipient = studentDoc.user._id;
        } else {
            notifData.target = 'Students';
        }

        await Notification.create(notifData);
        res.redirect('/warden/notifications?success=Notification+sent+successfully.');
    } catch (err) {
        console.error('sendNotification:', err);
        res.redirect('/warden/notifications?error=Failed+to+send+notification.');
    }
};

exports.markAllNotificationsRead = async (req, res) => {
    try {
        const userId = req.user._id;
        await Notification.updateMany(
            {
                isActive : true,
                readBy   : { $nin: [userId] },
                $or: [
                    { target: { $in: ['All', 'Wardens'] } },
                    { recipient: userId }
                ]
            },
            { $addToSet: { readBy: userId } }
        );
        res.json({ success: true });
    } catch (err) {
        console.error('markAllNotificationsRead:', err);
        res.status(500).json({ error: 'Server error' });
    }
};

// ─────────────────────────────────────────────────────────────
// UTILITY
// ─────────────────────────────────────────────────────────────
function getCurrentWeekKey(date = new Date()) {
    const d    = new Date(date);
    const day  = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const mon  = new Date(d.setDate(diff));
    const yr   = mon.getFullYear();
    const wk   = Math.ceil(((mon - new Date(yr, 0, 1)) / 86400000 + 1) / 7);
    return `${yr}-W${String(wk).padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────────
// VISITOR REQUESTS
// ─────────────────────────────────────────────────────────────

exports.getVisitorRequests = async (req, res) => {
    try {
        const base   = await buildBaseLocals(req);
        const filter = req.query.filter || 'all';

        let query = {};
        if (filter === 'pending')   query = { status: 'Pending' };
        if (filter === 'approved')  query = { status: 'Approved' };
        if (filter === 'rejected')  query = { status: 'Rejected' };
        if (filter === 'cancelled') query = { status: 'Cancelled' };

        const visitorRequests = await VisitorRequest.find(query)
            .populate({
                path    : 'student',
                select  : 'guardianName guardianRelation guardianContact',
                populate: { path: 'user', select: 'fullname userId phoneNumber' }
            })
            .sort({ createdAt: -1 })
            .lean();

        const [allCount, pendingCount, approvedCount, rejectedCount, cancelledCount] = await Promise.all([
            VisitorRequest.countDocuments({}),
            VisitorRequest.countDocuments({ status: 'Pending' }),
            VisitorRequest.countDocuments({ status: 'Approved' }),
            VisitorRequest.countDocuments({ status: 'Rejected' }),
            VisitorRequest.countDocuments({ status: 'Cancelled' })
        ]);

        res.render('warden/visitorRequests', {
            ...base,
            activePage   : 'visitors',
            pageTitle    : 'Visitor Requests',
            pageSubtitle : 'Approve or reject student visitor requests',
            visitorRequests,
            activeFilter : filter,
            counts: {
                all      : allCount,
                pending  : pendingCount,
                approved : approvedCount,
                rejected : rejectedCount,
                cancelled: cancelledCount
            },
            successMessage: req.query.success || null,
            errorMessage  : req.query.error   || null
        });
    } catch (err) {
        console.error('getVisitorRequests:', err);
        res.status(500).send('Server Error');
    }
};

// NOTE: the actual state-change + notification logic lives in
// services/visitorActions.js, shared with the (upcoming) admin-side
// guest booking review — mirrors the leaveActions.js pattern exactly.
exports.approveVisitorRequest = async (req, res) => {
    try {
        const { note } = req.body;
        const result = await visitorActions.approveVisitorRequest(req.params.id, req.user, { note });
        if (!result.ok) return res.redirect('/warden/visitor-requests?error=' + encodeURIComponent(result.error));
        res.redirect('/warden/visitor-requests?success=Visitor+request+approved.');
    } catch (err) {
        console.error('approveVisitorRequest:', err);
        res.redirect('/warden/visitor-requests?error=Failed+to+approve+request.');
    }
};

exports.rejectVisitorRequest = async (req, res) => {
    try {
        const { reason } = req.body;
        const result = await visitorActions.rejectVisitorRequest(req.params.id, req.user, { reason });
        if (!result.ok) return res.redirect('/warden/visitor-requests?error=' + encodeURIComponent(result.error));
        res.redirect('/warden/visitor-requests?success=Visitor+request+rejected.');
    } catch (err) {
        console.error('rejectVisitorRequest:', err);
        res.redirect('/warden/visitor-requests?error=Failed+to+reject+request.');
    }
};

// ─────────────────────────────────────────────────────────────
//Mess Orders
// ─────────────────────────────────────────────────────────────

exports.getMessOrders = async (req, res) => {
    try {
        const base          = await buildBaseLocals(req);
        const statusFilter  = req.query.status || 'active';
        const activeTab     = req.query.tab || 'orders';

        const messData = await messActions.buildMessPageData({ statusFilter });

        res.render('warden/mess', {
            ...base,
            activePage  : 'mess',
            pageTitle   : 'Mess',
            pageSubtitle: 'Manage orders and menu',
            statusFilter,
            activeTab,
            ...messData,
            successMessage: req.query.success || null,
            errorMessage  : req.query.error   || null
        });
    } catch (err) {
        console.error('getMessOrders:', err);
        res.status(500).send('Server Error');
    }
};

exports.updateMessStatus = async (req, res) => {
    try {
        const { newStatus } = req.body;
        const result = await messActions.updateOrderStatus(req.params.id, req.user, { newStatus, allowOverride: false });
        if (!result.ok) return res.redirect('/warden/mess?tab=orders&error=' + encodeURIComponent(result.error));
        res.redirect('/warden/mess?tab=orders&success=Order+status+updated.');
    } catch (err) {
        console.error('updateMessStatus:', err);
        res.redirect('/warden/mess?tab=orders&error=Failed+to+update+status.');
    }
};

exports.markMessCashReceived = async (req, res) => {
    try {
        const result = await messActions.markCashReceived(req.params.id, req.user);
        if (!result.ok) return res.redirect('/warden/mess?tab=orders&error=' + encodeURIComponent(result.error));
        res.redirect('/warden/mess?tab=orders&success=Cash+marked+as+received.');
    } catch (err) {
        console.error('markMessCashReceived:', err);
        res.redirect('/warden/mess?tab=orders&error=Failed+to+mark+cash+received.');
    }
};

exports.addMenu = async (req, res) => {
    try {
        const result = await messActions.addMenu(req.body.name);
        if (!result.ok) return res.redirect('/warden/mess?tab=addmenu&error=' + encodeURIComponent(result.error));
        res.redirect('/warden/mess?tab=addmenu&success=Meal+category+added.');
    } catch (err) {
        console.error('addMenu:', err);
        res.redirect('/warden/mess?tab=addmenu&error=Failed+to+add+meal+category.');
    }
};

exports.addMenuItem = async (req, res) => {
    try {
        const imagePath = req.file ? 'uploads/mess/' + req.file.filename : null;
        const result = await messActions.addMenuItem({ ...req.body, imagePath });
        if (!result.ok) return res.redirect('/warden/mess?tab=addmenu&error=' + encodeURIComponent(result.error));
        res.redirect('/warden/mess?tab=menu&success=Menu+item+added.');
    } catch (err) {
        console.error('addMenuItem:', err);
        res.redirect('/warden/mess?tab=addmenu&error=Failed+to+add+menu+item.');
    }
};

exports.editMenuItem = async (req, res) => {
    try {
        const imagePath = req.file ? 'uploads/mess/' + req.file.filename : null;
        const result = await messActions.editMenuItem(req.params.id, { ...req.body, imagePath });
        if (!result.ok) return res.redirect('/warden/mess?tab=menu&error=' + encodeURIComponent(result.error));
        res.redirect('/warden/mess?tab=menu&success=Item+updated.');
    } catch (err) {
        console.error('editMenuItem:', err);
        res.redirect('/warden/mess?tab=menu&error=Failed+to+update+item.');
    }
};

exports.deleteMenuItem = async (req, res) => {
    try {
        const result = await messActions.deleteMenuItem(req.params.id);
        if (!result.ok) return res.redirect('/warden/mess?tab=menu&error=' + encodeURIComponent(result.error));
        res.redirect('/warden/mess?tab=menu&success=Item+deleted.');
    } catch (err) {
        console.error('deleteMenuItem:', err);
        res.redirect('/warden/mess?tab=menu&error=Failed+to+delete+item.');
    }
};

exports.publishTodayMenu = async (req, res) => {
    try {
        const result = await messActions.publishTodayMenu(req.body.itemIds, req.user);
        if (!result.ok) return res.redirect('/warden/mess?tab=menu&error=' + encodeURIComponent(result.error));
        res.redirect('/warden/mess?tab=menu&success=' + encodeURIComponent("Today's menu published."));
    } catch (err) {
        console.error('publishTodayMenu:', err);
        res.redirect('/warden/mess?tab=menu&error=Failed+to+publish+menu.');
    }
};