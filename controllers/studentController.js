// =====================================================================
// studentController.js
// Handles all student portal routes.
// Every handler attaches: student (with populated user+room),
// unreadCount, pendingCount, recentNotifs — so the shared header
// partial always has what it needs.
// =====================================================================
const User           = require('../models/user');
const Student        = require('../models/student');
const Driver         = require('../models/driver');
const Room           = require('../models/room');
const Allocation     = require('../models/allocation');
const Attendance     = require('../models/attendance');
const LeaveRequest   = require('../models/leave');
const Complaint      = require('../models/complaint');
const Menu           = require('../models/mess');
const MenuItem       = require('../models/menuItem');
const MessLog        = require('../models/messDailyLog');
const FoodOrder      = require('../models/foodOrder');
const LaundryRequest = require('../models/laundry');
const MobileLoad     = require('../models/mobileLoad');
const Due            = require('../models/due');
const Payment        = require('../models/payment');
const Fine           = require('../models/fine');
const Notification   = require('../models/notification');

const RoomRequest = require('../models/roomRequest');
const VisitorRequest      = require('../models/visitorRequest');
const GuestRoomBooking    = require('../models/guestRoomBooking');
const CabBooking          = require('../models/cabBooking');
const visitorActions      = require('../services/visitorActions');
const guestBookingActions = require('../services/guestBookingActions');
const path           = require('path');
const fs             = require('fs');
const jazzcash = require('../services/jazzcash');
const easypaisa = require('../services/easypaisa');

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function normaliseImagePath(p) {
    if (!p) return null;
    return p.replace(/^public[/\\]/, '');
}

function timeAgo(date) {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1)   return 'just now';
    if (mins < 60)  return mins + 'm ago';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)   return hrs + 'h ago';
    const days = Math.floor(hrs / 24);
    if (days < 7)   return days + 'd ago';
    return new Date(date).toLocaleDateString();
}

function currentGreeting() {
    const h = new Date().getHours();
    if (h < 12) return 'morning';
    if (h < 17) return 'afternoon';
    return 'evening';
}

// Capitalised version for use in "Welcome back" / banner-style strings
function currentGreetingCapitalised() {
    const g = currentGreeting();
    return g.charAt(0).toUpperCase() + g.slice(1);
}

function getWeekKey(date = new Date()) {
    const d    = new Date(date);
    const day  = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const mon  = new Date(d.setDate(diff));
    const yr   = mon.getFullYear();
    const wk   = Math.ceil(((mon - new Date(yr, 0, 1)) / 86400000 + 1) / 7);
    return `${yr}-W${String(wk).padStart(2, '00')}`;
}

// Build the shared locals every page needs
async function buildBaseLocals(req) {
    const userId  = req.user._id;
    const student = await Student.findOne({ user: userId })
        .populate('user', 'fullname email userId phoneNumber gender dateOfBirth idImage profileImage status role')
        .populate('room')
        .populate('currentAllocation')
        .lean();

    if (!student) throw new Error('Student profile not found');

    // Unread notifications (broadcast + personal)
    const unreadCount = await Notification.countDocuments({
        isActive: true,
        $or: [
            { target: { $in: ['All', 'Students'] }, readBy: { $nin: [userId] } },
            { recipient: userId, readBy: { $nin: [userId] } }
        ]
    });

    // Recent 5 notifications for bell dropdown
    const recentNotifs = await Notification.find({
        isActive: true,
        $or: [
            { target: { $in: ['All', 'Students'] } },
            { recipient: userId }
        ]
    }).sort({ createdAt: -1 }).limit(5).lean();

    // Add time-ago strings
    recentNotifs.forEach(n => { n._timeAgo = timeAgo(n.createdAt); });

    // Pending payment count for sidebar badge
    const pendingCount = await Due.countDocuments({
        student: student._id,
        status: { $in: ['Pending', 'Partially Paid', 'Overdue'] }
    });

    return { student, unreadCount, recentNotifs, pendingCount };
}

// ─────────────────────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────────────────────
exports.getDashboard = async (req, res) => {
    try {
        const base = await buildBaseLocals(req);
        const { student } = base;

        // Attendance %  this calendar month
        const now        = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const totalDays  = await Attendance.countDocuments({ student: student._id, date: { $gte: monthStart } });
        const presentDays = await Attendance.countDocuments({ student: student._id, date: { $gte: monthStart }, status: { $in: ['In', 'Late'] } });
        const attendancePct = totalDays > 0 ? Math.round((presentDays / totalDays) * 100) : 0;

        // Other stats
        const [pendingLeave, openComplaints, pendingOrders, activeLaundry, pendingMobileLoad] = await Promise.all([
            LeaveRequest.countDocuments({ student: student._id, status: 'Pending' }),
            Complaint.countDocuments({ student: student._id, status: { $in: ['Pending', 'In Review'] } }),
            FoodOrder.countDocuments({ student: student._id, orderStatus: { $in: ['Pending', 'Accepted', 'Preparing'] } }),
            LaundryRequest.countDocuments({ student: student._id, requested: true, status: { $in: ['Pending Pickup', 'Picked Up', 'Processing'] } }),
            MobileLoad.countDocuments({ student: student._id, requestStatus: 'Pending' })
        ]);

        // Recent activity from notifications
        const recentActivity = base.recentNotifs.slice(0, 5).map(n => ({
            label:    n.title,
            sub:      n.message.substring(0, 60) + (n.message.length > 60 ? '…' : ''),
            time:     n._timeAgo,
            dotClass: n.category === 'Payments' ? 'green' : n.category === 'Alerts' ? 'red' : n.priority === 'High' ? 'orange' : 'blue'
        }));

        const firstName = student.user.fullname.split(' ')[0];

        // Topbar title for the dashboard — set here explicitly (same
        // pattern as adminController.getDashboard) so it's guaranteed
        // correct regardless of which version of student-header.ejs is
        // deployed. student-header.ejs checks topbarGreeting first, then
        // falls back to pageTitle, then 'Student Portal'.
        const topbarGreeting = 'Welcome back, ' + firstName + '!';

        res.render('student/dashboard', {
            ...base,
            activePage         : 'dashboard',
            pageTitle          : topbarGreeting,
            topbarGreeting,
            showProfileDropdown: true,
            currentDate        : now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
            pageSubtitle       : now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
            currentGreeting    : currentGreetingCapitalised(),
            stats: {
                pendingPayments    : base.pendingCount,
                unreadNotifications: base.unreadCount,
                attendancePercent  : attendancePct,
                pendingLeave,
                openComplaints,
                pendingOrders,
                activeLaundry,
                pendingMobileLoad
            },
            recentActivity,
            successMessage : req.query.success || null,
            errorMessage   : req.query.error   || null
        });
    } catch (err) {
        console.error('getDashboard:', err);
        res.status(500).send('Server Error');
    }
};

// ─────────────────────────────────────────────────────────────
// PROFILE  (view-only)
// ─────────────────────────────────────────────────────────────
exports.getProfile = async (req, res) => {
    try {
        const base = await buildBaseLocals(req);
        const { student } = base;

        // Normalise idImage for display
                student.user.idImage      = normaliseImagePath(student.user.idImage);
        student.user.profileImage = normaliseImagePath(student.user.profileImage);

        // ── Fetch cab booking history for this student ──
        const cabBookings = await CabBooking.find({ student: student._id })
            .sort({ createdAt: -1 })
            .lean();

        // Split into active and past
        const activeCabBookings = cabBookings.filter(
            b => ['Pending', 'Confirmed', 'In Progress'].includes(b.status)
        );
        const pastCabBookings = cabBookings.filter(
            b => ['Completed', 'Cancelled'].includes(b.status)
        );

        res.render('student/profile', {
            ...base,
            activePage   : 'profile',
            pageTitle    : 'My Profile',
            pageSubtitle : student.user.userId,
            cabBookings,
            activeCabBookings,
            pastCabBookings,
            successMessage: req.query.success || null,
            errorMessage  : req.query.error   || null
        });
    } catch (err) {
        console.error('getProfile:', err);
        res.status(500).send('Server Error');
    }
};

// ─────────────────────────────────────────────────────────────
// ROOM
// ─────────────────────────────────────────────────────────────
exports.getRoom = async (req, res) => {
    try {
        const base = await buildBaseLocals(req);
        const { student } = base;

        // Roommates (other active allocations in same room)
        let roommates = [];
        if (student.room) {
            const others = await Allocation.find({
                room   : student.room._id,
                status : 'Active',
                student: { $ne: student._id }
            }).populate({ path: 'student', populate: { path: 'user', select: 'fullname userId' } }).lean();
            roommates = others.map(a => ({
                fullname : a.student?.user?.fullname || '—',
                userId   : a.student?.user?.userId   || '—',
                bedNo    : a.bedNo
            }));
        }

        // Existing active room request for this student
        
const existingRequest = await RoomRequest.findOne({
    student: student._id,
    status : { $in: ['Pending', 'Warden Reviewed'] }
}).populate('preferredRoom', 'roomNo block floor').lean();

        res.render('student/room', {
            ...base,
            activePage   : 'room',
            pageTitle    : 'My Room',
            pageSubtitle : student.room ? 'Room ' + student.room.roomNo : 'No room assigned',
            roommates,
            existingRequest,
            successMessage: req.query.success || null,
            errorMessage  : req.query.error   || null
        });
    } catch (err) {
        console.error('getRoom:', err);
        res.status(500).send('Server Error');
    }
};

exports.postRoomRequest = async (req, res) => {
    try {
        const base    = await buildBaseLocals(req);
        const student = base.student;
        const { requestType, reason, preferredRoom, vacateDate } = req.body;

        if (!['Transfer', 'Vacate'].includes(requestType)) {
            return res.redirect('/student/room?error=Invalid+request+type.');
        }

        const RoomRequest = require('../models/roomRequest');
        if (!RoomRequest) return res.redirect('/student/room?error=Room+request+feature+not+available+yet.');

        // Check no existing open request
        // FIX: 'Warden Approved' is not a real status in the RoomRequest
        // enum (the actual post-warden-recommendation status is
        // 'Warden Reviewed') — this check was silently never matching,
        // letting students submit a second request right after the
        // warden recommended their first one.
        const existing = await RoomRequest.findOne({
            student: student._id,
            status : { $in: ['Pending', 'Warden Reviewed'] }
        });
        if (existing) return res.redirect('/student/room?error=You+already+have+a+pending+room+request.');

        const newRequest = await RoomRequest.create({
            student      : student._id,
            requestType,
            reason       : reason || '',
            preferredRoom: preferredRoom || null,
            vacateDate   : requestType === 'Vacate' && vacateDate ? new Date(vacateDate) : null,
            status       : 'Pending'
        });

        // ── Notify warden about the new room request ─────────────────
        // FIX: this notification was entirely missing — students had no
        // way of alerting the warden that a new Transfer/Vacate request
        // needed review, so requests sat unnoticed until the warden
        // happened to check the Room Requests page manually.
        try {
            const warden = await User.findOne({ role: 'warden' }).lean();
            if (warden) {
                const studentName = student.user?.fullname || 'A student';
                await Notification.create({
                    title     : 'New Room Request Submitted',
                    message   : `${studentName} has submitted a ${requestType} request. Reason: ${reason || 'Not specified'}`,
                    recipient : warden._id,
                    category  : 'Requests',
                    relatedTo : { model: 'RoomRequest', docId: newRequest._id },
                    createdBy : student.user._id,
                    priority  : 'Medium'
                });
            }
        } catch (notifErr) {
            console.error('Room request notification error:', notifErr);
        }
        // ────────────────────────────────────────────────────────────

        res.redirect('/student/room?success=Room+request+submitted+successfully.');
    } catch (err) {
        console.error('postRoomRequest:', err);
        res.redirect('/student/room?error=Failed+to+submit+request.');
    }
};

// ─────────────────────────────────────────────────────────────
// ATTENDANCE
// ─────────────────────────────────────────────────────────────
exports.getAttendance = async (req, res) => {
    try {
        const base    = await buildBaseLocals(req);
        const student = base.student;

        const year  = parseInt(req.query.year  || new Date().getFullYear());
        const month = parseInt(req.query.month || new Date().getMonth() + 1);

        const start = new Date(year, month - 1, 1);
        const end   = new Date(year, month, 1);

        const records = await Attendance.find({
            student: student._id,
            date   : { $gte: start, $lt: end }
        }).sort({ date: 1 }).lean();

        // Monthly stats
        const total   = records.length;
        const present = records.filter(r => ['In', 'Late'].includes(r.status)).length;
        const pct     = total > 0 ? Math.round((present / total) * 100) : 0;

        const counts = { In: 0, Out: 0, Late: 0, Leave: 0, Missed: 0 };
        records.forEach(r => { if (counts[r.status] !== undefined) counts[r.status]++; });

        // All records that ever had a dispute (including resolved ones)
        const disputes = await Attendance.find({
            student : student._id,
            notes   : { $regex: /(\[DISPUTE\]|Corrected by warden|Dispute rejected)/ }
        }).sort({ date: -1 }).lean();

        // Today's record for the status banner
        const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
        const todayEnd   = new Date(); todayEnd.setHours(23, 59, 59, 999);
        const todayRecord = await Attendance.findOne({
            student : student._id,
            date    : { $gte: todayStart, $lte: todayEnd }
        }).lean();

        res.render('student/attendance', {
            ...base,
            activePage    : 'attendance',
            pageTitle     : 'Attendance',
            pageSubtitle  : `${new Date(start).toLocaleString('default', { month: 'long' })} ${year}`,
            records,
            counts,
            pct,
            total,
            present,
            selectedYear  : year,
            selectedMonth : month,
            disputes,
            todayRecord   : todayRecord || null,
            successMessage: req.query.success || null,
            errorMessage  : req.query.error   || null
        });
    } catch (err) {
        console.error('getAttendance:', err);
        res.status(500).send('Server Error');
    }
};

exports.postAttendanceDispute = async (req, res) => {
    try {
        const base      = await buildBaseLocals(req);
        const { attendanceId, reason } = req.body;
        if (!attendanceId || !reason) return res.redirect('/student/attendance?error=Please+fill+all+fields.');

        const record = await Attendance.findOne({ _id: attendanceId, student: base.student._id });
        if (!record) return res.redirect('/student/attendance?error=Record+not+found.');
        if (record.notes && record.notes.startsWith('[DISPUTE]')) {
            return res.redirect('/student/attendance?error=Dispute+already+raised+for+this+record.');
        }

        record.notes = `[DISPUTE] ${reason}`;
        record.disputeRaisedAt = new Date();
        await record.save();

        // ── Notify warden about the dispute ─────────────────────────
        try {
            const warden = await User.findOne({ role: 'warden' }).lean();
            if (warden) {
                const studentName = base.student.user?.fullname || 'A student';
                const disputeDate = new Date(record.date).toLocaleDateString('en-PK', {
                    day: '2-digit', month: 'short', year: 'numeric'
                });
                await Notification.create({
                    title     : 'Attendance Dispute Raised',
                    message   : `${studentName} has disputed their attendance record for ${disputeDate}. Current status: ${record.status}. Reason: ${reason}`,
                    recipient : warden._id,
                    category  : 'Requests',
                    createdBy : base.student.user._id,
                    priority  : 'Medium'
                });
            }
        } catch (notifErr) {
            console.error('Dispute notification error:', notifErr);
        }
        // ────────────────────────────────────────────────────────────

        res.redirect('/student/attendance?success=Dispute+submitted.+Warden+will+review+it.');
    } catch (err) {
        console.error('postAttendanceDispute:', err);
        res.redirect('/student/attendance?error=Failed+to+submit+dispute.');
    }
};

// ─────────────────────────────────────────────────────────────
// LEAVE
// ─────────────────────────────────────────────────────────────
exports.getLeave = async (req, res) => {
    try {
        const base    = await buildBaseLocals(req);
        const student = base.student;

        const leaves = await LeaveRequest.find({ student: student._id })
            .sort({ createdAt: -1 }).lean();

        res.render('student/leave', {
            ...base,
            activePage   : 'leave',
            pageTitle    : 'Leave Requests',
            pageSubtitle : 'Apply and track your leave applications',
            leaves,
            today        : new Date().toISOString().split('T')[0],
            successMessage: req.query.success || null,
            errorMessage  : req.query.error   || null
        });
    } catch (err) {
        console.error('getLeave:', err);
        res.status(500).send('Server Error');
    }
};

exports.postLeaveRequest = async (req, res) => {
    try {
        const base    = await buildBaseLocals(req);
        const student = base.student;
        const { leaveType, fromDate, toDate, reason, destination, emergencyContact } = req.body;

        if (!leaveType || !fromDate || !toDate || !reason || !emergencyContact) {
            return res.redirect('/student/leave?error=All+required+fields+must+be+filled.&page=apply');
        }

        const from     = new Date(fromDate);
        const now      = new Date();
        const daysDiff = Math.ceil((from - now) / 86400000);

        // 3-day advance rule (exception: Medical)
        if (leaveType !== 'Medical' && daysDiff < 3) {
            return res.redirect('/student/leave?error=Leave+must+be+applied+at+least+3+days+in+advance+(except+Medical).&page=apply');
        }

        if (new Date(toDate) < from) {
            return res.redirect('/student/leave?error=End+date+must+be+after+start+date.&page=apply');
        }

        const leave = await LeaveRequest.create({
            student,
            leaveType,
            fromDate        : from,
            toDate          : new Date(toDate),
            reason,
            destination     : destination || 'Home',
            emergencyContact,
            appliedAt       : now,
            status          : 'Pending',
            guardianVerified: false
        });

        // ── Notify warden that a new leave request was submitted ─────
        try {
            const warden = await User.findOne({ role: 'warden' }).lean();
            if (warden) {
                const studentName = student.user?.fullname || 'A student';
                const fromStr     = from.toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' });
                const toStr       = new Date(toDate).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' });
                await Notification.create({
                    title     : 'New Leave Request',
                    message   : `${studentName} has applied for ${leaveType} leave from ${fromStr} to ${toStr}. Reason: ${reason}`,
                    recipient : warden._id,
                    category  : 'Requests',
                    relatedTo : { model: 'LeaveRequest', docId: leave._id },
                    createdBy : student.user._id,
                    priority  : leaveType === 'Emergency' ? 'High' : 'Medium'
                });
            }

            // Admin now has an Operations Oversight view over leave requests
            // too — kept as visibility only (broadcast). Always Low priority:
            // real urgency (guardian unreachable, 24h+ pending) is handled
            // separately as High-priority escalations in leaveActions.js and
            // jobs/leaveEscalationJob.js — this ping is FYI only, so admin's
            // feed doesn't get noisy on routine, already-warden-handled leaves.
            const studentNameForAdmin = student.user?.fullname || 'A student';
            const fromStrForAdmin     = from.toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' });
            const toStrForAdmin       = new Date(toDate).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' });
            await Notification.create({
                title     : 'New Leave Request',
                message   : `${studentNameForAdmin} has applied for ${leaveType} leave from ${fromStrForAdmin} to ${toStrForAdmin}. Reason: ${reason}`,
                target    : 'Admins',
                category  : 'Requests',
                relatedTo : { model: 'LeaveRequest', docId: leave._id },
                createdBy : student.user._id,
                priority  : 'Low'
            });
        } catch (notifErr) {
            console.error('Leave apply notification error:', notifErr);
        }
        // ────────────────────────────────────────────────────────────

        res.redirect('/student/leave?success=Leave+request+submitted.+Warden+will+review+shortly.');
    } catch (err) {
        console.error('postLeaveRequest:', err);
        res.redirect('/student/leave?error=Failed+to+submit+leave+request.');
    }
};

exports.cancelLeaveRequest = async (req, res) => {
    try {
        const base  = await buildBaseLocals(req);
        const leave = await LeaveRequest.findOne({ _id: req.params.id, student: base.student._id });
        if (!leave) return res.redirect('/student/leave?error=Request+not+found.');
        if (leave.status !== 'Pending') return res.redirect('/student/leave?error=Only+pending+requests+can+be+cancelled.');

        leave.status = 'Cancelled';
        await leave.save();

        // ── Notify warden that the student cancelled their request ───
        try {
            const warden      = await User.findOne({ role: 'warden' }).lean();
            const studentName = base.student.user?.fullname || 'A student';
            const fromStr     = new Date(leave.fromDate).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' });

            if (warden) {
                await Notification.create({
                    title     : 'Leave Request Cancelled',
                    message   : `${studentName} has cancelled their ${leave.leaveType} leave request (from ${fromStr}). No further action needed.`,
                    recipient : warden._id,
                    category  : 'Requests',
                    relatedTo : { model: 'LeaveRequest', docId: leave._id },
                    createdBy : base.student.user._id,
                    priority  : 'Low'
                });
            }

            await Notification.create({
                title     : 'Leave Request Cancelled',
                message   : `${studentName} has cancelled their ${leave.leaveType} leave request (from ${fromStr}). No further action needed.`,
                target    : 'Admins',
                category  : 'Requests',
                relatedTo : { model: 'LeaveRequest', docId: leave._id },
                createdBy : base.student.user._id,
                priority  : 'Low'
            });
        } catch (notifErr) {
            console.error('Leave cancel notification error:', notifErr);
        }
        // ────────────────────────────────────────────────────────────

        res.redirect('/student/leave?success=Leave+request+cancelled.');
    } catch (err) {
        console.error('cancelLeaveRequest:', err);
        res.redirect('/student/leave?error=Failed+to+cancel.');
    }
};
// ─────────────────────────────────────────────────────────────
// COMPLAINTS
// ─────────────────────────────────────────────────────────────
exports.getComplaints = async (req, res) => {
    try {
        const base       = await buildBaseLocals(req);
        const complaints = await Complaint.find({ student: base.student._id })
            .sort({ createdAt: -1 }).lean();

        res.render('student/complaints', {
            ...base,
            activePage   : 'complaints',
            pageTitle    : 'Complaints',
            pageSubtitle : 'Submit and track your complaints',
            complaints,
            successMessage: req.query.success || null,
            errorMessage  : req.query.error   || null
        });
    } catch (err) {
        console.error('getComplaints:', err);
        res.status(500).send('Server Error');
    }
};

exports.postComplaint = async (req, res) => {
    try {
        const base    = await buildBaseLocals(req);
        const student = base.student;
        const { subject, description, category, priority, isAnonymous, otherCategory } = req.body;

        if (!subject || !description || !category) {
            return res.redirect('/student/complaints?error=Please+fill+all+required+fields.&page=submit');
        }

        const finalCategory = category === 'Other' && otherCategory ? otherCategory : category;

        let attachment = null;
        if (req.file) {
            attachment = 'uploads/complaints/' + req.file.filename;
        } else if (category === 'Maintenance') {
            return res.redirect('/student/complaints?error=A+photo+is+required+for+maintenance+complaints.&page=submit');
        }

        const slaMap = {
            'Maintenance'          : 48,
            'Mess'                 : 24,
            'Laundry'              : 48,
            'Roommate Issue'       : 72,
            'Ragging/Harassment'   : 12,
            'Cleanliness'          : 24,
            'Other'                : 72
        };
        const slaHours = slaMap[finalCategory] || 72;
        const expectedResolutionDate = new Date(Date.now() + slaHours * 3600000);

        const complaint = await Complaint.create({
            student    : student._id,
            subject,
            description,
            category   : finalCategory,
            priority   : priority || 'Medium',
            isAnonymous: isAnonymous === 'on' && finalCategory === 'Ragging/Harassment',
            attachment,
            expectedResolutionDate,
            status     : 'Submitted'
        });

        // ── Notify the right party depending on category ──────────────
        try {
            const studentName  = student.user?.fullname || 'A student';
            const isHarassment = finalCategory === 'Ragging/Harassment';

            if (isHarassment) {
                // Harassment cases are admin-only, end to end — warden
                // never notified, never sees these, regardless of anonymity.
                await Notification.create({
                    title     : 'New Harassment Complaint Submitted',
                    message   : `${studentName} has submitted a Ragging/Harassment complaint: "${subject}". This requires admin review.`,
                    target    : 'Admins',
                    category  : 'Requests',
                    relatedTo : { model: 'Complaint', docId: complaint._id },
                    createdBy : student.user._id,
                    priority  : 'High'
                });
            } else {
                // Regular complaint — notify warden only. Admin does NOT
                // get notified for these; admin's oversight view already
                // lists them under "All Complaints" whenever they check.
                const warden = await User.findOne({ role: 'warden' }).lean();
                if (warden) {
                    await Notification.create({
                        title     : 'New Complaint Submitted',
                        message   : `${studentName} has submitted a ${finalCategory} complaint: "${subject}".`,
                        recipient : warden._id,
                        category  : 'Requests',
                        relatedTo : { model: 'Complaint', docId: complaint._id },
                        createdBy : student.user._id,
                        priority  : priority === 'Urgent' ? 'High' : 'Medium'
                    });
                }
            }
        } catch (notifErr) {
            console.error('Complaint notification error:', notifErr);
        }
        // ────────────────────────────────────────────────────────────

        res.redirect('/student/complaints?success=Complaint+submitted+successfully.');
    } catch (err) {
        console.error('postComplaint:', err);
        res.redirect('/student/complaints?error=Failed+to+submit+complaint.');
    }
};
// ─────────────────────────────────────────────────────────────
// MESS
// ─────────────────────────────────────────────────────────────
exports.getMess = async (req, res) => {
    try {
        const base = await buildBaseLocals(req);

        const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
        const todayEnd   = new Date(); todayEnd.setHours(23, 59, 59, 999);

        const todayLog = await MessLog.findOne({ date: { $gte: todayStart, $lte: todayEnd } })
            .populate({ path: 'availableItems', populate: { path: 'menu', select: 'name' } })
            .lean();

        const menuByMeal = {};
        if (todayLog && todayLog.availableItems) {
            todayLog.availableItems.forEach(item => {
                const mealName = item.menu?.name || 'Other';
                if (!menuByMeal[mealName]) menuByMeal[mealName] = [];
                menuByMeal[mealName].push(item);
            });
        }

        // FIX: meal categories are now free-text (warden can add custom
        // ones like "Beverages"), so we can no longer assume a fixed
        // 4-item list. Show the common 4 first (if present), then any
        // custom categories alphabetically after.
        const PRIORITY_ORDER = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];
        const mealNames = Object.keys(menuByMeal).sort((a, b) => {
            const ai = PRIORITY_ORDER.indexOf(a);
            const bi = PRIORITY_ORDER.indexOf(b);
            if (ai === -1 && bi === -1) return a.localeCompare(b);
            if (ai === -1) return 1;
            if (bi === -1) return -1;
            return ai - bi;
        });

        const todayOrders = await FoodOrder.find({
            student  : base.student._id,
            orderDate: { $gte: todayStart, $lte: todayEnd }
        }).populate({ path: 'items.menuItem', select: 'name price' }).lean();

        const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
        const orderHistory  = await FoodOrder.find({
            student  : base.student._id,
            orderDate: { $gte: thirtyDaysAgo }
        }).sort({ orderDate: -1 }).lean();

        res.render('student/mess', {
            ...base,
            activePage   : 'mess',
            pageTitle    : 'Mess',
            pageSubtitle : "Today's menu & order history",
            menuByMeal,
            mealNames,
            todayOrders,
            orderHistory,
            todayLog,
            successMessage: req.query.success || null,
            errorMessage  : req.query.error   || null
        });
    } catch (err) {
        console.error('getMess:', err);
        res.status(500).send('Server Error');
    }
};

exports.postFoodOrder = async (req, res) => {
    try {
        const base    = await buildBaseLocals(req);
        const student = base.student;
        let items = req.body.items;
        if (!items || !items.length) {
            return res.redirect('/student/mess?error=Please+select+at+least+one+item.&page=menu');
        }
        if (!Array.isArray(items)) items = [items];

        let totalAmount = 0;
        const orderItems = [];

        for (const it of items) {
            const menuItem = await MenuItem.findById(it.menuItemId).lean();
            if (!menuItem || !menuItem.isAvailable) continue;
            const qty = parseInt(it.quantity) || 1;
            orderItems.push({ menuItem: menuItem._id, quantity: qty, priceAtOrder: menuItem.price });
            totalAmount += menuItem.price * qty;
        }

        if (!orderItems.length) {
            return res.redirect('/student/mess?error=No+valid+items+selected.&page=menu');
        }

        const order = await FoodOrder.create({
            student    : student._id,
            items      : orderItems,
            totalAmount,
            orderStatus: 'Pending',
            orderDate  : new Date()
        });

        const due = await Due.create({
            student    : student._id,
            dueType    : 'Mess Order',
            amount     : totalAmount,
            dueDate    : new Date(Date.now() + 24 * 3600000),
            status     : 'Pending',
            description: `Mess order — ${new Date().toLocaleDateString()}`,
            sourceType : 'FoodOrder',
            sourceRef  : order._id
        });

        // FIX: order.due was never linked back — warden/admin's order
        // table always showed dueStatus 'Unknown' and the Cash button
        // never disappeared after payment was confirmed.
        order.due = due._id;
        await order.save();

        // ── Notify warden about the new mess order ────────────────────
        // FIX: this notification was entirely missing — postFoodOrder
        // created the order + Due but never alerted the warden, unlike
        // every other student-initiated request flow (leave, room
        // request, visitor request, etc.) which all notify the warden.
        try {
            const warden = await User.findOne({ role: 'warden' }).lean();
            if (warden) {
                const studentName = student.user?.fullname || 'A student';
                await Notification.create({
                    title     : 'New Mess Order',
                    message   : `${studentName} placed a mess order of Rs ${totalAmount.toLocaleString()}.`,
                    recipient : warden._id,
                    category  : 'Requests',
                    relatedTo : { model: 'FoodOrder', docId: order._id },
                    createdBy : student.user._id,
                    priority  : 'Low'
                });
            }
        } catch (notifErr) {
            console.error('Mess order notification error:', notifErr);
        }
        // ────────────────────────────────────────────────────────────

        res.redirect('/student/mess?success=Order+placed.+Proceed+to+Pending+Payments+to+pay.');
    } catch (err) {
        console.error('postFoodOrder:', err);
        res.redirect('/student/mess?error=Failed+to+place+order.');
    }
};

exports.cancelFoodOrder = async (req, res) => {
    try {
        const base  = await buildBaseLocals(req);
        const order = await FoodOrder.findOne({ _id: req.params.id, student: base.student._id });
        if (!order) return res.redirect('/student/mess?error=Order+not+found.');
        if (!['Pending', 'Accepted'].includes(order.orderStatus)) {
            return res.redirect('/student/mess?error=This+order+cannot+be+cancelled.');
        }

        order.orderStatus = 'Cancelled';
        await order.save();

        const due = await Due.findOne({ sourceType: 'FoodOrder', sourceRef: order._id });
        if (due && due.status === 'Pending') {
            due.amount      = Math.ceil(due.amount * 0.5);
            due.description = due.description + ' (partial refund — 50% cancellation fee)';
            await due.save();
        }

        res.redirect('/student/mess?success=Order+cancelled.+Partial+refund+applied.');
    } catch (err) {
        console.error('cancelFoodOrder:', err);
        res.redirect('/student/mess?error=Failed+to+cancel+order.');
    }
};

// ─────────────────────────────────────────────────────────────
// LAUNDRY
// ─────────────────────────────────────────────────────────────
exports.getLaundry = async (req, res) => {
    try {
        const base    = await buildBaseLocals(req);
        const student = base.student;
        const weekKey = getWeekKey();

        let weeklyRequest = await LaundryRequest.findOne({ student: student._id, weekKey });
        if (!weeklyRequest) {
            const now             = new Date();
            const day             = now.getDay();
            const daysUntilMonday = day === 0 ? 1 : 8 - day;
            const pickup          = new Date(now); pickup.setDate(now.getDate() + daysUntilMonday); pickup.setHours(8, 0, 0, 0);
            const delivery        = new Date(pickup); delivery.setDate(pickup.getDate() + 2);

            weeklyRequest = await LaundryRequest.create({
                student     : student._id,
                weekKey,
                pickupDate  : pickup,
                deliveryDate: delivery,
                requested   : true,
                status      : 'Pending Pickup',
                isChargeable: false
            });
        }

        const secondRequest = await LaundryRequest.findOne({
            student     : student._id,
            weekKey,
            isChargeable: true
        }).lean();

        const history = await LaundryRequest.find({ student: student._id })
            .sort({ createdAt: -1 }).limit(16).lean();

        res.render('student/laundry', {
            ...base,
            activePage   : 'laundry',
            pageTitle    : 'Laundry',
            pageSubtitle : 'Weekly pickup & delivery service',
            weeklyRequest: weeklyRequest.toObject(),
            secondRequest,
            history,
            weekKey,
            successMessage: req.query.success || null,
            errorMessage  : req.query.error   || null
        });
    } catch (err) {
        console.error('getLaundry:', err);
        res.status(500).send('Server Error');
    }
};

exports.optOutLaundry = async (req, res) => {
    try {
        const base    = await buildBaseLocals(req);
        const weekKey = getWeekKey();
        const req2    = await LaundryRequest.findOne({ student: base.student._id, weekKey, isChargeable: false });
        if (!req2) return res.redirect('/student/laundry?error=Weekly+request+not+found.');
        if (req2.status !== 'Pending Pickup') return res.redirect('/student/laundry?error=Pickup+already+in+progress.');
        req2.requested = false;
        req2.status    = 'Cancelled';
        await req2.save();

        // ── Notify warden so a cancelled pickup doesn't sit on their
        // board as "pending" for a request that's no longer happening ──
        try {
            const warden = await User.findOne({ role: 'warden' }).lean();
            if (warden) {
                const studentName = base.student.user?.fullname || 'A student';
                await Notification.create({
                    title     : 'Laundry Opt-Out',
                    message   : `${studentName} has opted out of this week's (${weekKey}) free laundry pickup.`,
                    recipient : warden._id,
                    category  : 'Requests',
                    relatedTo : { model: 'LaundryRequest', docId: req2._id },
                    createdBy : base.student.user._id,
                    priority  : 'Low'
                });
            }
        } catch (notifErr) {
            console.error('Laundry opt-out notification error:', notifErr);
        }
        // ────────────────────────────────────────────────────────────

        res.redirect('/student/laundry?success=Opted+out+of+this+week\'s+laundry.');
    } catch (err) {
        res.redirect('/student/laundry?error=Failed+to+opt+out.');
    }
};

exports.requestSecondLaundry = async (req, res) => {
    try {
        const base    = await buildBaseLocals(req);
        const student = base.student;
        const weekKey = getWeekKey();
        const { bagCount } = req.body;

        const existing = await LaundryRequest.findOne({ student: student._id, weekKey, isChargeable: true });
        if (existing) return res.redirect('/student/laundry?error=Second+pickup+already+requested+this+week.');

        const pickup   = new Date(); pickup.setHours(8, 0, 0, 0);
        const delivery = new Date(pickup); delivery.setDate(pickup.getDate() + 2);

        const secondReq = await LaundryRequest.create({
            student     : student._id,
            weekKey,
            pickupDate  : pickup,
            deliveryDate: delivery,
            itemCount   : parseInt(bagCount) || 1,
            requested   : true,
            status      : 'Pending Pickup',
            isChargeable: true
        });

        await Due.create({
            student    : student._id,
            dueType    : 'Laundry',
            amount     : 200,
            dueDate    : delivery,
            status     : 'Pending',
            description: `Second laundry pickup — ${weekKey}`,
            sourceType : 'LaundryRequest',
            sourceRef  : secondReq._id
        });

        // ── Notify warden about the new paid pickup request ──────────
        // FIX: this notification was entirely missing — every other
        // student-initiated request (leave, room request, visitor
        // request, mess order) notifies the warden, but laundry's
        // second-pickup request never did, so wardens had no way of
        // knowing a paid pickup needed action until they happened to
        // check the Laundry page manually.
        try {
            const warden = await User.findOne({ role: 'warden' }).lean();
            if (warden) {
                const studentName = student.user?.fullname || 'A student';
                await Notification.create({
                    title     : 'New Paid Laundry Pickup Requested',
                    message   : `${studentName} has requested a second (paid) laundry pickup for ${weekKey}.`,
                    recipient : warden._id,
                    category  : 'Requests',
                    relatedTo : { model: 'LaundryRequest', docId: secondReq._id },
                    createdBy : student.user._id,
                    priority  : 'Low'
                });
            }
        } catch (notifErr) {
            console.error('Second laundry pickup notification error:', notifErr);
        }
        // ────────────────────────────────────────────────────────────

        res.redirect('/student/laundry?success=Second+pickup+requested.+Pay+via+Pending+Payments.');
    } catch (err) {
        console.error('requestSecondLaundry:', err);
        res.redirect('/student/laundry?error=Failed+to+request+second+pickup.');
    }
};

exports.cancelSecondLaundry = async (req, res) => {
    try {
        const base    = await buildBaseLocals(req);
        const student = base.student;

        const lr = await LaundryRequest.findOne({
            _id         : req.params.id,
            student     : student._id,
            isChargeable: true
        });

        if (!lr) return res.redirect('/student/laundry?error=Second+pickup+request+not+found.');

        if (lr.status !== 'Pending Pickup') {
            return res.redirect('/student/laundry?error=This+pickup+has+already+started+and+cannot+be+cancelled.');
        }

        // The "pending payment" for this request
        const due = await Due.findOne({ sourceType: 'LaundryRequest', sourceRef: lr._id });

        if (due && due.status === 'Paid') {
            return res.redirect('/student/laundry?error=This+pickup+has+already+been+paid+for+and+cannot+be+cancelled.');
        }

        if (due) {
            // Remove any not-yet-verified payment submissions tied to it too
            await Payment.deleteMany({ dues: due._id, status: { $ne: 'Verified' } });
            await Due.findByIdAndDelete(due._id);
        }

        await LaundryRequest.findByIdAndDelete(lr._id);

        try {
            const warden = await User.findOne({ role: 'warden' }).lean();
            if (warden) {
                const studentName = student.user?.fullname || 'A student';
                await Notification.create({
                    title     : 'Second Laundry Pickup Cancelled',
                    message   : `${studentName} has cancelled their second (paid) laundry pickup for ${lr.weekKey}.`,
                    recipient : warden._id,
                    category  : 'Requests',
                    createdBy : student.user._id,
                    priority  : 'Low'
                });
            }
        } catch (notifErr) {
            console.error('Second laundry cancel notification error:', notifErr);
        }

        res.redirect('/student/laundry?success=Second+pickup+request+cancelled.');
    } catch (err) {
        console.error('cancelSecondLaundry:', err);
        res.redirect('/student/laundry?error=Failed+to+cancel+second+pickup.');
    }
};

// ─────────────────────────────────────────────────────────────
// MOBILE LOAD
// ─────────────────────────────────────────────────────────────
exports.getMobileLoad = async (req, res) => {
    try {
        const base     = await buildBaseLocals(req);
        const requests = await MobileLoad.find({ student: base.student._id })
            .sort({ createdAt: -1 }).lean();

        res.render('student/mobile-load', {
            ...base,
            activePage   : 'mobile-load',
            pageTitle    : 'Mobile Load',
            pageSubtitle : 'Request mobile balance top-up',
            requests,
            successMessage: req.query.success || null,
            errorMessage  : req.query.error   || null
        });
    } catch (err) {
        console.error('getMobileLoad:', err);
        res.status(500).send('Server Error');
    }
};

exports.postMobileLoadRequest = async (req, res) => {
    try {
        const base    = await buildBaseLocals(req);
        const student = base.student;
        const { mobileNumber, network, amount } = req.body;

        if (!mobileNumber || !network || !amount) {
            return res.redirect('/student/mobile-load?error=All+fields+are+required.&page=request');
        }
        const amt = parseFloat(amount);
        if (isNaN(amt) || amt <= 0) {
            return res.redirect('/student/mobile-load?error=Invalid+amount.&page=request');
        }

        const mlReq = await MobileLoad.create({
            student      : student._id,
            mobileNumber,
            network,
            amount       : amt,
            requestStatus: 'Pending'
        });

        await Due.create({
            student    : student._id,
            dueType    : 'Mobile Load',
            amount     : amt,
            dueDate    : new Date(Date.now() + 24 * 3600000),
            status     : 'Pending',
            description: `Mobile load (${network}) — ${mobileNumber}`,
            sourceType : 'MobileLoad',
            sourceRef  : mlReq._id
        });

        // ── Notify warden about the new mobile load request ──────────
        // FIX: this notification was entirely missing — every other
        // student-initiated request (leave, room request, visitor
        // request, mess order, laundry) notifies the warden, but mobile
        // load never did, so wardens had no way of knowing a new request
        // needed action until they happened to check the page manually.
        try {
            const warden = await User.findOne({ role: 'warden' }).lean();
            if (warden) {
                const studentName = student.user?.fullname || 'A student';
                await Notification.create({
                    title     : 'New Mobile Load Request',
                    message   : `${studentName} has requested a Rs. ${amt} top-up for ${mobileNumber} (${network}).`,
                    recipient : warden._id,
                    category  : 'Requests',
                    relatedTo : { model: 'MobileLoad', docId: mlReq._id },
                    createdBy : student.user._id,
                    priority  : 'Low'
                });
            }
        } catch (notifErr) {
            console.error('Mobile load request notification error:', notifErr);
        }
        // ────────────────────────────────────────────────────────────

        res.redirect('/student/mobile-load?success=Request+submitted.+Pay+via+Pending+Payments+to+activate.');
    } catch (err) {
        console.error('postMobileLoadRequest:', err);
        res.redirect('/student/mobile-load?error=Failed+to+submit+request.');
    }
};

// ─────────────────────────────────────────────────────────────
// FEE & FINE  (view-only for student)
// ─────────────────────────────────────────────────────────────
exports.getFeeFine = async (req, res) => {
    try {
        const base    = await buildBaseLocals(req);
        const student = base.student;

        const [dues, fines] = await Promise.all([
            Due.find({ student: student._id, dueType: 'Hostel Fee' }).sort({ dueDate: -1 }).lean(),
            Fine.find({ student: student._id }).sort({ createdAt: -1 }).lean()
        ]);

        const unpaidFees  = dues.filter(d => d.status !== 'Paid');
        const paidFees    = dues.filter(d => d.status === 'Paid');
        const unpaidFines = fines.filter(f => f.status === 'Pending');
        const paidFines   = fines.filter(f => f.status !== 'Pending');

        res.render('student/fee-fine', {
            ...base,
            activePage   : 'fee-fine',
            pageTitle    : 'Fee & Fine',
            pageSubtitle : 'View your hostel fee and fine records',
            dues,
            fines,
            unpaidFees,
            paidFees,
            unpaidFines,
            paidFines,
            successMessage: req.query.success || null,
            errorMessage  : req.query.error   || null
        });
    } catch (err) {
        console.error('getFeeFine:', err);
        res.status(500).send('Server Error');
    }
};

// ─────────────────────────────────────────────────────────────
// PENDING PAYMENTS
// ─────────────────────────────────────────────────────────────
exports.getPendingPayments = async (req, res) => {
    try {
        const base    = await buildBaseLocals(req);
        const student = base.student;

        const pendingDues = await Due.find({
            student: student._id,
            status : { $in: ['Pending', 'Partially Paid', 'Overdue'] }
        }).sort({ dueDate: 1 }).lean();

        const paymentHistory = await Payment.find({ student: student._id })
            .sort({ paymentDate: -1 }).lean();

        res.render('student/pending-payments', {
            ...base,
            activePage   : 'pending-payments',
            pageTitle    : 'Pending Payments',
            pageSubtitle : 'Pay your outstanding dues',
            pendingDues,
            paymentHistory,
            successMessage: req.query.success || null,
            errorMessage  : req.query.error   || null
        });
    } catch (err) {
        console.error('getPendingPayments:', err);
        res.status(500).send('Server Error');
    }
};

exports.postPayment = async (req, res) => {
    try {
        const base    = await buildBaseLocals(req);
        const student = base.student;
        const { dueIds, paymentMethod, transactionId } = req.body;

        if (!dueIds || !paymentMethod) {
            return res.redirect('/student/pending-payments?error=Please+select+dues+and+payment+method.');
        }

        const ids  = Array.isArray(dueIds) ? dueIds : [dueIds];
        const dues = await Due.find({ _id: { $in: ids }, student: student._id, status: { $in: ['Pending', 'Overdue'] } });

        if (!dues.length) return res.redirect('/student/pending-payments?error=No+valid+dues+selected.');

        const totalAmount = dues.reduce((sum, d) => sum + d.amount, 0);

        await Payment.create({
            student      : student._id,
            paymentType  : dues.length === 1 ? dues[0].dueType : 'Multiple',
            paymentMethod,
            amount       : totalAmount,
            transactionId: transactionId || null,
            status       : 'Pending',
            dues         : ids,
            receiptImage : req.file ? 'uploads/receipts/' + req.file.filename : null
        });

        res.redirect('/student/pending-payments?success=Payment+submitted.+' +
            (paymentMethod === 'Cash' ? 'Hand+cash+to+admin+office.' : 'Admin+will+verify+your+transaction.'));
    } catch (err) {
        console.error('postPayment:', err);
        res.redirect('/student/pending-payments?error=Payment+submission+failed.');
    }
};

// ─────────────────────────────────────────────────────────────
// NOTIFICATIONS
// ─────────────────────────────────────────────────────────────
exports.getNotifications = async (req, res) => {
    try {
        const base     = await buildBaseLocals(req);
        const userId   = req.user._id;
        const category = req.query.category || 'all';

        const query = {
            isActive: true,
            $or: [
                { target: { $in: ['All', 'Students'] } },
                { recipient: userId }
            ]
        };
        if (category !== 'all') query.category = category;

        const notifications = await Notification.find(query)
            .sort({ createdAt: -1 }).lean();

        notifications.forEach(n => {
            n._isUnread = !n.readBy || !n.readBy.map(String).includes(String(userId));
            n._timeAgo  = timeAgo(n.createdAt);
        });

        res.render('student/notifications', {
            ...base,
            activePage    : 'notifications',
            pageTitle     : 'Notifications',
            pageSubtitle  : 'All your updates and announcements',
            notifications,
            activeCategory: category,
            successMessage: req.query.success || null,
            errorMessage  : req.query.error   || null
        });
    } catch (err) {
        console.error('getNotifications:', err);
        res.status(500).send('Server Error');
    }
};

exports.markAllNotificationsRead = async (req, res) => {
    try {
        const userId = req.user._id;
        await Notification.updateMany(
            {
                isActive: true,
                readBy  : { $nin: [userId] },
                $or: [
                    { target: { $in: ['All', 'Students'] } },
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
// SHARED — resolve dueIds/amount/cabBookingId into a payable total.
// Used by both JazzCash and Easypaisa gateway initiation.
// ─────────────────────────────────────────────────────────────
async function resolveDuesForPayment(student, { dueIds, amount, paymentType, description, cabBookingId }) {
    let totalAmount  = 0;
    let selectedDues = [];
    let finalDesc    = description || 'Hostel Payment';
    let finalPayType = paymentType || 'Hostel Fee';

    if (cabBookingId) {
        const booking = await CabBooking.findOne({ _id: cabBookingId, student: student._id });
        if (!booking) return { error: 'Cab booking not found.' };

        if (['Pending', 'Cancelled'].includes(booking.status)) {
            return { error: 'Payment is not available for this booking yet — it must be accepted by a driver first.' };
        }
        if (booking.paymentStatus === 'Paid') {
            return { error: 'This booking has already been paid for.' };
        }
        if (!booking.fare || booking.fare <= 0) {
            return { error: 'A fare has not been set for this booking yet.' };
        }

        return {
            totalAmount : booking.fare,
            selectedDues: [],
            finalDesc   : `Cab Booking Payment — ${booking.pickupLocation} to ${booking.dropoffLocation}`,
            finalPayType: 'Cab Booking',
            cabBooking  : booking
        };
    }

    if (dueIds && dueIds.length > 0) {
        const ids = Array.isArray(dueIds) ? dueIds : [dueIds];
        selectedDues = await Due.find({
            _id    : { $in: ids },
            student: student._id,
            status : { $in: ['Pending', 'Partially Paid', 'Overdue'] }
        });

        if (selectedDues.length === 0) {
            return { error: 'No valid outstanding dues found.' };
        }

        totalAmount  = selectedDues.reduce((sum, d) => sum + d.amount, 0);
        finalDesc    = selectedDues.length === 1
            ? selectedDues[0].dueType + ' Payment'
            : 'Multiple Dues Payment (' + selectedDues.length + ' dues)';
        finalPayType = selectedDues.length === 1 ? selectedDues[0].dueType : 'Multiple';

    } else if (amount && Number(amount) > 0) {
        totalAmount = Number(amount);
    } else {
        return { error: 'Please select dues to pay or enter a valid amount.' };
    }

    if (totalAmount <= 0) {
        return { error: 'Payment amount must be greater than zero.' };
    }

    return { totalAmount, selectedDues, finalDesc, finalPayType };
}

// ─────────────────────────────────────────────────────────────
// SHARED — settle every Due linked to a gateway payment and alert
// the warden if that due traces back to a mess/laundry/mobile-load
// service order. Used by both JazzCash and Easypaisa callbacks.
// ─────────────────────────────────────────────────────────────
const GATEWAY_SOURCE_LABELS = {
    FoodOrder     : 'Mess Order',
    LaundryRequest: 'Laundry Request',
    MobileLoad    : 'Mobile Load'
};

async function settleDuesAndNotifyWarden(payment) {
    if (!payment.dues || payment.dues.length === 0) return;

    const linkedDues = await Due.find({ _id: { $in: payment.dues } });
    for (const due of linkedDues) {
        due.status     = 'Paid';
        due.paidAmount = due.amount;
        await due.save();

        if (due.sourceType && GATEWAY_SOURCE_LABELS[due.sourceType]) {
            try {
                await Notification.create({
                    title    : GATEWAY_SOURCE_LABELS[due.sourceType] + ' — Payment Confirmed',
                    message  : `Online payment of Rs ${due.amount.toLocaleString()} confirmed via ${payment.paymentMethod} for a ${GATEWAY_SOURCE_LABELS[due.sourceType].toLowerCase()}. Ready to process.`,
                    target   : 'Wardens',
                    category : 'Payments',
                    priority : 'Medium',
                    createdBy: payment.student.user._id,
                    relatedTo: { model: due.sourceType, docId: due.sourceRef }
                });
            } catch (notifyErr) {
                console.error('Warden notify (gateway callback) failed:', notifyErr);
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────
// SHARED — settle a CabBooking's fare once its linked gateway
// payment is verified, and alert the driver/admins/wardens so the
// paid status is reflected everywhere. Used by both JazzCash and
// Easypaisa callbacks.
// ─────────────────────────────────────────────────────────────
async function settleCabBookingAndNotify(payment) {
    if (!payment.cabBooking) return;

    // Atomic: only flips Unpaid → Paid once, so a retried gateway
    // callback can never double-settle or double-notify.
    const booking = await CabBooking.findOneAndUpdate(
        { _id: payment.cabBooking, paymentStatus: 'Unpaid' },
        { $set: { paymentStatus: 'Paid', payment: payment._id } },
        { new: true }
    );
    if (!booking) return;

    const routeMsg = `${booking.pickupLocation} → ${booking.dropoffLocation}`;
    const amountMsg = `Rs ${payment.amount.toLocaleString()} via ${payment.paymentMethod}`;
    const createdBy = payment.student && payment.student.user ? payment.student.user._id : null;
    if (!createdBy) return;

    try {
        await Notification.create({
            title    : 'Cab Booking Payment Received',
            message  : `Payment of ${amountMsg} received for the cab booking (${routeMsg}).`,
            recipient: booking.driver,
            category : 'Payments',
            priority : 'Medium',
            createdBy,
            relatedTo: { model: 'CabBooking', docId: booking._id }
        });
        await Notification.create({
            title    : 'Cab Booking Payment Received',
            message  : `Payment of ${amountMsg} received for a cab booking (${routeMsg}).`,
            target   : 'Admins',
            category : 'Payments',
            priority : 'Low',
            createdBy,
            relatedTo: { model: 'CabBooking', docId: booking._id }
        });
        await Notification.create({
            title    : 'Cab Booking Payment Received',
            message  : `Payment of ${amountMsg} received for a cab booking (${routeMsg}).`,
            target   : 'Wardens',
            category : 'Payments',
            priority : 'Low',
            createdBy,
            relatedTo: { model: 'CabBooking', docId: booking._id }
        });
    } catch (notifyErr) {
        console.error('settleCabBookingAndNotify: notification error:', notifyErr);
    }
}

// ─────────────────────────────────────────────────────────────
// JAZZCASH PAYMENT (Mobile Wallet / MPIN — automated, no admin step)
// ─────────────────────────────────────────────────────────────

// POST /student/payments/jazzcash/initiate
// Student submits: mobileNumber + dueIds[] (selected dues to pay)
exports.initiateJazzCashPayment = async (req, res) => {
    try {
        const base    = await buildBaseLocals(req);
        const student = base.student;

        const { mobileNumber, dueIds, amount, paymentType, description, cabBookingId } = req.body;

        const normalizedMobile = jazzcash.normalizeMobile(mobileNumber);
        if (!/^03\d{9}$/.test(normalizedMobile)) {
            return res.status(400).json({
                error: 'Invalid JazzCash number. Please enter a valid 11-digit Pakistani mobile number (03XXXXXXXXX).'
            });
        }

        const resolved = await resolveDuesForPayment(student, { dueIds, amount, paymentType, description, cabBookingId });
        if (resolved.error) return res.status(400).json({ error: resolved.error });

        const { totalAmount, selectedDues, finalDesc, finalPayType } = resolved;

        // ── Create a Pending Payment record ─────────────────────────
        const txnRef = jazzcash.generateTxnRef();

        const payment = await Payment.create({
            student      : student._id,
            paymentType  : finalPayType,
            paymentMethod: 'JazzCash',
            amount       : totalAmount,
            status       : 'Pending',
            transactionId: txnRef,
            dues         : selectedDues.map(d => d._id),
            cabBooking   : resolved.cabBooking ? resolved.cabBooking._id : null,
            remarks      : finalDesc,
            source       : 'Gateway'
        });

        // ── Call JazzCash API ────────────────────────────────────────
        const jcResult = await jazzcash.initiateTransaction({
            mobileNumber : normalizedMobile,
            amountRs     : totalAmount,
            billReference: payment._id.toString(),
            description  : finalDesc,
            txnRef
        });

        if (!jcResult.success) {
            payment.status  = 'Rejected';
            payment.remarks = (payment.remarks || '') + ' | JazzCash: ' + jcResult.responseMessage;
            await payment.save();

            return res.status(400).json({
                error: jazzcash.getResponseDescription(jcResult.responseCode) ||
                       jcResult.responseMessage ||
                       'JazzCash payment initiation failed.'
            });
        }

        payment.transactionId = jcResult.txnRefNo;
        await payment.save();

        return res.json({
            success        : true,
            message        : 'An MPIN request has been sent to ' + normalizedMobile + '. Please approve on your phone.',
            txnRefNo       : jcResult.txnRefNo,
            paymentId      : payment._id,
            amount         : totalAmount,
            responseCode   : jcResult.responseCode,
            responseMessage: jcResult.responseMessage
        });

    } catch (err) {
        console.error('initiateJazzCashPayment:', err);
        return res.status(500).json({ error: 'Server error. Please try again.' });
    }
};

// POST /student/payments/jazzcash/callback
// JazzCash posts the final result here after the student approves/rejects
// on their phone. PUBLIC — no auth middleware, JazzCash's server hits this
// directly and has no session cookie.
exports.jazzCashCallback = async (req, res) => {
    try {
        const cb = jazzcash.parseCallback(req.body);

        console.log('JazzCash callback received:', {
            txnRef      : cb.txnRefNo,
            responseCode: cb.responseCode,
            isValid     : cb.isValid,
            isSuccess   : cb.isSuccess
        });

        if (!cb.isValid) {
            console.warn('JazzCash callback hash verification FAILED — possible tampering');
            return res.redirect('/student/payments/jazzcash/result?status=error&reason=invalid_hash');
        }

        let payment = await Payment.findOne({ transactionId: cb.txnRefNo })
            .populate({ path: 'student', populate: { path: 'user', select: '_id fullname' } });

        if (!payment) {
            payment = await Payment.findById(cb.billReference)
                .populate({ path: 'student', populate: { path: 'user', select: '_id fullname' } });
        }

        if (!payment) {
            console.warn('JazzCash callback: payment not found for txnRef:', cb.txnRefNo);
            return res.redirect('/student/payments/jazzcash/result?status=error&reason=not_found');
        }

        return processJazzCashCallback(payment, cb, res);

    } catch (err) {
        console.error('jazzCashCallback:', err);
        return res.redirect('/student/payments/jazzcash/result?status=error&reason=server_error');
    }
};

async function processJazzCashCallback(payment, cb, res) {
    // Prevent double-processing if JazzCash retries the callback
    if (payment.status === 'Verified') {
        return res.redirect('/student/payments/jazzcash/result?status=success&paymentId=' + payment._id);
    }

    if (cb.isSuccess) {
        payment.status              = 'Verified';
        payment.verifiedAt          = new Date();
        payment.gatewayResponseCode = cb.responseCode;
        payment.remarks             = (payment.remarks || '') + ' | Auth: ' + (cb.authCode || 'N/A') + ' RRN: ' + (cb.rrn || 'N/A');
        await payment.save();

        await settleDuesAndNotifyWarden(payment);
        await settleCabBookingAndNotify(payment);

        if (payment.student && payment.student.user) {
            await Notification.create({
                title    : 'Payment Successful — JazzCash',
                message  : `Your JazzCash payment of Rs ${payment.amount.toLocaleString()} has been verified successfully. Auth: ${cb.authCode || 'N/A'}`,
                recipient: payment.student.user._id,
                category : 'Payments',
                priority : 'Low',
                createdBy: payment.student.user._id,
                relatedTo: { model: 'Payment', docId: payment._id }
            });
        }

        return res.redirect('/student/payments/jazzcash/result?status=success&paymentId=' + payment._id);

    } else {
        payment.status              = 'Rejected';
        payment.gatewayResponseCode = cb.responseCode;
        payment.remarks             = (payment.remarks || '') + ' | Failed: ' + cb.responseMessage;
        await payment.save();

        if (payment.student && payment.student.user) {
            const friendlyMsg = jazzcash.getResponseDescription(cb.responseCode);
            await Notification.create({
                title    : 'JazzCash Payment Failed',
                message  : `Your JazzCash payment of Rs ${payment.amount.toLocaleString()} failed. ${friendlyMsg}`,
                recipient: payment.student.user._id,
                category : 'Payments',
                priority : 'Medium',
                createdBy: payment.student.user._id,
                relatedTo: { model: 'Payment', docId: payment._id }
            });
        }

        return res.redirect(
            '/student/payments/jazzcash/result?status=failed' +
            '&code=' + (cb.responseCode || '') +
            '&paymentId=' + payment._id
        );
    }
}

// GET /student/payments/jazzcash/status/:txnRef
// Polled by the browser every 4s while the student waits for MPIN approval
exports.getPaymentStatus = async (req, res) => {
    try {
        const student = await Student.findOne({ user: req.user._id });
        if (!student) return res.status(404).json({ error: 'Student record not found.' });

        const payment = await Payment.findOne({
            transactionId: req.params.txnRef,
            student      : student._id
        });

        if (!payment) return res.status(404).json({ error: 'Payment not found.' });

        return res.json({
            status   : payment.status,
            paymentId: payment._id,
            amount   : payment.amount,
            updatedAt: payment.updatedAt
        });

    } catch (err) {
        console.error('getPaymentStatus:', err);
        return res.status(500).json({ error: 'Server error.' });
    }
};

// GET /student/payments/jazzcash/result
// GET /student/payments/easypaisa/result
// Result page the gateway's callback redirects to
exports.showPaymentResult = async (req, res) => {
    try {
        const base = await buildBaseLocals(req);
        const { status, paymentId, code, reason } = req.query;

        let payment = null;
        if (paymentId) {
            payment = await Payment.findById(paymentId)
                .populate({ path: 'student', populate: { path: 'user', select: 'fullname userId' } })
                .lean();
        }

        const gatewayName    = payment ? payment.paymentMethod : 'Gateway';
        const gatewayService = gatewayName === 'Easypaisa' ? easypaisa : jazzcash;
        const codeMsg         = code ? gatewayService.getResponseDescription(code) : null;

        res.render('student/payment-result', {
            ...base,
            activePage  : 'pending-payments',
            pageTitle   : 'Payment Result',
            pageSubtitle: gatewayName + ' transaction status',
            status,
            payment,
            codeMsg,
            reason
        });

    } catch (err) {
        console.error('showPaymentResult:', err);
        res.redirect('/student/dashboard');
    }
};

// ─────────────────────────────────────────────────────────────
// EASYPAISA PAYMENT (Mobile Account — automated, no admin step)
// ─────────────────────────────────────────────────────────────

// POST /student/payments/easypaisa/initiate
// Student submits: mobileNumber + dueIds[] (selected dues to pay)
exports.initiateEasypaisaPayment = async (req, res) => {
    try {
        const base    = await buildBaseLocals(req);
        const student = base.student;

        const { mobileNumber, dueIds, amount, paymentType, description, cabBookingId } = req.body;

        const normalizedMobile = easypaisa.normalizeMobile(mobileNumber);
        if (!/^03\d{9}$/.test(normalizedMobile)) {
            return res.status(400).json({
                error: 'Invalid Easypaisa number. Please enter a valid 11-digit Pakistani mobile number (03XXXXXXXXX).'
            });
        }

        const resolved = await resolveDuesForPayment(student, { dueIds, amount, paymentType, description, cabBookingId });
        if (resolved.error) return res.status(400).json({ error: resolved.error });

        const { totalAmount, selectedDues, finalDesc, finalPayType } = resolved;

        // ── Create a Pending Payment record ─────────────────────────
        const orderId = easypaisa.generateOrderId();

        const payment = await Payment.create({
            student      : student._id,
            paymentType  : finalPayType,
            paymentMethod: 'Easypaisa',
            amount       : totalAmount,
            status       : 'Pending',
            transactionId: orderId,
            dues         : selectedDues.map(d => d._id),
            cabBooking   : resolved.cabBooking ? resolved.cabBooking._id : null,
            remarks      : finalDesc,
            source       : 'Gateway'
        });

        // ── Call Easypaisa API ────────────────────────────────────────
        const epResult = await easypaisa.initiateTransaction({
            mobileNumber,
            amountRs   : totalAmount,
            orderId,
            emailAddress: student.user && student.user.email
        });

        if (!epResult.success) {
            payment.status  = 'Rejected';
            payment.remarks = (payment.remarks || '') + ' | Easypaisa: ' + epResult.responseMessage;
            await payment.save();

            return res.status(400).json({
                error: easypaisa.getResponseDescription(epResult.responseCode) ||
                       epResult.responseMessage ||
                       'Easypaisa payment initiation failed.'
            });
        }

        payment.transactionId = epResult.orderId;
        await payment.save();

        return res.json({
            success        : true,
            message        : 'A payment request has been sent to ' + normalizedMobile + '. Please approve it in your Easypaisa app.',
            orderId        : epResult.orderId,
            paymentId      : payment._id,
            amount         : totalAmount,
            responseCode   : epResult.responseCode,
            responseMessage: epResult.responseMessage
        });

    } catch (err) {
        console.error('initiateEasypaisaPayment:', err);
        return res.status(500).json({ error: 'Server error. Please try again.' });
    }
};

// POST /student/payments/easypaisa/callback
// Easypaisa posts the final IPN result here after the student approves/
// rejects in their app. PUBLIC — no auth middleware, Easypaisa's server
// hits this directly and has no session cookie.
exports.easypaisaCallback = async (req, res) => {
    try {
        const cb = easypaisa.parseCallback(req.body);

        console.log('Easypaisa callback received:', {
            orderId     : cb.orderId,
            responseCode: cb.responseCode,
            isSuccess   : cb.isSuccess
        });

        const payment = await Payment.findOne({ transactionId: cb.orderId })
            .populate({ path: 'student', populate: { path: 'user', select: '_id fullname' } });

        if (!payment) {
            console.warn('Easypaisa callback: payment not found for orderId:', cb.orderId);
            return res.redirect('/student/payments/easypaisa/result?status=error&reason=not_found');
        }

        return processEasypaisaCallback(payment, cb, res);

    } catch (err) {
        console.error('easypaisaCallback:', err);
        return res.redirect('/student/payments/easypaisa/result?status=error&reason=server_error');
    }
};

async function processEasypaisaCallback(payment, cb, res) {
    // Prevent double-processing if Easypaisa retries the IPN
    if (payment.status === 'Verified') {
        return res.redirect('/student/payments/easypaisa/result?status=success&paymentId=' + payment._id);
    }

    if (cb.isSuccess) {
        payment.status              = 'Verified';
        payment.verifiedAt          = new Date();
        payment.gatewayResponseCode = cb.responseCode;
        payment.remarks             = (payment.remarks || '') + ' | Easypaisa TxnId: ' + (cb.transactionId || 'N/A');
        await payment.save();

        await settleDuesAndNotifyWarden(payment);
        await settleCabBookingAndNotify(payment);

        if (payment.student && payment.student.user) {
            await Notification.create({
                title    : 'Payment Successful — Easypaisa',
                message  : `Your Easypaisa payment of Rs ${payment.amount.toLocaleString()} has been verified successfully.`,
                recipient: payment.student.user._id,
                category : 'Payments',
                priority : 'Low',
                createdBy: payment.student.user._id,
                relatedTo: { model: 'Payment', docId: payment._id }
            });
        }

        return res.redirect('/student/payments/easypaisa/result?status=success&paymentId=' + payment._id);

    } else {
        payment.status              = 'Rejected';
        payment.gatewayResponseCode = cb.responseCode;
        payment.remarks             = (payment.remarks || '') + ' | Failed: ' + cb.responseMessage;
        await payment.save();

        if (payment.student && payment.student.user) {
            const friendlyMsg = easypaisa.getResponseDescription(cb.responseCode);
            await Notification.create({
                title    : 'Easypaisa Payment Failed',
                message  : `Your Easypaisa payment of Rs ${payment.amount.toLocaleString()} failed. ${friendlyMsg}`,
                recipient: payment.student.user._id,
                category : 'Payments',
                priority : 'Medium',
                createdBy: payment.student.user._id,
                relatedTo: { model: 'Payment', docId: payment._id }
            });
        }

        return res.redirect(
            '/student/payments/easypaisa/result?status=failed' +
            '&code=' + (cb.responseCode || '') +
            '&paymentId=' + payment._id
        );
    }
}

// ─────────────────────────────────────────────────────────────
// TRANSPORT — List approved transport providers
// ─────────────────────────────────────────────────────────────
exports.getTransport = async (req, res) => {
    try {
        const base = await buildBaseLocals(req);

        // Fetch only approved drivers with their Driver profile
        const approvedUsers = await User.find({ role: 'driver', status: 'approved' })
            .select('fullname email userId phoneNumber gender profileImage')
            .lean();

        const userIds = approvedUsers.map(u => u._id);
        const driverProfiles = await Driver.find({ user: { $in: userIds }, isActive: true })
            .lean();

        // Build a map from user._id → driver profile
        const driverMap = {};
        driverProfiles.forEach(d => { driverMap[String(d.user)] = d; });

        // ── Average rating + review count per driver, from rated bookings ──
        const ratingAgg = await CabBooking.aggregate([
            { $match: { driver: { $in: userIds }, rating: { $ne: null } } },
            { $group: { _id: '$driver', avgRating: { $avg: '$rating' }, reviewCount: { $sum: 1 } } }
        ]);
        const ratingMap = {};
        ratingAgg.forEach(r => {
            ratingMap[String(r._id)] = {
                avgRating: Math.round(r.avgRating * 10) / 10,
                reviewCount: r.reviewCount
            };
        });

        // Merge approved users with their driver info
        const providers = approvedUsers.map(u => {
            const driver = driverMap[String(u._id)] || {};
            const ratingInfo = ratingMap[String(u._id)] || { avgRating: 0, reviewCount: 0 };
            // Normalise document image paths for browser URLs
            const normalise = (p) => normaliseImagePath(p);
            return {
                _id: u._id,
                fullname: u.fullname,
                email: u.email,
                userId: u.userId,
                phoneNumber: u.phoneNumber || '—',
                gender: u.gender,
                profileImage: normaliseImagePath(u.profileImage),
                // Driver-specific fields
                cnic: driver.cnic || '—',
                licenseNumber: driver.licenseNumber || '—',
                licenseExpiry: driver.licenseExpiry || null,
                vehicleType: driver.vehicleType || '—',
                vehicleRegistration: driver.vehicleRegistration || '—',
                vehicleModel: driver.vehicleModel || '—',
                serviceArea: driver.serviceArea || '—',
                experienceYears: driver.experienceYears || null,
                isVerified: driver.isVerified || false,
                // Rating summary
                avgRating: ratingInfo.avgRating,
                reviewCount: ratingInfo.reviewCount,
                // Document status — which docs have been uploaded
                hasCnicFront: !!driver.cnicFrontImage,
                hasCnicBack: !!driver.cnicBackImage,
                hasLicenseImage: !!driver.licenseImage,
                hasVehicleDoc: !!driver.vehicleDocImage,
                // Document URLs for view links
                cnicFrontUrl: normalise(driver.cnicFrontImage),
                cnicBackUrl: normalise(driver.cnicBackImage),
                licenseImageUrl: normalise(driver.licenseImage),
                vehicleDocUrl: normalise(driver.vehicleDocImage)
            };
        });

        // Fetch this student's cab booking history
        const myBookings = await CabBooking.find({ student: base.student._id })
            .sort({ createdAt: -1 })
            .lean();

        res.render('student/transport', {
            ...base,
            activePage   : 'transport',
            pageTitle    : 'Transport Services',
            pageSubtitle : 'Approved transport providers',
            providers,
            totalProviders: providers.length,
            myBookings,
            successMessage: req.query.success || null,
            errorMessage  : req.query.error   || null
        });
    } catch (err) {
        console.error('getTransport:', err);
        res.status(500).send('Server Error');
    }
};

// ─────────────────────────────────────────────────────────────
// CAB BOOKING — Book a ride with a transport provider
// ─────────────────────────────────────────────────────────────
exports.postCabBooking = async (req, res) => {
    try {
        const base    = await buildBaseLocals(req);
        const student = base.student;
        const {
            driverId, driverName, driverPhone,
            vehicleType, vehicleRegistration,
            pickupLocation, dropoffLocation,
            pickupDate, pickupTime,
            passengerCount, notes
        } = req.body;

        // ── Validation ──
        if (!driverId || !pickupLocation || !dropoffLocation || !pickupDate) {
            return res.redirect('/student/transport?error=Please+fill+all+required+fields.');
        }

        // Verify the driver exists and is approved
        const driverUser = await User.findOne({ _id: driverId, role: 'driver', status: 'approved' }).lean();
        if (!driverUser) {
            return res.redirect('/student/transport?error=Transport+provider+not+found+or+not+available.');
        }

        // Future date check
        const pickup = new Date(pickupDate);
        const today  = new Date(); today.setHours(0, 0, 0, 0);
        if (pickup < today) {
            return res.redirect('/student/transport?error=Pickup+date+cannot+be+in+the+past.');
        }

        const count = parseInt(passengerCount) || 1;
        if (count < 1 || count > 10) {
            return res.redirect('/student/transport?error=Passenger+count+must+be+between+1+and+10.');
        }

        const booking = await CabBooking.create({
            student            : student._id,
            driver             : driverUser._id,
            driverName         : driverName || driverUser.fullname,
            driverPhone        : driverPhone || driverUser.phoneNumber || '—',
            vehicleType        : vehicleType || null,
            vehicleRegistration: vehicleRegistration || null,
            pickupLocation,
            dropoffLocation,
            pickupDate         : pickup,
            pickupTime         : pickupTime || '',
            passengerCount     : count,
            notes              : notes || '',
            status             : 'Pending'
        });

        // ── Notify the driver about the new booking ────────────────
        try {
            const studentName = student.user?.fullname || 'A student';
            const dateStr = pickup.toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' });
            await Notification.create({
                title     : 'New Cab Booking',
                message   : `${studentName} has booked a cab with you on ${dateStr} from "${pickupLocation}" to "${dropoffLocation}".`,
                recipient : driverUser._id,
                category  : 'Requests',
                relatedTo : { model: 'CabBooking', docId: booking._id },
                createdBy : student.user._id,
                priority  : 'Medium'
            });
        } catch (notifErr) {
            console.error('Cab booking driver notification error:', notifErr);
        }

        // ── Notify warden about the new booking ────────────────────
        try {
            const warden = await User.findOne({ role: 'warden' }).lean();
            if (warden) {
                const studentName = student.user?.fullname || 'A student';
                const dateStr = pickup.toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' });
                await Notification.create({
                    title     : 'New Cab Booking',
                    message   : `${studentName} booked a cab with ${booking.driverName} on ${dateStr}.`,
                    recipient : warden._id,
                    category  : 'Requests',
                    relatedTo : { model: 'CabBooking', docId: booking._id },
                    createdBy : student.user._id,
                    priority  : 'Low'
                });
            }
        } catch (notifErr) {
            console.error('Cab booking warden notification error:', notifErr);
        }

        res.redirect('/student/transport?success=Cab+booked+successfully.+Provider+will+confirm+shortly.');

    } catch (err) {
        console.error('postCabBooking:', err);
        res.redirect('/student/transport?error=Failed+to+book+cab.');
    }
};

// ─────────────────────────────────────────────────────────────
// CAB BOOKING — Cancel a pending booking
// ─────────────────────────────────────────────────────────────
exports.cancelCabBooking = async (req, res) => {
    try {
        const base = await buildBaseLocals(req);

        // ── Atomic cancel: guards against a driver accepting/rejecting (or an
        // admin confirming) this same booking at the same moment. ─────────
        const booking = await CabBooking.findOneAndUpdate(
            { _id: req.params.id, student: base.student._id, status: 'Pending' },
            { $set: {
                status: 'Cancelled',
                cancellation: {
                    by    : 'student',
                    reason: req.body.reason || 'Cancelled by student',
                    at    : new Date()
                }
            } },
            { new: true }
        );

        if (!booking) {
            const existing = await CabBooking.findOne({ _id: req.params.id, student: base.student._id }).select('status').lean();
            if (!existing) {
                return res.redirect('/student/transport?error=Booking+not+found.');
            }
            return res.redirect('/student/transport?error=' + encodeURIComponent(
                `This booking is already ${existing.status.toLowerCase()} and can no longer be cancelled.`
            ));
        }

        // ── Notify the driver about the cancellation ───────────────
        try {
            const studentName = base.student.user?.fullname || 'A student';
            await Notification.create({
                title     : 'Cab Booking Cancelled',
                message   : `${studentName} has cancelled their cab booking. Reason: ${req.body.reason || 'No reason provided'}.`,
                recipient : booking.driver,
                category  : 'Requests',
                relatedTo : { model: 'CabBooking', docId: booking._id },
                createdBy : base.student.user._id,
                priority  : 'Low'
            });
        } catch (notifErr) {
            console.error('Cab booking cancel notification error:', notifErr);
        }

        res.redirect('/student/transport?success=Cab+booking+cancelled.');
    } catch (err) {
        console.error('cancelCabBooking:', err);
        res.redirect('/student/transport?error=Failed+to+cancel+booking.');
    }
};

// ─────────────────────────────────────────────────────────────
// CAB BOOKING — Rate & review a completed ride
// ─────────────────────────────────────────────────────────────
exports.rateCabBooking = async (req, res) => {
    try {
        const base    = await buildBaseLocals(req);
        const student = base.student;
        const { rating, review } = req.body;

        const ratingNum = parseInt(rating);
        if (!ratingNum || ratingNum < 1 || ratingNum > 5) {
            return res.redirect('/student/transport?error=Please+select+a+rating+between+1+and+5+stars.');
        }

        const booking = await CabBooking.findOne({ _id: req.params.id, student: student._id });
        if (!booking) return res.redirect('/student/transport?error=Booking+not+found.');
        if (booking.status !== 'Completed') {
            return res.redirect('/student/transport?error=Only+completed+rides+can+be+rated.');
        }

        const isFirstRating = booking.rating === null || booking.rating === undefined;

        booking.rating  = ratingNum;
        booking.review  = (review || '').trim().slice(0, 500);
        booking.ratedAt = new Date();
        await booking.save();

        // ── Notify the driver about the new/updated rating ────────────
        try {
            const studentName = student.user?.fullname || 'A student';
            await Notification.create({
                title     : isFirstRating ? 'New Ride Rating Received' : 'Ride Rating Updated',
                message   : `${studentName} rated their ride with you ${ratingNum}/5${booking.review ? ': "' + booking.review + '"' : '.'}`,
                recipient : booking.driver,
                category  : 'Requests',
                relatedTo : { model: 'CabBooking', docId: booking._id },
                createdBy : student.user._id,
                priority  : 'Low'
            });
        } catch (notifErr) {
            console.error('Cab rating notification error:', notifErr);
        }

        res.redirect('/student/transport?success=Thank+you+for+rating+your+ride.');
    } catch (err) {
        console.error('rateCabBooking:', err);
        res.redirect('/student/transport?error=Failed+to+submit+rating.');
    }
};

// ─────────────────────────────────────────────────────────────
// AJAX: Cab booking status poll — lets the Transport page detect a
// driver's accept/reject and reveal the assigned driver's contact
// info without requiring a full page reload.
// GET /student/transport/status
// ─────────────────────────────────────────────────────────────
exports.getCabBookingStatuses = async (req, res) => {
    try {
        const student = await Student.findOne({ user: req.user._id }).lean();
        if (!student) return res.status(404).json({ error: 'Student record not found.' });

        const bookings = await CabBooking.find({ student: student._id })
            .select('status confirmedAt fare paymentStatus')
            .lean();

        const statuses = {};
        bookings.forEach(b => {
            statuses[b._id] = {
                status       : b.status,
                confirmedAt  : b.confirmedAt,
                fare         : b.fare,
                paymentStatus: b.paymentStatus
            };
        });

        res.json({ statuses });
    } catch (err) {
        console.error('getCabBookingStatuses:', err);
        res.status(500).json({ error: 'Failed to fetch booking statuses.' });
    }
};

// ─────────────────────────────────────────────────────────────
// VISITORS & GUEST ROOM BOOKINGS
// ─────────────────────────────────────────────────────────────
exports.getVisitors = async (req, res) => {
    try {
        const base    = await buildBaseLocals(req);
        const student = base.student;

        const visitorRequests = await VisitorRequest.find({ student: student._id })
            .sort({ createdAt: -1 }).lean();

        const bookings = await GuestRoomBooking.find({ student: student._id })
            .populate('room', 'roomNo block floor feePerNight')
            .populate('visitorRequest', 'visitorName visitDate')
            .sort({ createdAt: -1 }).lean();

        // Visitor requests that already have an active (Pending/Approved)
        // booking against them — used to hide the "Request Guest Room"
        // button so a student can't spin up a second booking for the same
        // visitor while one is already in flight.
        const bookedVisitorRequestIds = bookings
            .filter(b => ['Pending', 'Approved'].includes(b.status))
            .map(b => String(b.visitorRequest && b.visitorRequest._id ? b.visitorRequest._id : b.visitorRequest));

        // Guest rooms for the booking-request dropdown. Room.status is
        // manual/informational (per Room Management design), so every
        // Guest room is listed here — admin does the real availability
        // check (overlap against existing Approved bookings) when they
        // review the request.
        const guestRooms = await Room.find({ roomCategory: 'Guest' })
            .select('roomNo block floor feePerNight capacity status')
            .sort({ roomNo: 1 }).lean();

        res.render('student/visitors', {
            ...base,
            activePage    : 'visitors',
            pageTitle     : 'Visitors & Guest Rooms',
            pageSubtitle  : 'Request visitor approval and book a guest room',
            visitorRequests,
            bookings,
            bookedVisitorRequestIds,
            guestRooms,
            today         : new Date().toISOString().split('T')[0],
            successMessage: req.query.success || null,
            errorMessage  : req.query.error   || null
        });
    } catch (err) {
        console.error('getVisitors:', err);
        res.status(500).send('Server Error');
    }
};

exports.postVisitorRequest = async (req, res) => {
    try {
        const base    = await buildBaseLocals(req);
        const student = base.student;
        const { visitorName, visitorCNIC, relation, numberOfGuests, visitDate, visitTime, purpose } = req.body;

        if (!visitorName || !visitorCNIC || !relation || !visitDate) {
            return res.redirect('/student/visitors?error=Please+fill+all+required+fields.&page=apply');
        }

        const guests = parseInt(numberOfGuests) || 1;
        if (guests < 1 || guests > 3) {
            return res.redirect('/student/visitors?error=Number+of+guests+must+be+between+1+and+3.&page=apply');
        }

        const vr = await VisitorRequest.create({
            student       : student._id,
            visitorName,
            visitorCNIC,
            relation,
            numberOfGuests: guests,
            visitDate     : new Date(visitDate),
            visitTime     : visitTime || '',
            purpose       : purpose || '',
            status        : 'Pending'
        });

        // ── Notify warden about the new visitor request ──────────────
        try {
            const warden = await User.findOne({ role: 'warden' }).lean();
            if (warden) {
                const studentName = student.user?.fullname || 'A student';
                const dateStr = new Date(visitDate).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' });
                await Notification.create({
                    title     : 'New Visitor Request',
                    message   : `${studentName} has requested a visitor (${visitorName}, ${relation}) on ${dateStr}.`,
                    recipient : warden._id,
                    category  : 'Requests',
                    relatedTo : { model: 'VisitorRequest', docId: vr._id },
                    createdBy : student.user._id,
                    priority  : 'Medium'
                });
            }
        } catch (notifErr) {
            console.error('Visitor request notification error:', notifErr);
        }
        // ────────────────────────────────────────────────────────────

        res.redirect('/student/visitors?success=Visitor+request+submitted.+Warden+will+review+shortly.');
    } catch (err) {
        console.error('postVisitorRequest:', err);
        res.redirect('/student/visitors?error=Failed+to+submit+visitor+request.');
    }
};

exports.cancelVisitorRequest = async (req, res) => {
    try {
        const base   = await buildBaseLocals(req);
        const result = await visitorActions.cancelVisitorRequest(req.params.id, base.student._id);
        if (!result.ok) return res.redirect('/student/visitors?error=' + encodeURIComponent(result.error));
        res.redirect('/student/visitors?success=Visitor+request+cancelled.');
    } catch (err) {
        console.error('cancelVisitorRequest:', err);
        res.redirect('/student/visitors?error=Failed+to+cancel+request.');
    }
};

exports.postGuestBookingRequest = async (req, res) => {
    try {
        const base    = await buildBaseLocals(req);
        const student = base.student;
        const { visitorRequestId, roomId, fromDate, toDate } = req.body;

        if (!visitorRequestId || !roomId || !fromDate || !toDate) {
            return res.redirect('/student/visitors?error=Please+fill+all+required+fields.');
        }

        // Visitor request must belong to this student and already be Approved
        const vr = await VisitorRequest.findOne({ _id: visitorRequestId, student: student._id });
        if (!vr) return res.redirect('/student/visitors?error=Visitor+request+not+found.');
        if (vr.status !== 'Approved') {
            return res.redirect('/student/visitors?error=Visitor+request+must+be+approved+before+booking+a+guest+room.');
        }

        // Only one active (Pending/Approved) booking allowed per visitor request
        const existing = await GuestRoomBooking.findOne({
            visitorRequest: vr._id,
            status: { $in: ['Pending', 'Approved'] }
        });
        if (existing) {
            return res.redirect('/student/visitors?error=A+guest+room+booking+already+exists+for+this+visitor.');
        }

        const room = await Room.findById(roomId);
        if (!room || room.roomCategory !== 'Guest') {
            return res.redirect('/student/visitors?error=Selected+room+is+not+a+valid+Guest+room.');
        }

        const from  = new Date(fromDate);
        const to    = new Date(toDate);
        const today = new Date(); today.setHours(0, 0, 0, 0);

        if (from < today) {
            return res.redirect('/student/visitors?error=From+date+cannot+be+in+the+past.');
        }
        if (to <= from) {
            return res.redirect('/student/visitors?error=To+date+must+be+after+From+date.');
        }

        // FIX: block the request at submission time if this room already
        // has a Pending OR Approved booking for an overlapping date range
        // — previously the only overlap check was at admin approval time,
        // so two students could both submit Pending bookings for the same
        // room/dates and only find out one was rejected after the fact.
        // The dropdown itself is now date-filtered too (see
        // getAvailableGuestRooms below), so this is mainly a safety net
        // for stale dropdown data / direct form submission.
        const conflict = await guestBookingActions.findConflictingBooking(room._id, from, to);
        if (conflict) {
            const cFrom = new Date(conflict.fromDate).toLocaleDateString('en-PK', { day: '2-digit', month: 'short' });
            const cTo   = new Date(conflict.toDate).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' });
            return res.redirect('/student/visitors?error=' + encodeURIComponent(
                `Room ${room.roomNo} already has a booking (${conflict.status}) for an overlapping period (${cFrom} – ${cTo}). Please choose different dates or another room.`
            ));
        }

        const booking = await GuestRoomBooking.create({
            visitorRequest: vr._id,
            student       : student._id,
            room          : room._id,
            fromDate      : from,
            toDate        : to,
            status        : 'Pending'
        });

        // ── Notify Admin — Room Management/Guest Rooms is admin's domain,
        // no warden step for the booking itself ─────────────────────────
        try {
            const studentName = student.user?.fullname || 'A student';
            const fromStr = from.toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' });
            const toStr   = to.toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' });
            await Notification.create({
                title     : 'New Guest Room Booking Request',
                message   : `${studentName} has requested Room ${room.roomNo} (Guest Room) for visitor ${vr.visitorName}, ${fromStr} – ${toStr}.`,
                target    : 'Admins',
                category  : 'Requests',
                relatedTo : { model: 'GuestRoomBooking', docId: booking._id },
                createdBy : student.user._id,
                priority  : 'Medium'
            });
        } catch (notifErr) {
            console.error('Guest booking notification error:', notifErr);
        }
        // ────────────────────────────────────────────────────────────

        res.redirect('/student/visitors?success=Guest+room+booking+request+submitted.+Admin+will+review+shortly.');
    } catch (err) {
        console.error('postGuestBookingRequest:', err);
        res.redirect('/student/visitors?error=Failed+to+submit+booking+request.');
    }
};

exports.cancelGuestBooking = async (req, res) => {
    try {
        const base   = await buildBaseLocals(req);
        const result = await guestBookingActions.cancelBooking(req.params.id, base.student._id);
        if (!result.ok) return res.redirect('/student/visitors?error=' + encodeURIComponent(result.error));
        res.redirect('/student/visitors?success=Guest+room+booking+cancelled.');
    } catch (err) {
        console.error('cancelGuestBooking:', err);
        res.redirect('/student/visitors?error=Failed+to+cancel+booking.');
    }
};

// ─────────────────────────────────────────────────────────────
// AJAX: Available Guest Rooms for a date range
// GET /student/visitors/guest-room/available-rooms?fromDate=&toDate=
//
// Powers the "Request Guest Room" modal's date-driven dropdown — once
// the student picks From/To dates, the frontend calls this to get only
// the rooms actually free for that range, instead of every Guest room
// regardless of existing bookings.
// ─────────────────────────────────────────────────────────────
exports.getAvailableGuestRoomsForDates = async (req, res) => {
    try {
        const { fromDate, toDate } = req.query;
        if (!fromDate || !toDate) {
            return res.status(400).json({ error: 'fromDate and toDate are required.', rooms: [] });
        }

        const from = new Date(fromDate);
        const to   = new Date(toDate);
        const today = new Date(); today.setHours(0, 0, 0, 0);

        if (isNaN(from) || isNaN(to)) {
            return res.status(400).json({ error: 'Invalid date(s).', rooms: [] });
        }
        if (from < today) {
            return res.status(400).json({ error: 'From date cannot be in the past.', rooms: [] });
        }
        if (to <= from) {
            return res.status(400).json({ error: 'To date must be after From date.', rooms: [] });
        }

        const rooms = await guestBookingActions.getAvailableGuestRooms(from, to);
        res.json({ rooms });
    } catch (err) {
        console.error('getAvailableGuestRoomsForDates:', err);
        res.status(500).json({ error: 'Failed to load available rooms.', rooms: [] });
    }
};