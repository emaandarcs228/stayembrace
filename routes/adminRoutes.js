const express             = require('express');
const router              = express.Router();
const adminController     = require('../controllers/adminController');
const operationController = require('../controllers/operationController');
const roomController      = require('../controllers/roomController');
const feeController       = require('../controllers/feeController');
const { adminMiddleware } = require('../middleware/authMiddleware');
const upload              = require('../utils/upload');

// ======================
// ADMIN DASHBOARD
// ======================
router.get('/dashboard', adminMiddleware, adminController.getDashboard);

// ======================
// PENDING STUDENTS
// ======================
router.get('/pending-students', adminMiddleware, adminController.getPendingStudents);
router.post('/approve/:id', adminMiddleware, adminController.approveStudent);
router.post('/reject/:id', adminMiddleware, adminController.rejectStudent);

// ======================
// USER MANAGEMENT
// ======================
router.get('/users', adminMiddleware, adminController.getUserManagement);
router.get('/users/preview-id', adminMiddleware, adminController.previewNextUserId);
router.get('/users/view/:id', adminMiddleware, adminController.viewUser);
router.get('/users/edit/:id', adminMiddleware, adminController.getEditUser);
router.post('/users/edit/:id', adminMiddleware, adminController.updateUser);
router.post('/users/delete/:id', adminMiddleware, adminController.deleteUser);
router.post('/users/add', adminMiddleware, adminController.addUser);

// ======================
// STUDENT ADDITIONAL INFO
// ======================
router.get('/students/:userId/info', adminMiddleware, adminController.getStudentInfo);
router.post('/students/:userId/info', adminMiddleware, adminController.saveStudentInfo);

// ======================
// ROOM MANAGEMENT
// ======================
router.get('/rooms', adminMiddleware, roomController.getRoomManagement);
router.post('/rooms/add', adminMiddleware, roomController.addRoom);
router.post('/rooms/edit/:id', adminMiddleware, roomController.editRoom);
router.post('/rooms/delete/:id', adminMiddleware, roomController.deleteRoom);
router.post('/rooms/allocate/:roomId', adminMiddleware, roomController.allocateRoom);
router.post('/rooms/vacate/:allocId', adminMiddleware, roomController.vacateRoom);
router.post('/rooms/transfer/:allocId', adminMiddleware, roomController.transferStudent);
router.get('/rooms/:roomId/occupants', adminMiddleware, roomController.getRoomOccupants);
router.get('/rooms/:roomId/free-beds', adminMiddleware, roomController.getAvailableBeds);

router.get('/rooms/:roomId/guest-bookings', adminMiddleware, roomController.getRoomGuestBookings);

// ======================
// FEE & PAYMENT MANAGEMENT
// ======================
router.get('/fees', adminMiddleware, feeController.getFeeManagement);
router.post('/fees/payments/add', adminMiddleware, feeController.addPayment);
router.post('/fees/payments/verify/:id', adminMiddleware, feeController.verifyPayment);
router.post('/fees/payments/reject/:id', adminMiddleware, feeController.rejectPayment);
router.post('/fees/payments/cash-received/:id', adminMiddleware, feeController.markCashReceived);
router.post('/fees/dues/generate', adminMiddleware, feeController.generateDue);
router.post('/fees/dues/mark-paid/:id', adminMiddleware, feeController.markDuePaid);
router.post('/fees/dues/delete/:id', adminMiddleware, feeController.deleteDue);
router.post('/fees/fines/apply', adminMiddleware, feeController.applyFine);
router.post('/fees/fines/waive/:id', adminMiddleware, feeController.waiveFine);
router.post('/fees/fines/mark-paid/:id', adminMiddleware, feeController.markFinePaid);

// ======================
// OPERATIONS OVERSIGHT (warden oversight — view + override)
// Handled by operationController.js, kept separate from
// adminController.js. Route paths match what's already scaffolded in
// admin-header.ejs's sidebar nav (activePage 'ops-leave', etc.).
// ======================

router.get('/operations/attendance',              adminMiddleware, operationController.getAttendance);
router.get('/operations/attendance/search-students', adminMiddleware, operationController.searchStudentsForMarking);
router.post('/operations/attendance/dispute/:id', adminMiddleware, operationController.resolveDisputeOverride);

// ── Emergency attendance mark ──────────────────────────────
router.post('/attendance/mark',                   adminMiddleware, operationController.markAttendance);
// ─────────────────────────────────────────────────────────────────

router.get('/operations/leave',              adminMiddleware, operationController.getLeaveRequests);
router.post('/operations/leave/guardian/:id', adminMiddleware, operationController.markGuardianVerification);
router.post('/operations/leave/approve/:id',  adminMiddleware, operationController.approveLeave);
router.post('/operations/leave/reject/:id',   adminMiddleware, operationController.rejectLeave);

router.get('/operations/complaints',             adminMiddleware, operationController.getComplaints);
router.post('/operations/complaints/status/:id', adminMiddleware, operationController.updateComplaintStatus);

router.get('/operations/room-requests',                       adminMiddleware, operationController.getRoomRequests);
router.post('/operations/room-requests/approve-transfer/:id', adminMiddleware, operationController.approveTransferRequest);
router.post('/operations/room-requests/approve-vacate/:id',   adminMiddleware, operationController.approveVacateRequest);
router.post('/operations/room-requests/reject/:id',           adminMiddleware, operationController.rejectRoomRequest);

// =====================================================================
// ADD THIS BLOCK — suggested placement right after the Room Requests
// operations block (after `router.post('/operations/room-requests/reject/:id', ...)`)
// in adminRoutes.js.
// =====================================================================

router.get('/operations/guest-bookings',              adminMiddleware, operationController.getGuestBookings);
router.post('/operations/guest-bookings/approve/:id', adminMiddleware, operationController.approveGuestBooking);
router.post('/operations/guest-bookings/reject/:id',  adminMiddleware, operationController.rejectGuestBooking);

// =====================================================================
//visitor requests (warden oversight — view + override)
// =====================================================================

router.post('/admin/operations/guest-bookings/visitor/approve/:id',adminMiddleware,operationController.approveVisitorRequest);
router.post('/admin/operations/guest-bookings/visitor/reject/:id',    adminMiddleware,operationController.rejectVisitorRequest);
router.post('/admin/operations/guest-bookings/visitor/override/:id',  adminMiddleware,operationController.overrideVisitorRequest);


// ======================
// MESS ORDERS & MENU (warden oversight — view + override)
// ======================
router.get('/operations/mess',                       adminMiddleware, operationController.getMessOrders);
router.post('/operations/mess/update-status/:id',    adminMiddleware, operationController.updateMessStatus);
router.post('/operations/mess/cash-received/:id',    adminMiddleware, operationController.markMessCashReceived);

router.post('/operations/mess/menu/add-menu',         adminMiddleware, operationController.addMessMenu);
router.post('/operations/mess/menu/items/add',        adminMiddleware, upload.single('menuItemImage'), operationController.addMessMenuItem);
router.post('/operations/mess/menu/items/edit/:id',   adminMiddleware, upload.single('menuItemImage'), operationController.editMessMenuItem);
router.post('/operations/mess/menu/items/delete/:id', adminMiddleware, operationController.deleteMessMenuItem);
router.post('/operations/mess/menu/publish',           adminMiddleware, operationController.publishMessMenu);

// ======================
// LAUNDRY OVERSIGHT (warden oversight — view + override)
// ======================
router.get('/operations/laundry',                   adminMiddleware, operationController.getLaundryRequests);
router.post('/operations/laundry/update-status/:id', adminMiddleware, operationController.overrideLaundryStatus);

// ======================
// NOTIFICATIONS
// ======================
router.get('/notifications', adminMiddleware, adminController.getNotifications);
router.post('/notifications/send', adminMiddleware, adminController.sendNotification);
router.post('/notifications/mark-all-read', adminMiddleware, adminController.markAllNotificationsRead);

// ======================
// MOBILE LOAD OVERSIGHT (warden oversight — view + full override)
// ======================
router.get('/operations/mobile-load',                    adminMiddleware, operationController.getMobileLoad);
router.post('/operations/mobile-load/cash-received/:id', adminMiddleware, operationController.markMobileLoadCashReceived);
router.post('/operations/mobile-load/complete/:id',      adminMiddleware, operationController.completeMobileLoad);
router.post('/operations/mobile-load/reject/:id',        adminMiddleware, operationController.rejectMobileLoad);
router.post('/operations/mobile-load/override/:id',      adminMiddleware, operationController.overrideMobileLoad);

// ======================
// ADMIN PROFILE
// ======================
router.get('/profile', adminMiddleware, async (req, res) => {
    try {
        res.render('admin/profile', { user: req.user });
    } catch (err) {
        console.error('Profile Error:', err);
        res.status(500).send('Server Error');
    }
});

module.exports = router;