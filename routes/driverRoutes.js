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
// PROFILE
// ══════════════════════════════════════
router.get('/profile', driverMiddleware, driverController.getProfile);

// ══════════════════════════════════════
// CAB BOOKINGS
// ══════════════════════════════════════
router.get('/bookings', driverMiddleware, driverController.getBookings);

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
