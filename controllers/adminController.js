const User              = require('../models/user');
const Student           = require('../models/student');
const Allocation        = require('../models/allocation');
const bcrypt            = require('bcryptjs');
const sendApprovalEmail = require('../utils/sendApprovalEmail');
const Attendance   = require('../models/attendance');
const LeaveRequest = require('../models/leave');
const Complaint    = require('../models/complaint');
const Payment      = require('../models/payment');
const Due          = require('../models/due');
const Room         = require('../models/room');
const Notification = require('../models/notification');
const MobileLoad = require('../models/mobileLoad');
const VisitorRequest = require('../models/visitorRequest');
const GuestRoomBooking = require('../models/guestRoomBooking');
const { getSidebarBadges } = require('../utils/sidebarBadges');
// ======================
// HELPER — normalise the idImage path stored in the DB.
// Multer saves to  public/uploads/ids/file.jpg
// Express static   serves  /uploads/…
// So we strip the leading "public/" so the browser URL is correct.
// ======================
function normaliseImagePath(p) {
    if (!p) return null;
    // Handle both forward-slash and backslash (Windows dev machines)
    return p.replace(/^public[/\\]/, '');
}


// ======================
// USER ID GENERATOR
// ======================
async function generateUserId(role) {
    const prefix =
        role === 'student' ? 'STU' :
        role === 'admin'   ? 'ADM' :
        role === 'warden'  ? 'WAR' : 'USR';

    const year     = new Date().getFullYear();
    const count    = await User.countDocuments({ role });
    const sequence = (count + 1).toString().padStart(4, '0');

    return `${prefix}-${year}-${sequence}`;
}


// ======================
// PASSWORD VALIDATION
// ======================
function isStrongPassword(password) {
    let count = 0;
    if (/[a-z]/.test(password))        count++;
    if (/[A-Z]/.test(password))        count++;
    if (/\d/.test(password))           count++;
    if (/[^A-Za-z0-9]/.test(password)) count++;
    return password.length >= 8 && count >= 3;
}


// ======================
// ADMIN DASHBOARD
// ======================

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

exports.getDashboard = async (req, res) => {
    try {
        const user = req.user;
        if (!user || user.role !== 'admin') return res.status(403).send('Access Denied');

        const students         = await User.countDocuments({ role: 'student' });
        const wardens          = await User.countDocuments({ role: 'warden' });
        const admins           = await User.countDocuments({ role: 'admin' });
        const pendingApprovals = await User.countDocuments({ role: 'student', status: 'pending' });
        const approvedStudents = await User.countDocuments({ role: 'student', status: 'approved' });
        const rejectedStudents = await User.countDocuments({ role: 'student', status: 'rejected' });
        const totalUsers       = students + wardens + admins;

        // Room stats
        const rooms          = await Room.find().lean();
        const occupiedRooms  = rooms.filter(r => r.status === 'Occupied').length;
        const vacantRooms    = rooms.filter(r => r.status === 'Available').length;

        // Fee stats
        const pendingPaymentsCount = await Payment.countDocuments({ status: { $in: ['Pending', 'Cash Received'] } });

        const collectedAgg = await Payment.aggregate([
            { $match: { status: 'Verified' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        const collectedFees = collectedAgg[0]?.total || 0;

        const outstandingAgg = await Due.aggregate([
            { $match: { status: { $in: ['Pending', 'Partially Paid', 'Overdue'] } } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        const outstandingFees = outstandingAgg[0]?.total || 0;

        // ── Operations oversight snapshot (warden-scope) ──
        const opsPendingDisputes = await Attendance.countDocuments({
            notes: { $regex: /^\[DISPUTE\]/ }
        });
        
        const activeAllocStudentIds = await Allocation.distinct('student', { status: 'Active' });
const unassignedStudentsCount = await Student.countDocuments({
    _id: { $nin: activeAllocStudentIds },
    // optionally join with User to only count approved students
});
        const opsEscalatedLeaves = await LeaveRequest.countDocuments({
            status: 'Pending',
            $or: [
                { guardianVerificationNotes: { $regex: /unreachable/i } },
                { createdAt: { $lte: new Date(Date.now() - 24 * 3600000) } }
            ]
        });

        const staleThreshold = new Date(Date.now() - 72 * 3600000); // 72h SLA breach window
        const opsStaleComplaints = await Complaint.countDocuments({
            status: { $in: ['Submitted', 'Acknowledged', 'In Progress'] },
            expectedResolutionDate: { $lte: new Date() }
        });

        let opsPendingRoomRequests = 0;
        try {
            const RoomRequest = require('../models/roomRequest');
            opsPendingRoomRequests = await RoomRequest.countDocuments({
                'wardenApproval.status': 'Recommended',
                status: 'Warden Reviewed'
            });
        } catch (_) {}

        const opsPendingVisitors = await VisitorRequest.countDocuments({ status: 'Pending' });
const opsPendingBookings = await GuestRoomBooking.countDocuments({ status: 'Pending' });
const opsPendingGuestBookings = opsPendingVisitors + opsPendingBookings;

        const opsPendingMobileLoad = await MobileLoad.countDocuments({ requestStatus: 'Pending' });
        
        // ── Notifications for topbar bell ──
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

        const currentDate = new Date().toLocaleDateString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        });

        const badges = await getSidebarBadges(req.user);

        const topbarGreeting = 'Welcome back, ' + (user.fullname || 'Admin').split(' ')[0] + '!';

        res.render('admin/dashboard', {
            activePage: 'dashboard',
            user,
            currentDate,
            topbarGreeting,
            pageSubtitle: currentDate,
            unreadCount,
            recentNotifs,
            ...badges,
            pendingApprovalsCount: pendingApprovals,
            pendingPaymentsCount,
            unassignedStudentsCount,
            opsPendingDisputes,
            opsEscalatedLeaves,
            opsStaleComplaints,
            opsPendingRoomRequests,
            opsPendingGuestBookings,
            opsPendingMobileLoad,
            stats: {
                totalUsers, students, wardens, admins,
                pendingApprovals, approvedStudents, rejectedStudents,
                occupiedRooms, vacantRooms,
                outstandingFees, collectedFees,
                pendingPaymentsCount
            },
            opsStats: {
                pendingDisputes:     opsPendingDisputes,
                escalatedLeaves:     opsEscalatedLeaves,
                staleComplaints:     opsStaleComplaints,
                pendingRoomRequests: opsPendingRoomRequests,
                pendingMobileLoad:   opsPendingMobileLoad
            },
            recentActivities: [{
                action : 'Dashboard Accessed',
                user   : user.fullname || 'Admin',
                date   : new Date().toLocaleDateString()
            }]
        });

    } catch (err) {
        console.error('Dashboard Error:', err);
        res.status(500).send('Server Error');
    }
};


// ======================
// GET PENDING STUDENTS
// ======================
exports.getPendingStudents = async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).send('Access Denied');
        const students = await User.find({ role: 'student', status: 'pending' })
            .select('userId fullname email phoneNumber status createdAt idImage profileImage')
            .lean();

        // Normalise idImage paths before passing to view
        students.forEach(s => { s.idImage = normaliseImagePath(s.idImage); });

        res.render('admin/pending-students', { user: req.user, students });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};


// ======================
// APPROVE STUDENT
// ======================
exports.approveStudent = async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).send('Access Denied');

        const student = await User.findOne({ _id: req.params.id, role: 'student' });

        if (!student) return res.redirect('/admin/users');
        if (student.status === 'approved') return res.redirect('/admin/users');

        student.status = 'approved';
        const plainPassword = student.tempPassword || '(contact admin)';
        student.tempPassword = undefined;

        await student.save();

        await Student.findOneAndUpdate(
            { user: student._id },
            { $setOnInsert: { user: student._id } },
            { upsert: true, setDefaultsOnInsert: true }
        );

        sendApprovalEmail(
            student.email,
            student.fullname,
            student.userId,
            plainPassword
        ).catch(err => console.error('Approval email failed:', err));

        res.redirect('/admin/users');

    } catch (err) {
        console.error('approveStudent Error:', err);
        res.status(500).send('Server Error');
    }
};


// ======================
// REJECT STUDENT
//
// FIX: previously used findOneAndDelete(filter, { status: 'rejected' }),
// but the second argument to findOneAndDelete is an OPTIONS object, not
// an update — so { status: 'rejected' } was silently ignored and the
// student was just hard-deleted. Switched to findOneAndUpdate so the
// status actually changes and the rejected record is retained for the
// audit trail (matches the original intent implied by the code).
// ======================
exports.rejectStudent = async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).send('Access Denied');

        await User.findOneAndUpdate(
            { _id: req.params.id, role: 'student' },
            { status: 'rejected' }
        );

        res.redirect('/admin/users');
    } catch (err) {
        console.error('rejectStudent Error:', err);
        res.status(500).send('Server Error');
    }
};


// ======================
// USER MANAGEMENT PAGE
// ======================
exports.getUserManagement = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'admin') return res.status(403).send('Access Denied');

        const users = await User.find()
            .select('userId fullname email phoneNumber role status createdAt idImage profileImage')
            .sort({ createdAt: -1 })
            .lean();

        // Normalise idImage paths so EJS never has to deal with "public/" prefix
        users.forEach(u => { u.idImage = normaliseImagePath(u.idImage); });

        const students        = users.filter(u => u.role === 'student');
        const admins          = users.filter(u => u.role === 'admin');
        const wardens         = users.filter(u => u.role === 'warden');
        const pendingStudents = users.filter(u => u.role === 'student' && u.status === 'pending');

        const studentInfoMap  = {};
        const allStudentInfos = await Student.find().lean();
        allStudentInfos.forEach(si => {
            const isFilled = !!(
                si.department        ||
                si.institution       ||
                si.cnic              ||
                si.bloodGroup        ||
                si.homeAddress       ||
                si.guardianName      ||
                si.emergencyContact
            );
            studentInfoMap[si.user.toString()] = isFilled ? si : null;
        });

        // ── Notifications for topbar bell ──
        const unreadCount = await Notification.countDocuments({
            isActive: true,
            $or: [
                { target: { $in: ['All', 'Admins'] }, readBy: { $nin: [req.user._id] } },
                { recipient: req.user._id, readBy: { $nin: [req.user._id] } }
            ]
        });
        const recentNotifs = await Notification.find({
            isActive: true,
            $or: [
                { target: { $in: ['All', 'Admins'] } },
                { recipient: req.user._id }
            ]
        }).sort({ createdAt: -1 }).limit(5).lean();
        recentNotifs.forEach(n => { n._timeAgo = timeAgo(n.createdAt); });
        const badges = await getSidebarBadges(req.user);

        res.render('admin/userM', {
            activePage      : 'users',
            pageTitle       : 'User Management',
            pageSubtitle    : 'Manage students, wardens, and admins',
            user            : req.user,
            users,
            students,
            admins,
            wardens,
            pendingStudents,
            ...badges,
            pendingApprovalsCount: pendingStudents.length,
            studentInfoMap,
            unreadCount,
            recentNotifs,
            successMessage  : req.query.success || null,
            errorMessage    : req.query.error   || null,
            stats: {
                totalUsers : users.length,
                students   : students.length,
                admins     : admins.length,
                wardens    : wardens.length,
                pending    : pendingStudents.length
            }
        });

    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};


// ======================
// USER ID PREVIEW (read-only, used by Add User form)
// GET /admin/users/preview-id?role=student|admin|warden
//
// Reuses the exact same generateUserId() helper that addUser() calls at
// save time, so the preview shown to the admin is guaranteed to match
// the real ID (modulo a small race window if two admins add users at
// the same instant — the authoritative ID is still generated inside
// addUser() itself).
// ======================
exports.previewNextUserId = async (req, res) => {
    try {
        const { role } = req.query;
        if (!['student', 'admin', 'warden'].includes(role)) {
            return res.json({ preview: '—' });
        }
        const preview = await generateUserId(role);
        res.json({ preview });
    } catch (err) {
        console.error('previewNextUserId Error:', err);
        res.json({ preview: '—' });
    }
};


// ======================
// ADD USER
// ======================
exports.addUser = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'admin') return res.status(403).send('Access Denied');

        const { fullname, email, phoneNumber, gender, password, role } = req.body;

        if (!fullname || !email || !phoneNumber || !gender || !password || !role)
            return res.redirect('/admin/users?error=All+fields+are+required.&page=add-user');

        if (!['student', 'admin', 'warden'].includes(role))
            return res.redirect('/admin/users?error=Invalid+role.&page=add-user');

        if (!isStrongPassword(password))
            return res.redirect('/admin/users?error=Password+must+be+at+least+8+characters+and+include+uppercase,+lowercase,+number,+and+special+character.&page=add-user');

        const existing = await User.findOne({ email });
        if (existing)
            return res.redirect('/admin/users?error=Email+already+registered.&page=add-user');

        const hashedPassword = await bcrypt.hash(password, 10);
        const userId         = await generateUserId(role);

        const newUser = new User({
            userId,
            fullname,
            email,
            password  : hashedPassword,
            role,
            status    : 'approved',
            phoneNumber,
            gender,
            createdBy : req.user.userId
        });

        await newUser.save();

        if (role === 'student') {
            await Student.findOneAndUpdate(
                { user: newUser._id },
                { $setOnInsert: { user: newUser._id } },
                { upsert: true, setDefaultsOnInsert: true }
            );
        }

        return res.redirect(
            '/admin/users?success=User+created+successfully.+User+ID:+' + userId + '&page=add-user'
        );

    } catch (err) {
        console.error('Add User Error:', err);
        res.redirect('/admin/users?error=Server+error+while+creating+user.&page=add-user');
    }
};


// ======================
// VIEW USER  (modal-based — redirect)
// ======================
exports.viewUser = async (req, res) => {
    res.redirect('/admin/users');
};


// ======================
// DELETE USER
// AUTO VACATE IF STUDENT
// ======================
exports.deleteUser = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'admin')
            return res.status(403).send('Access Denied');

        const user = await User.findById(req.params.id);
        if (!user)
            return res.redirect('/admin/users?error=User+not+found.');

        if (user.role === 'student') {
            const student = await Student.findOne({ user: user._id });

            if (student) {
                const allocation = await Allocation.findOne({
                    student: student._id,
                    status : 'Active'
                });

                if (allocation) {
                    allocation.status      = 'Vacated';
                    allocation.vacatedDate = new Date();
                    allocation.remarks     = 'Auto vacated because student account was deleted';
                    await allocation.save();

                    const activeCount = await Allocation.countDocuments({
                        room  : allocation.room,
                        status: 'Active'
                    });

                    const room = await Room.findById(allocation.room);
                    if (room) {
                        room.occupiedBeds = activeCount;
                        if (room.status !== 'Maintenance') {
                            room.status = activeCount >= room.capacity ? 'Occupied' : 'Available';
                        }
                        await room.save();
                    }

                    student.room              = null;
                    student.currentAllocation = null;
                    await student.save();
                }

                await Student.findByIdAndDelete(student._id);
            }
        }

        await User.findByIdAndDelete(req.params.id);
        return res.redirect('/admin/users?success=User+deleted+and+room+vacated.');

    } catch (err) {
        console.error('deleteUser Error:', err);
        return res.redirect('/admin/users?error=Failed+to+delete+user.');
    }
};


// ======================
// GET EDIT USER  (modal-based — redirect)
// ======================
exports.getEditUser = async (req, res) => {
    res.redirect('/admin/users');
};


// ======================
// UPDATE USER
// ======================
exports.updateUser = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'admin') return res.status(403).send('Access Denied');

        const { fullname, email, role, status, phoneNumber, gender, dateOfBirth } = req.body;

        const updateData = { fullname, email, role, status };
        if (phoneNumber !== undefined)                       updateData.phoneNumber = phoneNumber;
        if (gender      !== undefined && gender !== '')      updateData.gender      = gender;
        if (dateOfBirth !== undefined && dateOfBirth !== '') updateData.dateOfBirth = new Date(dateOfBirth);

        await User.findByIdAndUpdate(req.params.id, updateData);
        res.redirect('/admin/users');

    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};


// ============================================================
// STUDENT INFO — GET
// GET /admin/students/:userId/info
//
// FIX 1: returns idImage (normalised, without "public/" prefix) so the
//        Student Info modal can show the ID document.
// FIX 2 (NEW): populates `room` on the Student doc with roomNumber,
//        block, and hostelName so the modal can show real assigned
//        room/hostel info instead of just a boolean. This assumes
//        Student.room is a ref to the Room model with those field
//        names — confirm against your actual Room schema and adjust
//        the populate select list if the field names differ.
// ============================================================
exports.getStudentInfo = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'admin')
            return res.status(403).json({ error: 'Access Denied' });

        const student = await User.findById(req.params.userId).lean();
        if (!student || student.status !== 'approved') {
            return res.status(403).json({
                error: 'Student info is only available for approved students.'
            });
        }

        const studentInfo = await Student.findOne({ user: req.params.userId })
            .populate('room', 'roomNumber block hostelName')
            .lean();

        res.json({
            studentInfo : studentInfo || null,
            idImage     : normaliseImagePath(student.idImage)
        });

    } catch (err) {
        console.error('getStudentInfo Error:', err);
        res.status(500).json({ error: 'Server Error' });
    }
};


// ============================================================
// STUDENT INFO — SAVE (upsert)
// POST /admin/students/:userId/info
// ============================================================
exports.saveStudentInfo = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'admin')
            return res.status(403).send('Access Denied');

        const student = await User.findById(req.params.userId).lean();
        if (!student || student.status !== 'approved') {
            return res.redirect(
                '/admin/users?error=Cannot+edit+info+for+a+pending+or+rejected+student.&page=students'
            );
        }

        const {
            department,
            institution,
            cnic,
            bloodGroup,
            homeAddress,
            guardianName,
            guardianContact,
            guardianRelation,
            admissionDate,
            emergencyContact
        } = req.body;

        const updateFields = {};
        if (department       !== undefined) updateFields.department       = department       || null;
        if (institution      !== undefined) updateFields.institution      = institution      || null;
        if (cnic             !== undefined) updateFields.cnic             = cnic             || null;
        if (bloodGroup       !== undefined) updateFields.bloodGroup       = bloodGroup       || null;
        if (homeAddress      !== undefined) updateFields.homeAddress      = homeAddress      || null;
        if (guardianName     !== undefined) updateFields.guardianName     = guardianName     || null;
        if (guardianContact  !== undefined) updateFields.guardianContact  = guardianContact  || null;
        if (guardianRelation !== undefined) updateFields.guardianRelation = guardianRelation || null;
        if (emergencyContact !== undefined) updateFields.emergencyContact = emergencyContact || null;
        if (admissionDate    !== undefined && admissionDate !== '') {
            updateFields.admissionDate = new Date(admissionDate);
        }

        await Student.findOneAndUpdate(
            { user: req.params.userId },
            { $set: updateFields },
            { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
        );

        res.redirect('/admin/users?success=Student+information+saved+successfully.&page=students');

    } catch (err) {
        console.error('saveStudentInfo Error:', err);
        res.redirect('/admin/users?error=Failed+to+save+student+information.&page=students');
    }
};


// ============================================================
// NOTIFICATIONS PAGE
// GET /admin/notifications
// ============================================================
exports.getNotifications = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'admin') return res.status(403).send('Access Denied');

        const userId = req.user._id;
        const tab     = req.query.tab || 'action';

        const query = {
            isActive: true,
            $or: [
                { target: { $in: ['All', 'Admins'] } },
                { recipient: userId }
            ]
        };
        const badges = await getSidebarBadges(req.user);
        
        const notifications = await Notification.find(query).sort({ createdAt: -1 }).lean();
        notifications.forEach(n => {
            n._isUnread = !n.readBy || !n.readBy.map(String).includes(String(userId));
            n._timeAgo  = timeAgo(n.createdAt);
        });

        const unreadCount = await Notification.countDocuments({
            isActive: true,
            $or: [
                { target: { $in: ['All', 'Admins'] }, readBy: { $nin: [userId] } },
                { recipient: userId, readBy: { $nin: [userId] } }
            ]
        });

        res.render('admin/notifications', {
            user          : req.user,
            activePage    : 'notifications',
            pageTitle     : 'Notifications',
            pageSubtitle  : 'Action required, general updates, and broadcasts',
            notifications,
            activeTab     : tab,
            unreadCount,
            ...badges,
            recentNotifs  : notifications.slice(0, 5),
            successMessage: req.query.success || null,
            errorMessage  : req.query.error   || null
        });
    } catch (err) {
        console.error('adminController getNotifications:', err);
        res.status(500).send('Server Error');
    }
};


// ============================================================
// SEND NOTIFICATION (broadcast — Students / Wardens / Everyone)
// POST /admin/notifications/send
// ============================================================
exports.sendNotification = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'admin') return res.status(403).send('Access Denied');

        const { title, message, targetType } = req.body;
        if (!title || !message) {
            return res.redirect('/admin/notifications?error=Title+and+message+are+required.&tab=compose');
        }

        const targetMap = { students: 'Students', wardens: 'Wardens', all: 'All' };

        await Notification.create({
            title,
            message,
            target   : targetMap[targetType] || 'Students',
            category : 'Announcements',
            createdBy: req.user._id
        });

        res.redirect('/admin/notifications?success=Notification+sent+successfully.&tab=compose');
    } catch (err) {
        console.error('adminController sendNotification:', err);
        res.redirect('/admin/notifications?error=Failed+to+send+notification.&tab=compose');
    }
};


// ============================================================
// MARK ALL NOTIFICATIONS READ
// POST /admin/notifications/mark-all-read
// ============================================================
exports.markAllNotificationsRead = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Access Denied' });

        const userId = req.user._id;
        await Notification.updateMany(
            {
                isActive: true,
                readBy  : { $nin: [userId] },
                $or: [
                    { target: { $in: ['All', 'Admins'] } },
                    { recipient: userId }
                ]
            },
            { $addToSet: { readBy: userId } }
        );

        res.json({ success: true });
    } catch (err) {
        console.error('adminController markAllNotificationsRead:', err);
        res.status(500).json({ error: 'Server error' });
    }
};