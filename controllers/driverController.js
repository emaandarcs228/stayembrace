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

        // ── Available ride requests — only shown when driver is online ──
        const availableRequests = driver?.isOnline
            ? await CabBooking.find({ status: 'Pending', reservedBy: null })
                .populate({
                    path: 'student',
                    populate: { path: 'user', select: 'fullname userId phoneNumber' }
                })
                .sort({ createdAt: -1 })
                .lean()
            : [];

        // ── My reservations (this driver currently has reserved/quoting) ──
        const myReservations = await CabBooking.find({
            reservedBy: req.user._id,
            status: { $in: ['Reserved', 'Awaiting Student'] }
        })
            .populate({
                path: 'student',
                populate: { path: 'user', select: 'fullname userId phoneNumber' }
            })
            .sort({ createdAt: -1 })
            .lean();

        // ── Active rides (this driver's confirmed/in-progress bookings) ──
        const activeRides = await CabBooking.find({
            driver: req.user._id,
            status: { $in: ['Confirmed', 'In Progress'] }
        })
            .populate({
                path: 'student',
                populate: { path: 'user', select: 'fullname userId phoneNumber' }
            })
            .sort({ createdAt: -1 })
            .lean();

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
            availableRequests,
            myReservations,
            activeRides,
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
// TOGGLE AVAILABILITY (Online / Offline)
// POST /driver/availability/toggle
// ======================
exports.toggleAvailability = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'driver') {
            return res.status(403).json({ error: 'Access Denied' });
        }

        const driver = await Driver.findOne({ user: req.user._id });
        if (!driver) {
            return res.status(404).json({ error: 'Driver record not found.' });
        }

        // Toggle the isOnline status
        driver.isOnline = !driver.isOnline;
        await driver.save();

        res.json({
            success: true,
            isOnline: driver.isOnline,
            message: driver.isOnline ? 'You are now online and receiving ride requests.' : 'You are now offline.'
        });

    } catch (err) {
        console.error('toggleAvailability Error:', err);
        res.status(500).json({ error: 'Failed to toggle availability.' });
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

        // ── Available requests — only shown when driver is online ──
        const availableRequests = driver?.isOnline
            ? await CabBooking.find({
                status: 'Pending',
                reservedBy: null
              })
                .populate({
                    path: 'student',
                    populate: { path: 'user', select: 'fullname userId phoneNumber' }
                })
                .sort({ createdAt: -1 })
                .lean()
            : [];

        // ── My reservations (this driver currently has reserved/quoting) ──
        const myReservations = await CabBooking.find({
            reservedBy: req.user._id,
            status: { $in: ['Reserved', 'Awaiting Student'] }
        })
            .populate({
                path: 'student',
                populate: { path: 'user', select: 'fullname userId phoneNumber' }
            })
            .sort({ createdAt: -1 })
            .lean();

        // ── Active rides (this driver's confirmed/in-progress bookings) ──
        const activeRides = await CabBooking.find({
            driver: req.user._id,
            status: { $in: ['Confirmed', 'In Progress'] }
        })
            .populate({
                path: 'student',
                populate: { path: 'user', select: 'fullname userId phoneNumber' }
            })
            .sort({ createdAt: -1 })
            .lean();

        // ── History (completed/cancelled bookings for this driver) ──
        const pastBookings = await CabBooking.find({
            driver: req.user._id,
            status: { $in: ['Completed', 'Cancelled'] }
        })
            .populate({
                path: 'student',
                populate: { path: 'user', select: 'fullname userId phoneNumber' }
            })
            .sort({ createdAt: -1 })
            .lean();

        // ── Legacy: also fetch bookings where this driver is assigned as driver
        // (for backward compatibility with old direct-assign bookings) ──
        const legacyAssigned = await CabBooking.find({
            driver: req.user._id,
            status: 'Pending'
        })
            .populate({
                path: 'student',
                populate: { path: 'user', select: 'fullname userId phoneNumber' }
            })
            .sort({ createdAt: -1 })
            .lean();

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
            pageSubtitle: 'Find ride requests and manage your bookings',
            activePage: 'bookings',
            availableRequests,
            myReservations,
            activeRides,
            pastBookings,
            legacyAssigned,
            unreadCount,
            recentNotifs,
            ...badges,
            now: new Date(),
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
// ======================
// CAB BOOKINGS — GET AVAILABLE REQUESTS (unreserved pending rides)
// GET /driver/bookings/available
// ======================
exports.getAvailableRequests = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'driver') return res.status(403).json({ error: 'Access denied' });

        // Only show requests if driver is online
        const driver = await Driver.findOne({ user: req.user._id }).select('isOnline').lean();
        if (!driver?.isOnline) {
            return res.json({ requests: [], offline: true, message: 'You are offline. Go online to see available requests.' });
        }

        const requests = await CabBooking.find({ status: 'Pending', reservedBy: null })
            .populate({
                path: 'student',
                populate: { path: 'user', select: 'fullname userId phoneNumber' }
            })
            .sort({ createdAt: -1 })
            .lean();

        res.json({ requests });
    } catch (err) {
        console.error('getAvailableRequests Error:', err);
        res.status(500).json({ error: 'Failed to fetch requests.' });
    }
};


// ======================
// CAB BOOKINGS — RESERVE (driver reserves a pending request for 2 min)
// POST /driver/bookings/reserve/:id
// ======================
exports.reserveRequest = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'driver') return res.status(403).send('Access Denied');

        const now = new Date();
        const expiresAt = new Date(now.getTime() + 2 * 60 * 1000); // 2 minutes

        // ── Atomic reserve: only succeeds if still Pending and not already reserved ──
        const booking = await CabBooking.findOneAndUpdate(
            { _id: req.params.id, status: 'Pending', reservedBy: null },
            {
                $set: {
                    status                : 'Reserved',
                    reservedBy            : req.user._id,
                    reservedAt            : now,
                    reservationExpiresAt  : expiresAt
                }
            },
            { new: true }
        );

        if (!booking) {
            const existing = await CabBooking.findById(req.params.id).select('status reservedBy').lean();
            if (!existing) {
                return res.redirect('/driver/bookings?error=Request+not+found.');
            }
            if (existing.reservedBy) {
                return res.redirect('/driver/bookings?error=This+request+was+just+reserved+by+another+driver.');
            }
            return res.redirect('/driver/bookings?error=' + encodeURIComponent(
                `This request is ${existing.status} and cannot be reserved.`
            ));
        }

        res.redirect('/driver/bookings?success=Request+reserved.+You+have+2+minutes+to+submit+a+fare+quote.');

    } catch (err) {
        console.error('reserveRequest Error:', err);
        res.redirect('/driver/bookings?error=Failed+to+reserve+request.');
    }
};


// ======================
// CAB BOOKINGS — SUBMIT QUOTE (driver submits fare + ETA for reserved request)
// POST /driver/bookings/quote/:id
// ======================
exports.submitQuote = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'driver') return res.status(403).send('Access Denied');

        const fare = Number(req.body.fare);
        if (!fare || fare <= 0) {
            return res.redirect('/driver/bookings?error=Please+enter+a+valid+fare+amount.');
        }

        const eta = req.body.eta || '';
        const now = new Date();

        // ── Atomic: only succeeds if this driver reserved it, it's still Reserved,
        // and the 2-minute reservation window has not expired ──
        const booking = await CabBooking.findOneAndUpdate(
            {
                _id: req.params.id,
                reservedBy: req.user._id,
                status: 'Reserved',
                reservationExpiresAt: { $gt: now }
            },
            {
                $set: {
                    status              : 'Awaiting Student',
                    'quote.fare'        : fare,
                    'quote.eta'         : eta,
                    'quote.submittedAt' : new Date(),
                    // Refresh the 2-min timer so the student has time to respond
                    reservationExpiresAt: new Date(now.getTime() + 2 * 60 * 1000)
                }
            },
            { new: true }
        );

        if (!booking) {
            const existing = await CabBooking.findById(req.params.id).select('status reservedBy reservationExpiresAt').lean();
            if (!existing) return res.redirect('/driver/bookings?error=Request+not+found.');
            if (String(existing.reservedBy) !== String(req.user._id)) {
                return res.redirect('/driver/bookings?error=You+no+longer+hold+the+reservation+for+this+request.');
            }
            if (existing.status === 'Reserved' && existing.reservationExpiresAt && existing.reservationExpiresAt <= now) {
                // Expired right under us — release immediately instead of making
                // the driver wait for the next sweep of reservationTimeoutJob.
                await CabBooking.updateOne(
                    { _id: req.params.id, status: 'Reserved', reservedBy: req.user._id },
                    { $set: { status: 'Pending', reservedBy: null, reservedAt: null, reservationExpiresAt: null } }
                );
                return res.redirect('/driver/bookings?error=Your+2-minute+reservation+window+expired.');
            }
            return res.redirect('/driver/bookings?error=' + encodeURIComponent(
                `Cannot submit a quote when status is "${existing.status}".`
            ));
        }

        // ── Notify the student about the fare quote ─────────────────
        let studentRec = null;
        try {
            studentRec = await Student.findById(booking.student).populate('user', 'fullname').lean();
        } catch (lookupErr) {
            console.error('submitQuote: Student lookup error:', lookupErr);
        }

        try {
            if (studentRec && studentRec.user) {
                const etaStr = eta ? ` (ETA: ${eta})` : '';
                await Notification.create({
                    title     : 'Fare Quote Received — Review & Accept',
                    message   : `${req.user.fullname} has quoted Rs ${fare.toLocaleString()}${etaStr} for your ride from "${booking.pickupLocation}" to "${booking.dropoffLocation}".`,
                    recipient : studentRec.user._id,
                    category  : 'Requests',
                    relatedTo : { model: 'CabBooking', docId: booking._id },
                    createdBy : req.user._id,
                    priority  : 'Medium'
                });
            }
        } catch (notifErr) {
            console.error('submitQuote: Student notification error:', notifErr);
        }

        res.redirect('/driver/bookings?success=Quote+submitted.+Waiting+for+student+to+respond.');

    } catch (err) {
        console.error('submitQuote Error:', err);
        res.redirect('/driver/bookings?error=Failed+to+submit+quote.');
    }
};


// ======================
// CAB BOOKINGS — RELEASE RESERVATION (driver cancels their hold on a request)
// POST /driver/bookings/reject/:id
// ======================
exports.releaseReservation = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'driver') return res.status(403).send('Access Denied');

        const booking = await CabBooking.findOneAndUpdate(
            {
                _id: req.params.id,
                reservedBy: req.user._id,
                status: { $in: ['Reserved', 'Awaiting Student'] }
            },
            {
                $set: {
                    status                : 'Pending',
                    reservedBy            : null,
                    reservedAt            : null,
                    reservationExpiresAt  : null,
                    'quote.fare'          : null,
                    'quote.eta'           : '',
                    'quote.submittedAt'   : null,
                    'studentDecision.status': 'pending',
                    'studentDecision.decidedAt': null
                }
            },
            { new: true }
        );

        if (!booking) {
            return res.redirect('/driver/bookings?error=You+are+not+holding+this+reservation+or+it+has+already+expired.');
        }

        // ── Notify the student that the driver released the request ──
        let studentRec = null;
        try {
            studentRec = await Student.findById(booking.student).populate('user', 'fullname').lean();
        } catch (lookupErr) {
            console.error('releaseReservation: Student lookup error:', lookupErr);
        }

        try {
            if (studentRec && studentRec.user) {
                await Notification.create({
                    title     : 'Ride Request — Driver Released',
                    message   : `${req.user.fullname} has released your ride request from "${booking.pickupLocation}" to "${booking.dropoffLocation}". It is now open for other drivers.`,
                    recipient : studentRec.user._id,
                    category  : 'Requests',
                    relatedTo : { model: 'CabBooking', docId: booking._id },
                    createdBy : req.user._id,
                    priority  : 'Medium'
                });
            }
        } catch (notifErr) {
            console.error('releaseReservation: Student notification error:', notifErr);
        }

        res.redirect('/driver/bookings?success=Reservation+released.');

    } catch (err) {
        console.error('releaseReservation Error:', err);
        res.redirect('/driver/bookings?error=Failed+to+release+reservation.');
    }
};


// ======================
// CAB BOOKINGS — UPDATE RIDE STATUS (start / complete ride)
// POST /driver/bookings/status/:id
// ======================
exports.updateRideStatus = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'driver') return res.status(403).send('Access Denied');

        const { newStatus, arrivedDropoffLocation } = req.body;

        let update = {};

        if (newStatus === 'In Progress') {
            if (!['Confirmed'].includes(req.body.currentStatus)) {
                return res.redirect('/driver/bookings?error=Booking+must+be+confirmed+before+starting+the+ride.');
            }
            update.status = 'In Progress';
        } else if (newStatus === 'Completed') {
            update.status = 'Completed';
            update.completedAt = new Date();
        } else {
            return res.redirect('/driver/bookings?error=Invalid+status+transition.');
        }

        const booking = await CabBooking.findOneAndUpdate(
            { _id: req.params.id, driver: req.user._id },
            { $set: update },
            { new: true }
        );

        if (!booking) {
            return res.redirect('/driver/bookings?error=Booking+not+found+or+not+assigned+to+you.');
        }

        res.redirect('/driver/bookings?success=Ride+status+updated+to+' + encodeURIComponent(update.status) + '.');

    } catch (err) {
        console.error('updateRideStatus Error:', err);
        res.redirect('/driver/bookings?error=Failed+to+update+ride+status.');
    }
};


// ======================
// CAB BOOKINGS — ACCEPT (legacy: driver accepts old-style direct booking)
// POST /driver/bookings/accept/:id
// Kept for backward compatibility with existing assigned bookings.
// ======================
exports.acceptBooking = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'driver') return res.status(403).send('Access Denied');

        const fare = Number(req.body.fare);
        if (!fare || fare <= 0) {
            return res.redirect('/driver/bookings?error=Please+enter+a+valid+fare+amount.');
        }

        // ── Atomic accept ──
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

        try {
            const studentName = studentRec?.user?.fullname || 'A student';
            const statusMsg = `Cab booking for ${studentName} (${booking.pickupLocation} → ${booking.dropoffLocation}) was accepted by ${req.user.fullname}.`;
            await Notification.create({ title: 'Cab Booking Accepted', message: statusMsg, target: 'Admins', category: 'Requests', relatedTo: { model: 'CabBooking', docId: booking._id }, createdBy: req.user._id, priority: 'Low' });
            await Notification.create({ title: 'Cab Booking Accepted', message: statusMsg, target: 'Wardens', category: 'Requests', relatedTo: { model: 'CabBooking', docId: booking._id }, createdBy: req.user._id, priority: 'Low' });
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
