const User = require('../models/user');
const Driver = require('../models/driver');
const Student = require('../models/student');
const CabBooking = require('../models/cabBooking');
const Notification = require('../models/notification');
const { getSidebarBadges } = require('../utils/sidebarBadges');

// ======================
// HELPER — timeAgo
// ======================
function timeAgo(date) {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    const days = Math.floor(hrs / 24);
    if (days < 7) return days + 'd ago';
    return new Date(date).toLocaleDateString();
}


// ======================
// DRIVER DASHBOARD
// ======================
exports.getDashboard = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'driver') return res.status(403).send('Access Denied');

        const driver = await Driver.findOne({ user: req.user._id }).lean();

        const _hr = new Date().getHours();
        const currentGreeting = _hr < 12 ? 'Morning' : (_hr < 17 ? 'Afternoon' : 'Evening');

        const currentDate = new Date().toLocaleDateString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        });

        // ── Notifications for topbar bell ──
        const unreadCount = await Notification.countDocuments({
            isActive: true,
            $or: [
                { target: { $in: ['All', 'Students'] }, readBy: { $nin: [req.user._id] } },
                { recipient: req.user._id, readBy: { $nin: [req.user._id] } }
            ]
        });
        const recentNotifs = await Notification.find({
            isActive: true,
            $or: [
                { target: { $in: ['All', 'Students'] } },
                { recipient: req.user._id }
            ]
        }).sort({ createdAt: -1 }).limit(5).lean();
        recentNotifs.forEach(n => { n._timeAgo = timeAgo(n.createdAt); });

        const badges = await getSidebarBadges(req.user);

        res.render('driver/dashboard', {
            user: req.user,
            driver: driver || {},
            currentGreeting,
            currentDate,
            pageTitle: 'Driver Dashboard',
            topbarGreeting: 'Welcome back, ' + req.user.fullname.split(' ')[0] + '!',
            pageSubtitle: currentDate + '  ·  Driver Portal',
            activePage: 'dashboard',
            unreadCount,
            recentNotifs,
            ...badges,
            successMessage: req.query.success || null,
            errorMessage: req.query.error || null
        });

    } catch (err) {
        console.error('Driver Dashboard Error:', err);
        res.status(500).send('Server Error');
    }
};


// ======================
// DRIVER PROFILE — GET
// ======================
exports.getProfile = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'driver') return res.status(403).send('Access Denied');

        const driver = await Driver.findOne({ user: req.user._id }).lean();

        // ── Notifications for topbar bell ──
        const unreadCount = await Notification.countDocuments({
            isActive: true,
            $or: [
                { target: { $in: ['All', 'Students'] }, readBy: { $nin: [req.user._id] } },
                { recipient: req.user._id, readBy: { $nin: [req.user._id] } }
            ]
        });
        const recentNotifs = await Notification.find({
            isActive: true,
            $or: [
                { target: { $in: ['All', 'Students'] } },
                { recipient: req.user._id }
            ]
        }).sort({ createdAt: -1 }).limit(5).lean();
        recentNotifs.forEach(n => { n._timeAgo = timeAgo(n.createdAt); });

        const badges = await getSidebarBadges(req.user);

        res.render('driver/profile', {
            user: req.user,
            driver: driver || {},
            pageTitle: 'My Profile',
            activePage: 'profile',
            unreadCount,
            recentNotifs,
            ...badges,
            successMessage: req.query.success || null,
            errorMessage: req.query.error || null
        });

    } catch (err) {
        console.error('Driver Profile Error:', err);
        res.status(500).send('Server Error');
    }
};


// ======================
// VEHICLE MANAGEMENT — GET
// ======================
exports.getVehicle = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'driver') return res.status(403).send('Access Denied');

        const driver = await Driver.findOne({ user: req.user._id }).lean();

        // ── Notifications for topbar bell ──
        const unreadCount = await Notification.countDocuments({
            isActive: true,
            $or: [
                { target: { $in: ['All', 'Students'] }, readBy: { $nin: [req.user._id] } },
                { recipient: req.user._id, readBy: { $nin: [req.user._id] } }
            ]
        });
        const recentNotifs = await Notification.find({
            isActive: true,
            $or: [
                { target: { $in: ['All', 'Students'] } },
                { recipient: req.user._id }
            ]
        }).sort({ createdAt: -1 }).limit(5).lean();
        recentNotifs.forEach(n => { n._timeAgo = timeAgo(n.createdAt); });

        const badges = await getSidebarBadges(req.user);

        res.render('driver/vehicle', {
            user: req.user,
            driver: driver || {},
            pageTitle: 'Vehicle Management',
            activePage: 'vehicle',
            unreadCount,
            recentNotifs,
            ...badges,
            successMessage: req.query.success || null,
            errorMessage: req.query.error || null
        });

    } catch (err) {
        console.error('Driver Vehicle Page Error:', err);
        res.status(500).send('Server Error');
    }
};


// ======================
// CAB BOOKINGS — GET
// ======================
exports.getBookings = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'driver') return res.status(403).send('Access Denied');

        const driver = await Driver.findOne({ user: req.user._id }).lean();

        // Fetch cab bookings assigned to this driver
        const bookings = await CabBooking.find({ driver: req.user._id })
            .populate({
                path: 'student',
                populate: { path: 'user', select: 'fullname userId phoneNumber' }
            })
            .sort({ createdAt: -1 })
            .lean();

        // Split into pending (needs driver action), active (Confirmed, In Progress) and history
        const pendingBookings = bookings.filter(b => b.status === 'Pending');
        const activeBookings = bookings.filter(b =>
            ['Pending', 'Confirmed', 'In Progress'].includes(b.status)
        );
        const pastBookings = bookings.filter(b =>
            ['Completed', 'Cancelled'].includes(b.status)
        );

        // ── Notifications for topbar bell ──
        const unreadCount = await Notification.countDocuments({
            isActive: true,
            $or: [
                { target: { $in: ['All', 'Students'] }, readBy: { $nin: [req.user._id] } },
                { recipient: req.user._id, readBy: { $nin: [req.user._id] } }
            ]
        });
        const recentNotifs = await Notification.find({
            isActive: true,
            $or: [
                { target: { $in: ['All', 'Students'] } },
                { recipient: req.user._id }
            ]
        }).sort({ createdAt: -1 }).limit(5).lean();
        recentNotifs.forEach(n => { n._timeAgo = timeAgo(n.createdAt); });

        const badges = {};

        res.render('driver/bookings', {
            user: req.user,
            driver: driver || {},
            pageTitle: 'Cab Bookings',
            pageSubtitle: 'View and manage ride requests',
            activePage: 'bookings',
            bookings,
            pendingBookings,
            activeBookings,
            pastBookings,
            unreadCount,
            recentNotifs,
            ...badges,
            successMessage: req.query.success || null,
            errorMessage: req.query.error || null
        });

    } catch (err) {
        console.error('Driver Bookings Error:', err);
        res.status(500).send('Server Error');
    }
};


// ======================
// CAB BOOKINGS — ACCEPT (driver accepts a pending ride request)
// POST /driver/bookings/accept/:id
// ======================
exports.acceptBooking = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'driver') return res.status(403).send('Access Denied');

        const fare = Number(req.body.fare);
        if (!fare || fare <= 0) {
            return res.redirect('/driver/bookings?error=Please+enter+a+valid+fare+amount.');
        }

        // ── Atomic accept: the Pending check and the write happen in the same
        // database operation, so two concurrent accept/confirm/reject requests
        // for this booking can never both succeed. ─────────────────────────
        const booking = await CabBooking.findOneAndUpdate(
            { _id: req.params.id, driver: req.user._id, status: 'Pending' },
            { $set: { status: 'Confirmed', confirmedAt: new Date(), fare, paymentStatus: 'Unpaid' } },
            { new: true }
        );

        if (!booking) {
            const existing = await CabBooking.findOne({ _id: req.params.id, driver: req.user._id }).select('status').lean();
            if (!existing) {
                return res.redirect('/driver/bookings?error=Booking+not+found.');
            }
            return res.redirect('/driver/bookings?error=' + encodeURIComponent(
                `This booking is already ${existing.status.toLowerCase()} and can no longer be accepted.`
            ));
        }

        let studentRec = null;
        try {
            studentRec = await Student.findById(booking.student).populate('user', 'fullname').lean();
        } catch (lookupErr) {
            console.error('acceptBooking: Student lookup error:', lookupErr);
        }

        // ── Notify the student about the acceptance ─────────────────
        try {
            if (studentRec && studentRec.user) {
                await Notification.create({
                    title     : 'Cab Booking Accepted',
                    message   : `${req.user.fullname} has accepted your cab booking request from "${booking.pickupLocation}" to "${booking.dropoffLocation}".`,
                    recipient : studentRec.user._id,
                    category  : 'Requests',
                    relatedTo : { model: 'CabBooking', docId: booking._id },
                    createdBy : req.user._id,
                    priority  : 'Medium'
                });
            }
        } catch (notifErr) {
            console.error('acceptBooking: Student notification error:', notifErr);
        }

        // ── Notify admins & wardens so Transport Management stays in sync ──
        try {
            const studentName = studentRec?.user?.fullname || 'A student';
            const statusMsg = `Cab booking for ${studentName} (${booking.pickupLocation} → ${booking.dropoffLocation}) was accepted by ${req.user.fullname}.`;

            await Notification.create({
                title     : 'Cab Booking Accepted',
                message   : statusMsg,
                target    : 'Admins',
                category  : 'Requests',
                relatedTo : { model: 'CabBooking', docId: booking._id },
                createdBy : req.user._id,
                priority  : 'Low'
            });
            await Notification.create({
                title     : 'Cab Booking Accepted',
                message   : statusMsg,
                target    : 'Wardens',
                category  : 'Requests',
                relatedTo : { model: 'CabBooking', docId: booking._id },
                createdBy : req.user._id,
                priority  : 'Low'
            });
        } catch (notifErr) {
            console.error('acceptBooking: Admin/Warden notification error:', notifErr);
        }

        res.redirect('/driver/bookings?success=Booking+accepted.');

    } catch (err) {
        console.error('acceptBooking Error:', err);
        res.redirect('/driver/bookings?error=Failed+to+accept+booking.');
    }
};


// ======================
// CAB BOOKINGS — REJECT (driver declines a pending ride request)
// POST /driver/bookings/reject/:id
// ======================
exports.rejectBooking = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'driver') return res.status(403).send('Access Denied');

        // ── Atomic reject: the Pending check and the write happen in the same
        // database operation, so two concurrent accept/confirm/reject requests
        // for this booking can never both succeed. ─────────────────────────
        const booking = await CabBooking.findOneAndUpdate(
            { _id: req.params.id, driver: req.user._id, status: 'Pending' },
            { $set: {
                status: 'Cancelled',
                cancellation: {
                    by    : 'driver',
                    reason: req.body.reason || 'Rejected by driver',
                    at    : new Date()
                }
            } },
            { new: true }
        );

        if (!booking) {
            const existing = await CabBooking.findOne({ _id: req.params.id, driver: req.user._id }).select('status').lean();
            if (!existing) {
                return res.redirect('/driver/bookings?error=Booking+not+found.');
            }
            return res.redirect('/driver/bookings?error=' + encodeURIComponent(
                `This booking is already ${existing.status.toLowerCase()} and can no longer be rejected.`
            ));
        }

        let studentRec = null;
        try {
            studentRec = await Student.findById(booking.student).populate('user', 'fullname').lean();
        } catch (lookupErr) {
            console.error('rejectBooking: Student lookup error:', lookupErr);
        }

        // ── Notify the student about the rejection ───────────────────
        try {
            if (studentRec && studentRec.user) {
                await Notification.create({
                    title     : 'Cab Booking Rejected',
                    message   : `${req.user.fullname} was unable to accept your cab booking request from "${booking.pickupLocation}" to "${booking.dropoffLocation}".`,
                    recipient : studentRec.user._id,
                    category  : 'Requests',
                    relatedTo : { model: 'CabBooking', docId: booking._id },
                    createdBy : req.user._id,
                    priority  : 'Medium'
                });
            }
        } catch (notifErr) {
            console.error('rejectBooking: Student notification error:', notifErr);
        }

        // ── Notify admins & wardens so Transport Management stays in sync ──
        try {
            const studentName = studentRec?.user?.fullname || 'A student';
            const statusMsg = `Cab booking for ${studentName} (${booking.pickupLocation} → ${booking.dropoffLocation}) was rejected by ${req.user.fullname}.`;

            await Notification.create({
                title     : 'Cab Booking Rejected',
                message   : statusMsg,
                target    : 'Admins',
                category  : 'Requests',
                relatedTo : { model: 'CabBooking', docId: booking._id },
                createdBy : req.user._id,
                priority  : 'Low'
            });
            await Notification.create({
                title     : 'Cab Booking Rejected',
                message   : statusMsg,
                target    : 'Wardens',
                category  : 'Requests',
                relatedTo : { model: 'CabBooking', docId: booking._id },
                createdBy : req.user._id,
                priority  : 'Low'
            });
        } catch (notifErr) {
            console.error('rejectBooking: Admin/Warden notification error:', notifErr);
        }

        res.redirect('/driver/bookings?success=Booking+rejected.');

    } catch (err) {
        console.error('rejectBooking Error:', err);
        res.redirect('/driver/bookings?error=Failed+to+reject+booking.');
    }
};


// ======================
// VEHICLE MANAGEMENT — UPDATE
// POST /driver/vehicle/update
// ======================
exports.updateVehicle = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'driver') return res.status(403).send('Access Denied');

        const driverRec = await Driver.findOne({ user: req.user._id });

        if (!driverRec) {
            return res.redirect('/driver/vehicle?error=Driver+record+not+found.');
        }

        // ── Validation ──
        const { vehicleType, vehicleRegistration, vehicleModel, serviceArea, experienceYears } = req.body;

        // ── Build update object ──
        const updateData = {};

        if (vehicleType !== undefined) updateData.vehicleType = vehicleType;
        if (vehicleRegistration !== undefined) updateData.vehicleRegistration = vehicleRegistration;
        if (vehicleModel !== undefined) updateData.vehicleModel = vehicleModel;
        if (serviceArea !== undefined) updateData.serviceArea = serviceArea;
        if (experienceYears !== undefined && experienceYears !== '') updateData.experienceYears = parseInt(experienceYears);

        // ── Handle uploaded files ──
        const uploaded = req.files || {};
        const getFile = (name) => {
            const f = uploaded[name];
            return f && f[0] ? 'uploads/driver-docs/' + f[0].filename : null;
        };

        // For each document field, only update if a new file was uploaded
        const docFields = ['cnicFront', 'cnicBack', 'licenseImage', 'vehicleDoc'];
        const dbFields = {
            cnicFront: 'cnicFrontImage',
            cnicBack: 'cnicBackImage',
            licenseImage: 'licenseImage',
            vehicleDoc: 'vehicleDocImage'
        };

        docFields.forEach(field => {
            const newFile = getFile(field);
            if (newFile) {
                // Delete old file from disk if it exists
                const oldField = dbFields[field];
                if (driverRec[oldField]) {
                    const fs = require('fs');
                    const path = require('path');
                    const oldPath = path.join(__dirname, '..', driverRec[oldField]);
                    fs.unlink(oldPath, () => {});
                }
                updateData[dbFields[field]] = newFile;
            }
        });

        await Driver.findByIdAndUpdate(driverRec._id, { $set: updateData });

        res.redirect('/driver/vehicle?success=Vehicle+information+updated+successfully.');

    } catch (err) {
        console.error('Update Vehicle Error:', err);
        res.redirect('/driver/vehicle?error=Failed+to+update+vehicle+information.');
    }
};
