const express = require('express');
const router = express.Router();
const { driverMiddleware } = require('../middleware/authMiddleware');
const driverController = require('../controllers/driverController');
const upload = require('../utils/upload.js');

// ══════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════
router.get('/dashboard', driverMiddleware, driverController.getDashboard);

// ══════════════════════════════════════
// AVAILABILITY TOGGLE (Online / Offline)
// ══════════════════════════════════════
router.post('/availability/toggle', driverMiddleware, driverController.toggleAvailability);

// ══════════════════════════════════════
// PROFILE
// ══════════════════════════════════════
router.get('/profile', driverMiddleware, driverController.getProfile);

// ══════════════════════════════════════
// NOTIFICATIONS
// ══════════════════════════════════════
router.get('/notifications', driverMiddleware, driverController.getNotifications);
router.post('/notifications/mark-read/:id', driverMiddleware, driverController.markNotificationRead);
router.post('/notifications/mark-all-read', driverMiddleware, driverController.markAllNotificationsRead);

// ══════════════════════════════════════
// CAB BOOKINGS — Ride reservation workflow
// ══════════════════════════════════════
router.get('/bookings', driverMiddleware, driverController.getBookings);
router.get('/bookings/available', driverMiddleware, driverController.getAvailableRequests);
router.post('/bookings/reserve/:id', driverMiddleware, driverController.reserveRequest);
router.post('/bookings/quote/:id', driverMiddleware, driverController.submitQuote);
router.post('/bookings/reject/:id', driverMiddleware, driverController.releaseReservation);
router.post('/bookings/status/:id', driverMiddleware, driverController.advanceRideStage);
router.post('/bookings/cancel/:id', driverMiddleware, driverController.cancelConfirmedRide);
router.post('/bookings/accept/:id', driverMiddleware, driverController.acceptBooking);

// ══════════════════════════════════════
// VEHICLE MANAGEMENT
// ══════════════════════════════════════
router.get('/vehicle', driverMiddleware, driverController.getVehicle);

router.post(
    '/vehicle/update',
    driverMiddleware,
    upload.fields([
        { name: 'cnicFront',    maxCount: 1 },
        { name: 'cnicBack',     maxCount: 1 },
        { name: 'licenseImage', maxCount: 1 },
        { name: 'vehicleDoc',   maxCount: 1 }
    ]),
    driverController.updateVehicle
);

module.exports = router;
