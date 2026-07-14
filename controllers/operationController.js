// =====================================================================
// operationController.js
//
// Handles the admin "Operations Oversight" pages — where admin views
// and can override warden-handled operations (leave, and eventually
// attendance, complaints, room requests, mess, laundry, mobile load —
// following the same pattern as they're added).
//
// Kept separate from adminController.js on purpose: adminController.js
// owns student approvals, user management, and admin's own profile;
// this file owns the warden-oversight surface. The two never overlap.
//
// The actual state-change + notification logic for each domain lives
// in services/<domain>Actions.js, shared with the corresponding
// wardenController.js functions, so warden and admin behavior can
// never silently drift apart.
// =====================================================================

const LeaveRequest        = require('../models/leave');
const Attendance          = require('../models/attendance');
const Notification        = require('../models/notification');
const leaveActions        = require('../services/leaveActions');
const attendanceActions   = require('../services/attendanceActions');
const User                = require('../models/user');
const Student             = require('../models/student');
const Complaint           = require('../models/complaint');
const complaintActions    = require('../services/complaintActions');
const RoomRequest         = require('../models/roomRequest');
const Room                = require('../models/room');
const roomRequestActions  = require('../services/roomRequestActions');
const GuestRoomBooking    = require('../models/guestRoomBooking');
const guestBookingActions = require('../services/guestBookingActions');
const messActions         = require('../services/messActions');
const VisitorRequest      = require('../models/visitorRequest');
const visitorActions      = require('../services/visitorActions');
const laundryActions      = require('../services/laundryActions');
const MobileLoad       = require('../models/mobileLoad');
const mobileLoadActions = require('../services/mobileLoadActions');
const { getSidebarBadges } = require('../utils/sidebarBadges');
const CabBooking          = require('../models/cabBooking');
const Student             = require('../models/student');
const sendCabBookingEmail = require('../utils/sendCabBookingEmail');

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

// Shared locals every operations-oversight page needs (topbar bell,
// admin user, etc.) — same shape as adminController's own dashboard
// locals, kept here so this file has no dependency on adminController.js.
async function buildAdminOpsLocals(req) {
    const user = req.user;

    const unreadCount = await Notification.countDocuments({
        isActive: true,
        $or: [
            { target: { $in: ['All', 'Admins'] }, readBy: { $nin: [user._id] } },
            { recipient: user._id, readBy: { $nin: [user._id] } }
        ]
    });

    const recentNotifs = await Notification.find({
        isActive: true,
        $or: [
            { target: { $in: ['All', 'Admins'] } },
            { recipient: user._id }
        ]
    }).sort({ createdAt: -1 }).limit(5).lean();
    recentNotifs.forEach(n => { n._timeAgo = timeAgo(n.createdAt); });

    // ── Sidebar badge counts — needed on every ops page since header is shared ──
    const opsPendingVisitors = await VisitorRequest.countDocuments({ status: 'Pending' });
    const opsPendingBookings = await GuestRoomBooking.countDocuments({ status: 'Pending' });
    const opsPendingGuestBookings = opsPendingVisitors + opsPendingBookings;

    const opsPendingRoomRequests = await RoomRequest.countDocuments({
        'wardenApproval.status': 'Recommended',
        status: 'Warden Reviewed'
    });

    return { user, unreadCount, recentNotifs, opsPendingGuestBookings, opsPendingRoomRequests };
}
// ═══════════════════════════════════════════════════════════════════
// LEAVE MANAGEMENT
// Route: /admin/operations/leave (matches the nav item already
// scaffolded in admin-header.ejs — activePage 'ops-leave', badge
// wired to opsEscalatedLeaves).
//
// Admin sees everything the warden sees, can act on requests the
// warden hasn't touched yet, and can override any decision a warden
// already made.
// ═══════════════════════════════════════════════════════════════════
exports.getLeaveRequests = async (req, res) => {
    try {
        const base   = await buildAdminOpsLocals(req);
        const filter = req.query.filter || 'all';

        let query = {};
        if (filter === 'pending')   query = { status: 'Pending', guardianVerified: false };
        if (filter === 'guardian')  query = { status: 'Pending', guardianVerified: true  };
        if (filter === 'approved')  query = { status: 'Approved' };
        if (filter === 'rejected')  query = { status: 'Rejected' };
        if (filter === 'escalated') query = {
            status: 'Pending',
            $or: [
                { guardianVerificationNotes: { $regex: /unreachable/i } },
                { createdAt: { $lte: new Date(Date.now() - 24 * 3600000) } }
            ]
        };
        const badges = await getSidebarBadges(req.user);

        const leaves = await LeaveRequest.find(query)
            .populate({
                path    : 'student',
                select  : 'guardianName guardianRelation guardianContact emergencyContact',
                populate: { path: 'user', select: 'fullname userId phoneNumber' }
            })
            .populate('approvedBy', 'fullname role')
            .populate('guardianConfirmedBy', 'fullname role')
            .sort({ createdAt: -1 })
            .lean();

        const [allCount, pendingCount, guardianCount, approvedCount, rejectedCount, escalatedCount] = await Promise.all([
            LeaveRequest.countDocuments({}),
            LeaveRequest.countDocuments({ status: 'Pending', guardianVerified: false }),
            LeaveRequest.countDocuments({ status: 'Pending', guardianVerified: true  }),
            LeaveRequest.countDocuments({ status: 'Approved' }),
            LeaveRequest.countDocuments({ status: 'Rejected' }),
            LeaveRequest.countDocuments({
                status: 'Pending',
                $or: [
                    { guardianVerificationNotes: { $regex: /unreachable/i } },
                    { createdAt: { $lte: new Date(Date.now() - 24 * 3600000) } }
                ]
            })
        ]);

        res.render('admin/leaveRequests', {
            ...base,
            activePage  : 'ops-leave',
            pageTitle   : 'Leave Management',
            pageSubtitle: 'View, verify, and override warden decisions on student leave',
            ...badges,
            opsEscalatedLeaves: escalatedCount,
            leaves,
            activeFilter: filter,
            counts: {
                all      : allCount,
                pending  : pendingCount,
                guardian : guardianCount,
                approved : approvedCount,
                rejected : rejectedCount,
                escalated: escalatedCount
            },
            successMessage: req.query.success || null,
            errorMessage  : req.query.error   || null
        });
    } catch (err) {
        console.error('operationController getLeaveRequests:', err);
        res.status(500).send('Server Error');
    }
};

exports.markGuardianVerification = async (req, res) => {
    try {
        const { verificationStatus, notes } = req.body;
        const result = await leaveActions.verifyGuardian(req.params.id, req.user, { verificationStatus, notes });
        if (!result.ok) return res.redirect('/admin/operations/leave?error=' + encodeURIComponent(result.error));
        res.redirect('/admin/operations/leave?success=Guardian+verification+status+updated.');
    } catch (err) {
        console.error('operationController markGuardianVerification:', err);
        res.redirect('/admin/operations/leave?error=Failed+to+update+verification.');
    }
};

// Admin-only: overrideGuardian=on lets admin approve even if the
// guardian was never verified — the full-supervisor escape hatch.
// Wardens can never do this (see wardenController.js).
exports.approveLeave = async (req, res) => {
    try {
        const { note, overrideGuardian } = req.body;
        const result = await leaveActions.approveLeave(req.params.id, req.user, {
            note,
            allowWithoutGuardianVerification: overrideGuardian === 'on'
        });
        if (!result.ok) return res.redirect('/admin/operations/leave?error=' + encodeURIComponent(result.error));
        res.redirect('/admin/operations/leave?success=Leave+approved.');
    } catch (err) {
        console.error('operationController approveLeave:', err);
        res.redirect('/admin/operations/leave?error=Failed+to+approve+leave.');
    }
};

exports.rejectLeave = async (req, res) => {
    try {
        const { reason } = req.body;
        const result = await leaveActions.rejectLeave(req.params.id, req.user, { reason });
        if (!result.ok) return res.redirect('/admin/operations/leave?error=' + encodeURIComponent(result.error));
        res.redirect('/admin/operations/leave?success=Leave+rejected.');
    } catch (err) {
        console.error('operationController rejectLeave:', err);
        res.redirect('/admin/operations/leave?error=Failed+to+reject+leave.');
    }
};

// ═══════════════════════════════════════════════════════════════════
// ATTENDANCE MANAGEMENT
// Route: /admin/operations/attendance (matches nav item already
// scaffolded — activePage 'ops-attendance', badge opsPendingDisputes).
//
// Three tabs: Today's Log (read-only — full context, mirrors what
// warden sees), Disputes (ALL statuses, not just pending — admin can
// override an already-resolved dispute), Monthly Overview (read-only
// trend view, same shape as warden's).
//
// No markAttendance access here on purpose — admin's job is oversight
// and appeal, not routine daily marking. See attendanceActions.js for
// why.
// ═══════════════════════════════════════════════════════════════════
exports.getAttendance = async (req, res) => {
    try {
        const base = await buildAdminOpsLocals(req);

        const today      = new Date();
        const todayStart = new Date(today); todayStart.setHours(0, 0, 0, 0);
        const todayEnd   = new Date(today); todayEnd.setHours(23, 59, 59, 999);

        // ── Today's Log (read-only) ─────────────────────────────────
        const todayLog = await Attendance.find({
            date: { $gte: todayStart, $lte: todayEnd }
        })
        .populate({ path: 'student', populate: { path: 'user', select: 'fullname userId' } })
        .populate('recordedBy', 'fullname')
        .sort({ createdAt: -1 })
        .lean();

        // ── Disputes — ALL statuses ─────────────────────────────────
        const disputes = await Attendance.find({
            notes: { $regex: /(\[DISPUTE\]|Corrected by warden|Dispute rejected)/ }
        })
        .populate({ path: 'student', populate: { path: 'user', select: 'fullname userId' } })
        .populate('recordedBy', 'fullname')
        .populate('resolvedBy', 'fullname')
        .sort({ date: -1 })
        .lean();

        disputes.forEach(d => {
            if (d.notes.startsWith('[DISPUTE]')) {
                d._disputeStatus = 'Pending';
                d._disputeReason = d.notes.replace('[DISPUTE] ', '');
            } else if (d.notes.includes('Corrected by warden')) {
                d._disputeStatus = 'Accepted';
            } else if (d.notes.startsWith('Dispute rejected')) {
                d._disputeStatus = 'Rejected';
                d._rejectReason  = d.notes.replace('Dispute rejected: ', '');
            }
        });

        const pendingDisputeCount = disputes.filter(d => d._disputeStatus === 'Pending').length;

        // ── Monthly / Yearly Overview (read-only) ─────────────────────
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
        monthlyRecords.forEach(r => {
            if (!r.student || !r.student.user) return;
            const sid = r.student._id.toString();
            if (!studentMap[sid]) {
                studentMap[sid] = { student: r.student, records: [], In: 0, Late: 0, Out: 0, Missed: 0, Leave: 0 };
            }
            studentMap[sid].records.push(r);
            if (studentMap[sid][r.status] !== undefined) studentMap[sid][r.status]++;
        });

        let monthlyStudents = Object.values(studentMap).map(entry => {
            const total   = entry.records.length;
            const present = entry.In + entry.Late;
            entry.total   = total;
            entry.present = present;
            entry.pct     = total > 0 ? Math.round((present / total) * 100) : 0;
            return entry;
        });

        if (searchStudent.trim()) {
            const q = searchStudent.trim().toLowerCase();
            monthlyStudents = monthlyStudents.filter(entry => {
                const name = entry.student?.user?.fullname?.toLowerCase() ?? '';
                const uid  = entry.student?.user?.userId?.toLowerCase()  ?? '';
                return name.includes(q) || uid.includes(q);
            });
        }
        monthlyStudents.sort((a, b) => a.pct - b.pct);
        const badges = await getSidebarBadges(req.user);

        // ── Render ────────────────────────────────────────────────────
        res.render('admin/attendance', {
            ...base,
            user               : req.user,
            activePage         : 'ops-attendance',
            pageTitle          : 'Attendance Overview',
            pageSubtitle       : "View warden's log, resolve disputes, and review monthly trends",
            opsPendingDisputes : pendingDisputeCount,
            todayLog,
            disputes,
            monthlyStudents,
            selectedYear,
            ...badges,
            selectedMonth,
            viewMode,
            searchStudent,
            todayDate     : today.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
            successMessage: req.query.success || null,
            errorMessage  : req.query.error   || null
        });
    } catch (err) {
        console.error('operationController getAttendance:', err);
        res.status(500).send('Server Error');
    }
};

exports.resolveDisputeOverride = async (req, res) => {
    try {
        const { action, newStatus, reason } = req.body;
        const result = await attendanceActions.resolveDispute(req.params.id, req.user, { action, newStatus, reason });
        if (!result.ok) return res.redirect('/admin/operations/attendance?error=' + encodeURIComponent(result.error) + '&page=disputes');
        res.redirect('/admin/operations/attendance?success=Dispute+resolved.&page=disputes');
    } catch (err) {
        console.error('operationController resolveDisputeOverride:', err);
        res.redirect('/admin/operations/attendance?error=Failed+to+resolve+dispute.&page=disputes');
    }
};

// ─────────────────────────────────────────────────────────────
// NEW: Emergency mark attendance (admin only)
// ─────────────────────────────────────────────────────────────
exports.searchStudentsForMarking = async (req, res) => {
    try {
        const q = (req.query.q || '').trim();
        if (!q) return res.json({ results: [] });

        const today      = new Date();
        const todayStart = new Date(today); todayStart.setHours(0, 0, 0, 0);
        const todayEnd   = new Date(today); todayEnd.setHours(23, 59, 59, 999);

        const users = await User.find({
            role: 'student',
            $or: [
                { fullname: { $regex: q, $options: 'i' } },
                { userId: { $regex: q, $options: 'i' } }
            ]
        }).select('_id fullname userId').limit(15).lean();

        const results = [];
        for (const user of users) {
            const student = await Student.findOne({ user: user._id }).lean();
            if (!student) continue;

            const todayRecord = await Attendance.findOne({
                student: student._id,
                date: { $gte: todayStart, $lte: todayEnd }
            }).lean();

            results.push({
                fullname: user.fullname,
                userId: user.userId,
                room: student.room || null,
                currentStatus: todayRecord ? todayRecord.status : null
            });
        }

        res.json({ results });
    } catch (err) {
        console.error('operationController searchStudentsForMarking:', err);
        res.status(500).json({ results: [], error: 'Search failed.' });
    }
};

// ── Emergency mark attendance (admin only) ──────────────
exports.markAttendance = async (req, res) => {
    try {
        const { studentId, status, entryTime, exitTime, notes, date } = req.body;
        const wantsJson = req.xhr || (req.headers.accept || '').includes('application/json');

        const user = await User.findOne({ userId: studentId });
        if (!user) {
            if (wantsJson) return res.status(404).json({ ok: false, error: 'Student not found.' });
            return res.redirect('/admin/operations/attendance?error=Student+not+found.&page=mark');
        }
        const student = await Student.findOne({ user: user._id });
        if (!student) {
            if (wantsJson) return res.status(404).json({ ok: false, error: 'Student not found.' });
            return res.redirect('/admin/operations/attendance?error=Student+not+found.&page=mark');
        }

        const payload = {
            studentId: student._id,
            status,
            notes: notes || 'Marked by admin',
            entryTime: entryTime || null,
            exitTime: exitTime || null
        };

        const result = await attendanceActions.markAttendance(req.user, payload);

if (wantsJson) {
    if (!result.ok) return res.status(400).json({ ok: false, error: result.error });
    return res.json({
        ok        : true,
        status    : result.record.status,
        entryTime : result.record.entryTime,
        exitTime  : result.record.exitTime,
        recordedBy: req.user.fullname,
        student   : { fullname: user.fullname, userId: user.userId }
    });
}

        if (!result.ok) {
            return res.redirect('/admin/operations/attendance?error=' + encodeURIComponent(result.error) + '&page=mark');
        }
        res.redirect('/admin/operations/attendance?success=Attendance+marked+successfully.&page=mark');
    } catch (err) {
        console.error('operationController markAttendance:', err);
        if (req.xhr) return res.status(500).json({ ok: false, error: 'Failed to mark attendance.' });
        res.redirect('/admin/operations/attendance?error=Failed+to+mark+attendance.&page=mark');
    }
};

// ═══════════════════════════════════════════════════════════════════
// COMPLAINT MANAGEMENT
// Route: /admin/operations/complaints
//
// Two tabs:
//  - Harassment Cases: admin-exclusive queue, never touched by warden.
//    Identity always shown to admin regardless of isAnonymous (hidden
//    only from warden — see Complaint model).
//  - All Complaints: oversight/override view of everything warden
//    handles (harassment excluded here, it has its own tab).
// ═══════════════════════════════════════════════════════════════════
exports.getComplaints = async (req, res) => {
    try {
        const base     = await buildAdminOpsLocals(req);
        const category = req.query.category || 'all';
        const status   = req.query.status   || 'all';

        const harassmentQuery = { category: 'Ragging/Harassment' };
        if (status !== 'all') harassmentQuery.status = status;

        const otherQuery = { category: { $ne: 'Ragging/Harassment' } };
        if (category !== 'all') otherQuery.category = category;
        if (status   !== 'all') otherQuery.status   = status;

        const [harassmentCases, allComplaints, pendingHarassmentCount] = await Promise.all([
            Complaint.find(harassmentQuery)
                .populate({ path: 'student', populate: { path: 'user', select: 'fullname userId' } })
                .sort({ createdAt: -1 })
                .lean(),
            Complaint.find(otherQuery)
                .populate({ path: 'student', populate: { path: 'user', select: 'fullname userId' } })
                .populate('handledBy', 'fullname role')
                .sort({ createdAt: -1 })
                .lean(),
            Complaint.countDocuments({ category: 'Ragging/Harassment', status: { $ne: 'Resolved' } })
        ]);
        // Note: harassmentCases identity is intentionally NOT masked here,
        // even when isAnonymous is true — admin retains full visibility.
        const badges = await getSidebarBadges(req.user);

        res.render('admin/complaints', {
            ...base,
            activePage           : 'ops-complaints',
            pageTitle            : 'Complaint Management',
            pageSubtitle         : 'Handle harassment cases and oversee warden-managed complaints',
            opsPendingHarassment : pendingHarassmentCount,
            harassmentCases,
            ...badges,
            allComplaints,
            activeCategory       : category,
            activeStatus         : status,
            successMessage       : req.query.success || null,
            errorMessage         : req.query.error   || null
        });
    } catch (err) {
        console.error('operationController getComplaints:', err);
        res.status(500).send('Server Error');
    }
};

// One handler for both tabs — updateStatus already enforces the
// harassment role-gate and the override/notify logic internally.
exports.updateComplaintStatus = async (req, res) => {
    try {
        const { newStatus, note } = req.body;
        const result = await complaintActions.updateStatus(req.params.id, req.user, { newStatus, note });
        if (!result.ok) return res.redirect('/admin/operations/complaints?error=' + encodeURIComponent(result.error));
        res.redirect('/admin/operations/complaints?success=Complaint+status+updated.');
    } catch (err) {
        console.error('operationController updateComplaintStatus:', err);
        res.redirect('/admin/operations/complaints?error=Failed+to+update+complaint.');
    }
};

// ═══════════════════════════════════════════════════════════════════
// ROOM REQUESTS (Transfer/Vacate) — admin final approval
// Route: /admin/operations/room-requests
//
// Only requests the warden has already recommended (or rejected) show
// meaningful action here — Pending (warden hasn't reviewed yet) is
// still visible for transparency, but the approve/reject buttons only
// make sense once wardenApproval.status === 'Recommended'.
// ═══════════════════════════════════════════════════════════════════
exports.getRoomRequests = async (req, res) => {
    try {
        const base         = await buildAdminOpsLocals(req);
        const typeFilter   = req.query.type   || 'all';
        const statusFilter = req.query.status || 'all';

        const query = {};
        if (typeFilter   !== 'all') query.requestType = typeFilter;
        if (statusFilter !== 'all') query.status       = statusFilter;

        const requests = await RoomRequest.find(query)
            .populate({ path: 'student', populate: { path: 'user', select: 'fullname userId' } })
            .populate('newRoom', 'roomNo block floor')
            .sort({ createdAt: -1 })
            .lean();
        
            const badges = await getSidebarBadges(req.user);
        // FIX: only Student-category rooms with free beds may appear in
        // the transfer dropdown — Guest rooms are never a valid
        // destination for a student (see roomRequestActions.js's
        // matching guard on the actual approve action).
        //
        // $ne: 'Guest' (instead of a strict roomCategory: 'Student'
        // match) also correctly includes legacy rooms created before
        // Phase 2 that don't have roomCategory set at all — Mongoose's
        // schema default only applies to NEW documents, so those rooms'
        // roomCategory field is literally undefined, not 'Student'. A
        // strict match silently excluded every pre-existing room from
        // this dropdown. Mirrors the same $ne pattern already used in
        // roomController.js's category split.
        const availableRooms = await Room.find({ status: 'Available', roomCategory: { $ne: 'Guest' } })
            .sort({ block: 1, roomNo: 1 })
            .lean();

        const pendingCount = await RoomRequest.countDocuments({ 'wardenApproval.status': 'Recommended', status: 'Warden Reviewed' });

        res.render('admin/roomRequests', {
            ...base,
            activePage             : 'ops-room-requests',
            pageTitle              : 'Room Requests',
            pageSubtitle           : 'Review warden-recommended transfer and vacate requests',
            opsPendingRoomRequests : pendingCount,
            requests,
            availableRooms,
            ...badges,
            typeFilter,
            statusFilter,
            successMessage: req.query.success || null,
            errorMessage  : req.query.error   || null
        });
    } catch (err) {
        console.error('operationController getRoomRequests:', err);
        res.status(500).send('Server Error');
    }
};

exports.approveTransferRequest = async (req, res) => {
    try {
        const { newRoomId, newBedNo, note } = req.body;
        const result = await roomRequestActions.adminApproveTransfer(req.params.id, req.user, { newRoomId, newBedNo, note });
        if (!result.ok) return res.redirect('/admin/operations/room-requests?error=' + encodeURIComponent(result.error));
        res.redirect('/admin/operations/room-requests?success=Transfer+approved+successfully.');
    } catch (err) {
        console.error('operationController approveTransferRequest:', err);
        res.redirect('/admin/operations/room-requests?error=Failed+to+approve+transfer.');
    }
};

exports.approveVacateRequest = async (req, res) => {
    try {
        const { note } = req.body;
        const result = await roomRequestActions.adminApproveVacate(req.params.id, req.user, { note });
        if (!result.ok) return res.redirect('/admin/operations/room-requests?error=' + encodeURIComponent(result.error));
        res.redirect('/admin/operations/room-requests?success=Vacate+approved+successfully.');
    } catch (err) {
        console.error('operationController approveVacateRequest:', err);
        res.redirect('/admin/operations/room-requests?error=Failed+to+approve+vacate.');
    }
};

exports.rejectRoomRequest = async (req, res) => {
    try {
        const { reason } = req.body;
        const result = await roomRequestActions.adminReject(req.params.id, req.user, { reason });
        if (!result.ok) return res.redirect('/admin/operations/room-requests?error=' + encodeURIComponent(result.error));
        res.redirect('/admin/operations/room-requests?success=Request+rejected.');
    } catch (err) {
        console.error('operationController rejectRoomRequest:', err);
        res.redirect('/admin/operations/room-requests?error=Failed+to+reject+request.');
    }
};

// ═══════════════════════════════════════════════════════════════════
// GUEST ROOM BOOKINGS
// services/guestBookingActions.js.
// ═══════════════════════════════════════════════════════════════════
exports.approveGuestBooking = async (req, res) => {
    try {
        const { note } = req.body;
        const result = await guestBookingActions.approveBooking(req.params.id, req.user, { note });
        if (!result.ok) return res.redirect('/admin/operations/guest-bookings?error=' + encodeURIComponent(result.error));
        res.redirect('/admin/operations/guest-bookings?success=Booking+approved.');
    } catch (err) {
        console.error('operationController approveGuestBooking:', err);
        res.redirect('/admin/operations/guest-bookings?error=Failed+to+approve+booking.');
    }
};

exports.rejectGuestBooking = async (req, res) => {
    try {
        const { reason } = req.body;
        const result = await guestBookingActions.rejectBooking(req.params.id, req.user, { reason });
        if (!result.ok) return res.redirect('/admin/operations/guest-bookings?error=' + encodeURIComponent(result.error));
        res.redirect('/admin/operations/guest-bookings?success=Booking+rejected.');
    } catch (err) {
        console.error('operationController rejectGuestBooking:', err);
        res.redirect('/admin/operations/guest-bookings?error=Failed+to+reject+booking.');
    }
};

exports.getGuestBookings = async (req, res) => {
    try {
        const base      = await buildAdminOpsLocals(req);
        const activeTab = req.query.tab === 'bookings' ? 'bookings' : 'visitors';
        const vFilter   = req.query.vFilter || 'all';   
        const bFilter   = req.query.bFilter || 'all';   

        // ── Tab 1: Visitor Requests ──────────────────────────────────
        let vQuery = {};
        if (vFilter === 'pending')   vQuery = { status: 'Pending' };
        if (vFilter === 'approved')  vQuery = { status: 'Approved' };
        if (vFilter === 'rejected')  vQuery = { status: 'Rejected' };
        if (vFilter === 'cancelled') vQuery = { status: 'Cancelled' };

        const visitorRequests = await VisitorRequest.find(vQuery)
            .populate({
                path    : 'student',
                select  : 'guardianName guardianRelation guardianContact',
                populate: { path: 'user', select: 'fullname userId phoneNumber' }
            })
            .populate('wardenDecision.by', 'fullname role')
            .sort({ createdAt: -1 })
            .lean();

        // Just a status hint per card (not full booking detail — that
        // lives on the Bookings tab now) so admin knows at a glance
        // whether overriding to Rejected will cascade-cancel something.
        const vrIds = visitorRequests.map(v => v._id);
        const linkedBookings = await GuestRoomBooking.find({ visitorRequest: { $in: vrIds } })
            .select('visitorRequest status')
            .lean();
        const bookingStatusByVr = {};
        linkedBookings.forEach(b => { bookingStatusByVr[String(b.visitorRequest)] = b.status; });
        visitorRequests.forEach(vr => { vr._bookingStatus = bookingStatusByVr[String(vr._id)] || null; });

        // ── Tab 2: Guest Room Bookings (unchanged data shape) ────────
        let bQuery = {};
        if (bFilter !== 'all') bQuery.status = bFilter;

        const bookings = await GuestRoomBooking.find(bQuery)
            .populate({ path: 'student', populate: { path: 'user', select: 'fullname userId phoneNumber' } })
            .populate('room', 'roomNo block floor feePerNight capacity')
            .populate('visitorRequest', 'visitorName visitorCNIC relation numberOfGuests visitDate visitTime purpose')
            .sort({ createdAt: -1 })
            .lean();

        // ── Counts for both tabs' filter badges ──────────────────────
        const [vAll, vPending, vApproved, vRejected, vCancelled] = await Promise.all([
            VisitorRequest.countDocuments({}),
            VisitorRequest.countDocuments({ status: 'Pending' }),
            VisitorRequest.countDocuments({ status: 'Approved' }),
            VisitorRequest.countDocuments({ status: 'Rejected' }),
            VisitorRequest.countDocuments({ status: 'Cancelled' })
        ]);
        const [bAll, bPending, bApproved, bRejected, bCancelled] = await Promise.all([
            GuestRoomBooking.countDocuments({}),
            GuestRoomBooking.countDocuments({ status: 'Pending' }),
            GuestRoomBooking.countDocuments({ status: 'Approved' }),
            GuestRoomBooking.countDocuments({ status: 'Rejected' }),
            GuestRoomBooking.countDocuments({ status: 'Cancelled' })
        ]);
        const badges = await getSidebarBadges(req.user);

        res.render('admin/guestBookings', {
            ...base,
            activePage              : 'ops-guest-bookings',
            pageTitle               : 'Visitors & Guest Room Bookings',
            pageSubtitle            : "Oversee warden's visitor approvals and manage guest room bookings",
            opsPendingGuestBookings : vPending + bPending,
            activeTab,
            ...badges,
            visitorRequests, vFilter,
            vCounts: { all: vAll, pending: vPending, approved: vApproved, rejected: vRejected, cancelled: vCancelled },
            bookings, bFilter,
            bCounts: { all: bAll, pending: bPending, approved: bApproved, rejected: bRejected, cancelled: bCancelled },
            successMessage: req.query.success || null,
            errorMessage  : req.query.error   || null
        });
    } catch (err) {
        console.error('operationController getGuestBookings:', err);
        res.status(500).send('Server Error');
    }
};

// ── Visitor Request actions — redirect back to the visitors tab ─────
exports.approveVisitorRequest = async (req, res) => {
    try {
        const { note } = req.body;
        const result = await visitorActions.approveVisitorRequest(req.params.id, req.user, { note });
        if (!result.ok) return res.redirect('/admin/operations/guest-bookings?tab=visitors&error=' + encodeURIComponent(result.error));
        res.redirect('/admin/operations/guest-bookings?tab=visitors&success=Visitor+request+approved.');
    } catch (err) {
        console.error('approveVisitorRequest:', err);
        res.redirect('/admin/operations/guest-bookings?tab=visitors&error=Failed+to+approve+request.');
    }
};

exports.rejectVisitorRequest = async (req, res) => {
    try {
        const { reason } = req.body;
        const result = await visitorActions.rejectVisitorRequest(req.params.id, req.user, { reason });
        if (!result.ok) return res.redirect('/admin/operations/guest-bookings?tab=visitors&error=' + encodeURIComponent(result.error));
        res.redirect('/admin/operations/guest-bookings?tab=visitors&success=Visitor+request+rejected.');
    } catch (err) {
        console.error('rejectVisitorRequest:', err);
        res.redirect('/admin/operations/guest-bookings?tab=visitors&error=Failed+to+reject+request.');
    }
};

exports.overrideVisitorRequest = async (req, res) => {
    try {
        const { newStatus, note } = req.body;
        const result = await visitorActions.adminOverrideDecision(req.params.id, req.user, { newStatus, note });
        if (!result.ok) return res.redirect('/admin/operations/guest-bookings?tab=visitors&error=' + encodeURIComponent(result.error));
        let msg = `Visitor+request+${newStatus.toLowerCase()}+(overridden).`;
        if (result.cancelledBooking) msg += '+Linked+guest+room+booking+was+auto-cancelled.';
        res.redirect('/admin/operations/guest-bookings?tab=visitors&success=' + msg);
    } catch (err) {
        console.error('overrideVisitorRequest:', err);
        res.redirect('/admin/operations/guest-bookings?tab=visitors&error=Failed+to+override+decision.');
    }
};
// ═══════════════════════════════════════════════════════════════════
// MESS ORDERS & MENU
// Route: /admin/operations/mess
//
// Admin sees the same Orders/Menu/Add Menu tabs as warden (shared via
// services/messActions.js so the two can never drift), plus one extra
// capability: force a status change even if payment isn't confirmed
// yet (allowOverride) — the same "supervisor override" pattern used
// throughout this file.
// ═══════════════════════════════════════════════════════════════════
exports.getMessOrders = async (req, res) => {
    try {
        const base         = await buildAdminOpsLocals(req);
        const statusFilter = req.query.status || 'active';
        const activeTab    = req.query.tab || 'orders';

        const messData = await messActions.buildMessPageData({ statusFilter });
        
        const badges = await getSidebarBadges(req.user);
        
        res.render('admin/mess', {
            ...base,
            ...badges,
            activePage  : 'ops-mess',
            pageTitle   : 'Mess Orders & Menu',
            pageSubtitle: 'View orders, manage menu, and override warden decisions',
            statusFilter,
            activeTab,
            ...messData,
            successMessage: req.query.success || null,
            errorMessage  : req.query.error   || null
        });
    } catch (err) {
        console.error('operationController getMessOrders:', err);
        res.status(500).send('Server Error');
    }
};

exports.updateMessStatus = async (req, res) => {
    try {
        const { newStatus, override } = req.body;
        const result = await messActions.updateOrderStatus(req.params.id, req.user, {
            newStatus,
            allowOverride: override === 'on'
        });
        if (!result.ok) return res.redirect('/admin/operations/mess?tab=orders&error=' + encodeURIComponent(result.error));
        res.redirect('/admin/operations/mess?tab=orders&success=Order+status+updated.');
    } catch (err) {
        console.error('operationController updateMessStatus:', err);
        res.redirect('/admin/operations/mess?tab=orders&error=Failed+to+update+status.');
    }
};

exports.markMessCashReceived = async (req, res) => {
    try {
        const result = await messActions.markCashReceived(req.params.id, req.user);
        if (!result.ok) return res.redirect('/admin/operations/mess?tab=orders&error=' + encodeURIComponent(result.error));
        res.redirect('/admin/operations/mess?tab=orders&success=Cash+marked+as+received.');
    } catch (err) {
        console.error('operationController markMessCashReceived:', err);
        res.redirect('/admin/operations/mess?tab=orders&error=Failed+to+mark+cash+received.');
    }
};

exports.addMessMenu = async (req, res) => {
    try {
        const result = await messActions.addMenu(req.body.name);
        if (!result.ok) return res.redirect('/admin/operations/mess?tab=addmenu&error=' + encodeURIComponent(result.error));
        res.redirect('/admin/operations/mess?tab=addmenu&success=Meal+category+added.');
    } catch (err) {
        console.error('operationController addMessMenu:', err);
        res.redirect('/admin/operations/mess?tab=addmenu&error=Failed+to+add+meal+category.');
    }
};

exports.addMessMenuItem = async (req, res) => {
    try {
        const imagePath = req.file ? 'uploads/mess/' + req.file.filename : null;
        const result = await messActions.addMenuItem({ ...req.body, imagePath });
        if (!result.ok) return res.redirect('/admin/operations/mess?tab=addmenu&error=' + encodeURIComponent(result.error));
        res.redirect('/admin/operations/mess?tab=menu&success=Menu+item+added.');
    } catch (err) {
        console.error('operationController addMessMenuItem:', err);
        res.redirect('/admin/operations/mess?tab=addmenu&error=Failed+to+add+menu+item.');
    }
};

exports.editMessMenuItem = async (req, res) => {
    try {
        const imagePath = req.file ? 'uploads/mess/' + req.file.filename : null;
        const result = await messActions.editMenuItem(req.params.id, { ...req.body, imagePath });
        if (!result.ok) return res.redirect('/admin/operations/mess?tab=menu&error=' + encodeURIComponent(result.error));
        res.redirect('/admin/operations/mess?tab=menu&success=Item+updated.');
    } catch (err) {
        console.error('operationController editMessMenuItem:', err);
        res.redirect('/admin/operations/mess?tab=menu&error=Failed+to+update+item.');
    }
};

exports.deleteMessMenuItem = async (req, res) => {
    try {
        const result = await messActions.deleteMenuItem(req.params.id);
        if (!result.ok) return res.redirect('/admin/operations/mess?tab=menu&error=' + encodeURIComponent(result.error));
        res.redirect('/admin/operations/mess?tab=menu&success=Item+deleted.');
    } catch (err) {
        console.error('operationController deleteMessMenuItem:', err);
        res.redirect('/admin/operations/mess?tab=menu&error=Failed+to+delete+item.');
    }
};

exports.publishMessMenu = async (req, res) => {
    try {
        const result = await messActions.publishTodayMenu(req.body.itemIds, req.user);
        if (!result.ok) return res.redirect('/admin/operations/mess?tab=menu&error=' + encodeURIComponent(result.error));
        res.redirect('/admin/operations/mess?tab=menu&success=' + encodeURIComponent("Today's menu published."));
    } catch (err) {
        console.error('operationController publishMessMenu:', err);
        res.redirect('/admin/operations/mess?tab=menu&error=Failed+to+publish+menu.');
    }
};

// ═══════════════════════════════════════════════════════════════════
// LAUNDRY OVERSIGHT
// Route: /admin/operations/laundry
//
// Admin is a supervisor here, not an operator — view only, plus one
// override capability: force a status update on a paid request even
// if payment hasn't been confirmed yet (mirrors the mess Override
// checkbox pattern). No "mark cash received" action here — cash
// collection stays a warden-level, on-the-ground task.
// ═══════════════════════════════════════════════════════════════════


exports.getLaundryRequests = async (req, res) => {
    try {
        const base = await buildAdminOpsLocals(req);
        const laundryData = await laundryActions.getLaundryPageData({ weekKey: req.query.week });

        const badges = await getSidebarBadges(req.user);

        res.render('admin/laundry', {
            ...base,
            ...badges,
            activePage   : 'ops-laundry',
            pageTitle    : 'Laundry Oversight',
            pageSubtitle : "View warden's weekly laundry pickups and override stuck requests",
            ...laundryData,
            successMessage: req.query.success || null,
            errorMessage  : req.query.error   || null
        });
    } catch (err) {
        console.error('operationController getLaundryRequests:', err);
        res.status(500).send('Server Error');
    }
};

exports.overrideLaundryStatus = async (req, res) => {
    try {
        const { newStatus, override } = req.body;
        const result = await laundryActions.updateStatus(req.params.id, req.user, {
            newStatus,
            allowOverride: override === 'on'
        });
        if (!result.ok) return res.redirect('/admin/operations/laundry?error=' + encodeURIComponent(result.error));
        res.redirect('/admin/operations/laundry?success=Laundry+status+updated.&week=' + result.weekKey);
    } catch (err) {
        console.error('operationController overrideLaundryStatus:', err);
        res.redirect('/admin/operations/laundry?error=Failed+to+update+status.');
    }
};

// ═══════════════════════════════════════════════════════════════════
// MOBILE LOAD OVERSIGHT
// ═══════════════════════════════════════════════════════════════════

exports.getMobileLoad = async (req, res) => {
    try {
        const base          = await buildAdminOpsLocals(req);
        const statusFilter  = req.query.status  || 'all';
        const networkFilter = req.query.network || 'all';

        const query = {};
        if (statusFilter  !== 'all') query.requestStatus = statusFilter;
        if (networkFilter !== 'all') query.network        = networkFilter;

        const requests = await MobileLoad.find(query)
            .populate({ path: 'student', populate: { path: 'user', select: 'fullname userId' } })
            .populate('due')
            .populate('fulfilledBy', 'fullname role')
            .sort({ createdAt: -1 })
            .lean();
  
        const badges = await getSidebarBadges(req.user);

        const pendingCount = await MobileLoad.countDocuments({ requestStatus: 'Pending' });

        res.render('admin/mobileLoad', {
            ...base,
            ...badges,
            activePage           : 'ops-mobile-load',
            pageTitle             : 'Mobile Load Oversight',
            pageSubtitle          : "View warden's top-up requests and override stuck or incorrect decisions",
            opsPendingMobileLoad  : pendingCount,
            requests,
            statusFilter,
            networkFilter,
            successMessage: req.query.success || null,
            errorMessage  : req.query.error   || null
        });
    } catch (err) {
        console.error('operationController getMobileLoad:', err);
        res.status(500).send('Server Error');
    }
};

exports.markMobileLoadCashReceived = async (req, res) => {
    try {
        const result = await mobileLoadActions.markCashReceived(req.params.id, req.user, { allowOverride: true });
        if (!result.ok) return res.redirect('/admin/operations/mobile-load?error=' + encodeURIComponent(result.error));
        res.redirect('/admin/operations/mobile-load?success=Cash+marked+as+received.');
    } catch (err) {
        console.error('operationController markMobileLoadCashReceived:', err);
        res.redirect('/admin/operations/mobile-load?error=Failed+to+mark+cash.');
    }
};

exports.completeMobileLoad = async (req, res) => {
    try {
        const result = await mobileLoadActions.complete(req.params.id, req.user, { allowOverride: true });
        if (!result.ok) return res.redirect('/admin/operations/mobile-load?error=' + encodeURIComponent(result.error));
        res.redirect('/admin/operations/mobile-load?success=Mobile+load+completed.');
    } catch (err) {
        console.error('operationController completeMobileLoad:', err);
        res.redirect('/admin/operations/mobile-load?error=Failed+to+complete.');
    }
};

exports.rejectMobileLoad = async (req, res) => {
    try {
        const { reason } = req.body;
        const result = await mobileLoadActions.reject(req.params.id, req.user, { reason });
        if (!result.ok) return res.redirect('/admin/operations/mobile-load?error=' + encodeURIComponent(result.error));
        res.redirect('/admin/operations/mobile-load?success=Request+rejected.');
    } catch (err) {
        console.error('operationController rejectMobileLoad:', err);
        res.redirect('/admin/operations/mobile-load?error=Failed+to+reject.');
    }
};

// Full override — the only mobile-load action warden can never do.
// Lets admin set ANY status regardless of current stage (e.g. push a
// stuck "Payment Done" back to "Pending", or force-complete a request
// the warden forgot about).
exports.overrideMobileLoad = async (req, res) => {
    try {
        const { newStatus, note } = req.body;
        const result = await mobileLoadActions.adminOverrideStatus(req.params.id, req.user, { newStatus, note });
        if (!result.ok) return res.redirect('/admin/operations/mobile-load?error=' + encodeURIComponent(result.error));
        res.redirect('/admin/operations/mobile-load?success=' + encodeURIComponent(
            `Request overridden: ${result.previousStatus} → ${newStatus}.`
        ));
    } catch (err) {
        console.error('operationController overrideMobileLoad:', err);
        res.redirect('/admin/operations/mobile-load?error=Failed+to+override+request.');
    }
};

// ═══════════════════════════════════════════════════════════════════
// CAB BOOKING CONFIRMATION — admin confirms a student's cab booking
// and sends an email notification to the student's guardian.
// ═══════════════════════════════════════════════════════════════════
exports.confirmCabBooking = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'admin') {
            return res.status(403).send('Access Denied');
        }

        const booking = await CabBooking.findById(req.params.id);
        if (!booking) {
            return res.redirect('/admin/dashboard?error=Booking+not+found.');
        }
        if (booking.status !== 'Pending') {
            return res.redirect('/admin/dashboard?error=Only+pending+bookings+can+be+confirmed.');
        }

        booking.status = 'Confirmed';
        booking.confirmedAt = new Date();
        await booking.save();

        // ── Fetch the student + guardian info for the email ────────
        try {
            const studentRec = await Student.findById(booking.student)
                .populate('user', 'fullname userId')
                .lean();

            if (studentRec && studentRec.guardianEmail) {
                const pickupDate = new Date(booking.pickupDate);
                const dateStr = pickupDate.toLocaleDateString('en-PK', {
                    day: '2-digit', month: 'short', year: 'numeric'
                });

                await sendCabBookingEmail({
                    guardianEmail   : studentRec.guardianEmail,
                    guardianName    : studentRec.guardianName || 'Guardian',
                    studentName     : studentRec.user?.fullname || 'A student',
                    studentId       : studentRec.user?.userId || '—',
                    driverName      : booking.driverName,
                    driverPhone     : booking.driverPhone,
                    vehicleType     : booking.vehicleType,
                    vehicleReg      : booking.vehicleRegistration,
                    pickupLocation  : booking.pickupLocation,
                    dropoffLocation : booking.dropoffLocation,
                    pickupDate      : dateStr,
                    pickupTime      : booking.pickupTime || '',
                    passengerCount  : booking.passengerCount,
                    notes           : booking.notes || ''
                });

                // Notify student that guardian was emailed
                await Notification.create({
                    title     : 'Guardian Notified — Cab Booking Confirmed',
                    message   : 'Your guardian (' + studentRec.guardianEmail + ') has been notified about your confirmed cab booking with ' + booking.driverName + ' on ' + dateStr + '.',
                    recipient : studentRec.user._id,
                    category  : 'Requests',
                    relatedTo : { model: 'CabBooking', docId: booking._id },
                    createdBy : req.user._id,
                    priority  : 'Low'
                });
            } else {
                console.log('confirmCabBooking: Student ' + booking.student + ' has no guardian email on file — skipping email.');
            }
        } catch (emailErr) {
            console.error('confirmCabBooking: Failed to send guardian email:', emailErr);
        }

        // ── Notify driver about the confirmation ───────────────────
        try {
            await Notification.create({
                title     : 'Cab Booking Confirmed',
                message   : 'Your cab booking with ' + booking.driverName + ' has been confirmed by the administration.',
                recipient : booking.driver,
                category  : 'Requests',
                relatedTo : { model: 'CabBooking', docId: booking._id },
                createdBy : req.user._id,
                priority  : 'Low'
            });
        } catch (notifErr) {
            console.error('confirmCabBooking: Driver notification error:', notifErr);
        }

        res.redirect('/admin/dashboard?success=Cab+booking+confirmed.+Guardian+has+been+notified.');

    } catch (err) {
        console.error('confirmCabBooking Error:', err);
        res.redirect('/admin/dashboard?error=Failed+to+confirm+booking.');
    }
};
