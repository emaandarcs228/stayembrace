const User = require('../models/user');
const Driver = require('../models/driver');
const Student = require('../models/student');
const CabBooking = require('../models/cabBooking');
const Notification = require('../models/notification');
const { getSidebarBadges } = require('../utils/sidebarBadges');
const {
    getValidPredecessors,
    getNextStage,
    ASSIGNED_GROUP,
    NEXT_STAGE_LABEL,
    BADGE_CLASS: RIDE_STATUS_BADGE_CLASS,
    LEGACY_DIRECT_CONFIRM_FROM,
    DRIVER_CANCELLABLE_FROM
} = require('../utils/rideStatus');
const { notifyStudent, notifyDriver } = require('../utils/rideNotifications');

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

        // ── Available ride requests — only shown when driver is online.
        // driver: null excludes legacy direct-assigned bookings (Pending,
        // reservedBy null, but already spoken for by a specific driver) so
        // they don't leak into every other driver's marketplace. ──
        const availableRequests = driver?.isOnline
            ? await CabBooking.find({ status: 'Pending', reservedBy: null, driver: null })
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
            status: { $in: ['Reserved by Driver', 'Waiting for Student Confirmation'] }
        })
            .populate({
                path: 'student',
                populate: { path: 'user', select: 'fullname userId phoneNumber' }
            })
            .sort({ createdAt: -1 })
            .lean();

        // ── Active rides (this driver's confirmed-through-not-yet-completed bookings) ──
        const activeRides = await CabBooking.find({
            driver: req.user._id,
            status: { $in: ASSIGNED_GROUP }
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
                { target: { $in: ['All'] }, readBy: { $nin: [req.user._id] } },
                { recipient: req.user._id, readBy: { $nin: [req.user._id] } }
            ]
        });
        const recentNotifs = await Notification.find({
            isActive: true,
            $or: [
                { target: { $in: ['All'] } },
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
            rideStatusBadgeClass: RIDE_STATUS_BADGE_CLASS,
            nextStageLabel: NEXT_STAGE_LABEL,
            driverCancellableFrom: DRIVER_CANCELLABLE_FROM,
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
                { target: { $in: ['All'] }, readBy: { $nin: [req.user._id] } },
                { recipient: req.user._id, readBy: { $nin: [req.user._id] } }
            ]
        });
        const recentNotifs = await Notification.find({
            isActive: true,
            $or: [
                { target: { $in: ['All'] } },
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
                { target: { $in: ['All'] }, readBy: { $nin: [req.user._id] } },
                { recipient: req.user._id, readBy: { $nin: [req.user._id] } }
            ]
        });
        const recentNotifs = await Notification.find({
            isActive: true,
            $or: [
                { target: { $in: ['All'] } },
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

        // ── Available requests — only shown when driver is online.
        // driver: null excludes legacy direct-assigned bookings so they
        // don't leak into every other driver's marketplace. ──
        const availableRequests = driver?.isOnline
            ? await CabBooking.find({
                status: 'Pending',
                reservedBy: null,
                driver: null
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
            status: { $in: ['Reserved by Driver', 'Waiting for Student Confirmation'] }
        })
            .populate({
                path: 'student',
                populate: { path: 'user', select: 'fullname userId phoneNumber' }
            })
            .sort({ createdAt: -1 })
            .lean();

        // ── Active rides (this driver's confirmed-through-not-yet-completed bookings) ──
        const activeRides = await CabBooking.find({
            driver: req.user._id,
            status: { $in: ASSIGNED_GROUP }
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
            status: { $in: ['Ride Completed', 'Cancelled'] }
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
                { target: { $in: ['All'] }, readBy: { $nin: [req.user._id] } },
                { recipient: req.user._id, readBy: { $nin: [req.user._id] } }
            ]
        });
        const recentNotifs = await Notification.find({
            isActive: true,
            $or: [
                { target: { $in: ['All'] } },
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
            rideStatusBadgeClass: RIDE_STATUS_BADGE_CLASS,
            nextStageLabel: NEXT_STAGE_LABEL,
            driverCancellableFrom: DRIVER_CANCELLABLE_FROM,
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

        const requests = await CabBooking.find({ status: 'Pending', reservedBy: null, driver: null })
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

        // ── Atomic reserve: only succeeds if still Pending, not already
        // reserved, and not a legacy booking already assigned to a
        // specific driver. ──
        const booking = await CabBooking.findOneAndUpdate(
            { _id: req.params.id, status: { $in: getValidPredecessors('Reserved by Driver') }, reservedBy: null, driver: null },
            {
                $set: {
                    status                : 'Reserved by Driver',
                    reservedBy            : req.user._id,
                    reservedAt            : now,
                    reservationExpiresAt  : expiresAt
                },
                $push: {
                    statusHistory: { status: 'Reserved by Driver', changedBy: req.user._id, changedByRole: 'driver', at: now }
                }
            },
            { new: true }
        );

        if (!booking) {
            const existing = await CabBooking.findById(req.params.id).select('status reservedBy driver').lean();
            if (!existing) {
                return res.redirect('/driver/bookings?error=Request+not+found.');
            }
            if (existing.driver) {
                return res.redirect('/driver/bookings?error=This+request+is+already+assigned+to+a+driver.');
            }
            if (existing.reservedBy) {
                return res.redirect('/driver/bookings?error=This+request+was+just+reserved+by+another+driver.');
            }
            return res.redirect('/driver/bookings?error=' + encodeURIComponent(
                `This request is ${existing.status} and cannot be reserved.`
            ));
        }

        // ── Confirm to the driver themselves (durable record, not just
        // the redirect flash message) ──
        try {
            await notifyDriver('RIDE_RESERVED', {
                recipient: req.user._id,
                actorId  : req.user._id,
                bookingId: booking._id,
                ctx: { pickup: booking.pickupLocation, dropoff: booking.dropoffLocation }
            });
        } catch (notifErr) {
            console.error('reserveRequest: Driver confirmation notification error:', notifErr);
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
        const comments = req.body.comments || '';
        const now = new Date();

        // ── Atomic: only succeeds if this driver reserved it, it's still
        // Reserved by Driver, and the 2-minute reservation window has not
        // expired ──
        const booking = await CabBooking.findOneAndUpdate(
            {
                _id: req.params.id,
                reservedBy: req.user._id,
                status: 'Reserved by Driver',
                reservationExpiresAt: { $gt: now }
            },
            {
                $set: {
                    status              : 'Waiting for Student Confirmation',
                    'quote.fare'        : fare,
                    'quote.eta'         : eta,
                    'quote.comments'    : comments,
                    'quote.submittedAt' : new Date(),
                    // Refresh the 2-min timer so the student has time to respond
                    reservationExpiresAt: new Date(now.getTime() + 2 * 60 * 1000)
                },
                $push: {
                    statusHistory: { status: 'Waiting for Student Confirmation', changedBy: req.user._id, changedByRole: 'driver', at: now }
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
            if (existing.status === 'Reserved by Driver' && existing.reservationExpiresAt && existing.reservationExpiresAt <= now) {
                // Expired right under us — release immediately instead of making
                // the driver wait for the next sweep of reservationTimeoutJob.
                await CabBooking.updateOne(
                    { _id: req.params.id, status: 'Reserved by Driver', reservedBy: req.user._id },
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
                await notifyStudent('DRIVER_OFFERED_FARE', {
                    recipient: studentRec.user._id,
                    actorId  : req.user._id,
                    bookingId: booking._id,
                    ctx: { driverName: req.user.fullname, fare, eta, comments, pickup: booking.pickupLocation, dropoff: booking.dropoffLocation }
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

        const now = new Date();
        const booking = await CabBooking.findOneAndUpdate(
            {
                _id: req.params.id,
                reservedBy: req.user._id,
                status: { $in: ['Reserved by Driver', 'Waiting for Student Confirmation'] }
            },
            {
                $set: {
                    status                : 'Pending',
                    reservedBy            : null,
                    reservedAt            : null,
                    reservationExpiresAt  : null,
                    'quote.fare'          : null,
                    'quote.eta'           : '',
                    'quote.comments'      : '',
                    'quote.submittedAt'   : null,
                    'studentDecision.status': 'pending',
                    'studentDecision.decidedAt': null
                },
                $push: {
                    statusHistory: { status: 'Pending', changedBy: req.user._id, changedByRole: 'driver', at: now, note: 'Driver released reservation' }
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
// CAB BOOKINGS — ADVANCE RIDE STAGE (one click always moves to the very
// next stage in the post-confirmation chain: Ride Confirmed → Driver On
// the Way → Driver Arrived → Student Coming → Ride Started → Ride
// Completed). The next stage is always computed server-side from the
// booking's CURRENT status in the DB — the client never supplies or is
// trusted for "current status"/"target status".
// POST /driver/bookings/status/:id
// ======================
exports.advanceRideStage = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'driver') return res.status(403).send('Access Denied');

        const existing = await CabBooking.findOne({ _id: req.params.id, driver: req.user._id }).select('status').lean();
        if (!existing) {
            return res.redirect('/driver/bookings?error=Booking+not+found+or+not+assigned+to+you.');
        }

        const nextStatus = getNextStage(existing.status);
        if (!nextStatus) {
            return res.redirect('/driver/bookings?error=' + encodeURIComponent(
                `Cannot advance from "${existing.status}".`
            ));
        }

        const now = new Date();
        const set = { status: nextStatus };
        if (nextStatus === 'Driver On the Way') set.driverOnWayAt = now;
        if (nextStatus === 'Driver Arrived') set.driverArrivedAt = now;
        if (nextStatus === 'Student Coming') set.studentComingAt = now;
        if (nextStatus === 'Ride Started') set.rideStartedAt = now;
        if (nextStatus === 'Ride Completed') set.completedAt = now;

        // ── Atomic guard: only succeeds if the DB is STILL at the exact
        // status we just read, so a double-click / concurrent request
        // can't advance the same booking twice. ──
        const booking = await CabBooking.findOneAndUpdate(
            { _id: req.params.id, driver: req.user._id, status: existing.status },
            {
                $set: set,
                $push: { statusHistory: { status: nextStatus, changedBy: req.user._id, changedByRole: 'driver', at: now } }
            },
            { new: true }
        );

        if (!booking) {
            return res.redirect('/driver/bookings?error=Ride+status+already+changed+by+another+action.+Refresh+and+try+again.');
        }

        // ── Notify the student that the ride's status moved forward ──
        const STUDENT_EVENT_FOR_STAGE = {
            'Driver On the Way': 'DRIVER_ON_THE_WAY',
            'Driver Arrived'   : 'DRIVER_ARRIVED',
            'Ride Started'     : 'RIDE_STARTED',
            'Ride Completed'   : 'RIDE_COMPLETED'
        };
        let studentRec = null;
        try {
            studentRec = await Student.findById(booking.student).populate('user', '_id fullname').lean();
            if (studentRec && studentRec.user) {
                const eventKey = STUDENT_EVENT_FOR_STAGE[nextStatus];
                if (eventKey) {
                    await notifyStudent(eventKey, {
                        recipient: studentRec.user._id,
                        actorId  : req.user._id,
                        bookingId: booking._id,
                        ctx: { driverName: req.user.fullname, fare: booking.fare, pickup: booking.pickupLocation, dropoff: booking.dropoffLocation }
                    });
                } else {
                    // 'Student Coming' (driver marking it on the student's
                    // behalf) isn't one of the named catalog events — keep
                    // it as a plain notice.
                    await Notification.create({
                        title     : 'Ride Update — Student Coming',
                        message   : `${req.user.fullname} is waiting for you at "${booking.pickupLocation}".`,
                        recipient : studentRec.user._id,
                        category  : 'Requests',
                        relatedTo : { model: 'CabBooking', docId: booking._id },
                        createdBy : req.user._id,
                        priority  : 'Medium'
                    });
                }
            }
        } catch (notifErr) {
            console.error('advanceRideStage: Student notification error:', notifErr);
        }

        // ── Confirm to the driver themselves once the ride is complete ──
        if (nextStatus === 'Ride Completed') {
            try {
                await notifyDriver('RIDE_COMPLETED', {
                    recipient: req.user._id,
                    actorId  : req.user._id,
                    bookingId: booking._id,
                    ctx: { studentName: studentRec?.user?.fullname || 'the student', fare: booking.fare }
                });
            } catch (notifErr) {
                console.error('advanceRideStage: Driver completion notification error:', notifErr);
            }
        }

        res.redirect('/driver/bookings?success=Ride+status+updated+to+' + encodeURIComponent(nextStatus) + '.');

    } catch (err) {
        console.error('advanceRideStage Error:', err);
        res.redirect('/driver/bookings?error=Failed+to+update+ride+status.');
    }
};


// ======================
// CAB BOOKINGS — DRIVER CANCELS A CONFIRMED RIDE (before reaching pickup)
// Only valid while status is 'Ride Confirmed' or 'Driver On the Way' —
// once the driver marks 'Driver Arrived' they're on-site and this path
// is no longer appropriate.
// POST /driver/bookings/cancel/:id
// ======================
exports.cancelConfirmedRide = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'driver') return res.status(403).send('Access Denied');

        const reason = (req.body.reason || '').trim();
        if (!reason) {
            return res.redirect('/driver/bookings?error=Please+enter+a+reason+for+cancelling+this+ride.');
        }

        const now = new Date();

        const existing = await CabBooking.findOne({ _id: req.params.id, driver: req.user._id })
            .select('status fare paymentStatus pickupLocation dropoffLocation student')
            .lean();

        if (!existing) {
            return res.redirect('/driver/bookings?error=Booking+not+found+or+not+assigned+to+you.');
        }
        if (!DRIVER_CANCELLABLE_FROM.includes(existing.status)) {
            return res.redirect('/driver/bookings?error=' + encodeURIComponent(
                `This ride is "${existing.status}" and can no longer be cancelled this way.`
            ));
        }

        // Driver-initiated cancellation is not the student's fault — no
        // cancellation fee applies (unlike the student-cancellation
        // policy). If already paid, flag the full fare for a manual
        // refund (no payment-gateway refund API exists in this codebase).
        const wasPaid = existing.paymentStatus === 'Paid';
        const setFields = {
            status: 'Cancelled',
            cancellation: { by: 'driver', reason, at: now }
        };
        if (wasPaid) setFields.paymentStatus = 'Refund Pending';

        // ── Atomic guard: only succeeds if the DB is STILL at the exact
        // status we just read, so a double-click / concurrent advance
        // can't race this cancellation. ──
        const booking = await CabBooking.findOneAndUpdate(
            { _id: req.params.id, driver: req.user._id, status: existing.status },
            {
                $set: setFields,
                $push: { statusHistory: { status: 'Cancelled', changedBy: req.user._id, changedByRole: 'driver', at: now, note: reason } }
            },
            { new: true }
        );

        if (!booking) {
            return res.redirect('/driver/bookings?error=Ride+status+already+changed.+Refresh+and+try+again.');
        }

        // ── Notify the student ──
        try {
            const studentRec = await Student.findById(booking.student).populate('user', '_id fullname').lean();
            if (studentRec && studentRec.user) {
                await notifyStudent('RIDE_CANCELLED', {
                    recipient: studentRec.user._id,
                    actorId  : req.user._id,
                    bookingId: booking._id,
                    ctx: {
                        pickup: booking.pickupLocation,
                        dropoff: booking.dropoffLocation,
                        by: 'the driver',
                        reason,
                        refundNote: wasPaid ? 'A full refund will be processed by the hostel.' : ''
                    }
                });
            }
        } catch (notifErr) {
            console.error('cancelConfirmedRide: Student notification error:', notifErr);
        }

        // ── If the fare was already paid, flag the refund for admins/wardens ──
        if (wasPaid) {
            try {
                const msg = `Driver ${req.user.fullname} cancelled a paid, confirmed ride (${booking.pickupLocation} → ${booking.dropoffLocation}). Full refund owed: Rs ${existing.fare.toLocaleString()}.`;
                await Notification.create({ title: 'Cab Booking Refund Owed', message: msg, target: 'Admins', category: 'Payments', relatedTo: { model: 'CabBooking', docId: booking._id }, createdBy: req.user._id, priority: 'Medium' });
                await Notification.create({ title: 'Cab Booking Refund Owed', message: msg, target: 'Wardens', category: 'Payments', relatedTo: { model: 'CabBooking', docId: booking._id }, createdBy: req.user._id, priority: 'Medium' });
            } catch (notifErr) {
                console.error('cancelConfirmedRide: Refund notification error:', notifErr);
            }
        }

        res.redirect('/driver/bookings?success=Ride+cancelled.');

    } catch (err) {
        console.error('cancelConfirmedRide Error:', err);
        res.redirect('/driver/bookings?error=Failed+to+cancel+ride.');
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

        // ── Atomic accept: this is the legacy direct-assign path (booking
        // created with `driver` pre-set, skipping the whole reservation
        // cycle), so it deliberately jumps Pending → Ride Confirmed rather
        // than going through the marketplace TRANSITIONS table. ──
        const now = new Date();
        const booking = await CabBooking.findOneAndUpdate(
            { _id: req.params.id, driver: req.user._id, status: { $in: LEGACY_DIRECT_CONFIRM_FROM } },
            {
                $set: { status: 'Ride Confirmed', confirmedAt: now, fare, paymentStatus: 'Unpaid' },
                $push: { statusHistory: { status: 'Ride Confirmed', changedBy: req.user._id, changedByRole: 'driver', at: now, note: 'Legacy direct-accept path' } }
            },
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
                await notifyStudent('RIDE_CONFIRMED', {
                    recipient: studentRec.user._id,
                    actorId  : req.user._id,
                    bookingId: booking._id,
                    ctx: { driverName: booking.driverName || req.user.fullname, fare: booking.fare, pickup: booking.pickupLocation, dropoff: booking.dropoffLocation }
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
// NOTIFICATIONS — LIST
// GET /driver/notifications?page=1&limit=20
// ======================
exports.getNotifications = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'driver') return res.status(403).send('Access Denied');

        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(50, Math.max(5, parseInt(req.query.limit) || 20));
        const skip = (page - 1) * limit;

        const query = {
            isActive: true,
            $or: [
                { target: { $in: ['All'] } },
                { recipient: req.user._id }
            ]
        };

        const driverRec = await Driver.findOne({ user: req.user._id }).select('isOnline').lean();

        const [notifications, total] = await Promise.all([
            Notification.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Notification.countDocuments(query)
        ]);

        const userId = req.user._id;
        notifications.forEach(n => {
            n._isUnread = !n.readBy || !n.readBy.map(String).includes(String(userId));
            n._timeAgo = timeAgo(n.createdAt);
        });

        // Unread count for sidebar badge
        const unreadCount = await Notification.countDocuments({
            isActive: true,
            $or: [
                { target: { $in: ['All'] }, readBy: { $nin: [userId] } },
                { recipient: userId, readBy: { $nin: [userId] } }
            ]
        });

        // Recent notifs for topbar dropdown
        const recentNotifs = await Notification.find(query)
            .sort({ createdAt: -1 })
            .limit(5)
            .lean();
        recentNotifs.forEach(n => { n._timeAgo = timeAgo(n.createdAt); });

        const totalPages = Math.ceil(total / limit);
        const badges = await getSidebarBadges(req.user);

        res.render('driver/notifications', {
            user: req.user,
            driver: driverRec || {},
            activePage: 'notifications',
            pageTitle: 'Notifications',
            pageSubtitle: 'Stay updated with your ride alerts and announcements',
            notifications,
            unreadCount,
            recentNotifs,
            page,
            limit,
            total,
            totalPages,
            ...badges,
            successMessage: req.query.success || null,
            errorMessage: req.query.error || null
        });
    } catch (err) {
        console.error('getNotifications Error:', err);
        res.status(500).send('Server Error');
    }
};


// ======================
// NOTIFICATIONS — MARK SINGLE AS READ
// POST /driver/notifications/mark-read/:id
// ======================
exports.markNotificationRead = async (req, res) => {
    try {
        const userId = req.user._id;
        await Notification.findByIdAndUpdate(
            req.params.id,
            { $addToSet: { readBy: userId } }
        );
        res.json({ success: true });
    } catch (err) {
        console.error('markNotificationRead:', err);
        res.status(500).json({ error: 'Server error' });
    }
};


// ======================
// NOTIFICATIONS — MARK ALL READ
// POST /driver/notifications/mark-all-read
// ======================
exports.markAllNotificationsRead = async (req, res) => {
    try {
        const userId = req.user._id;
        await Notification.updateMany(
            {
                isActive: true,
                readBy  : { $nin: [userId] },
                $or: [
                    { target: { $in: ['All'] } },
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
