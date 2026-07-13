const express = require('express');
const router  = express.Router();

const { wardenMiddleware } = require('../middleware/authMiddleware');
const wardenController     = require('../controllers/wardenController');
const upload = require('../utils/upload');

// ══════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════
router.get('/dashboard', wardenMiddleware, wardenController.getDashboard);

// ══════════════════════════════════════
// ATTENDANCE
// ══════════════════════════════════════
router.get('/attendance',                  wardenMiddleware, wardenController.getAttendance);
router.get('/attendance/search',           wardenMiddleware, wardenController.searchStudent);         // AJAX
router.post('/attendance/mark',            wardenMiddleware, wardenController.markAttendance);
router.post('/attendance/dispute/:id',     wardenMiddleware, wardenController.resolveDispute);

// ══════════════════════════════════════
// LEAVE REQUESTS
// ══════════════════════════════════════
router.get('/leave-requests',                          wardenMiddleware, wardenController.getLeaveRequests);
router.post('/leave-requests/guardian/:id',            wardenMiddleware, wardenController.markGuardianVerification);
router.post('/leave-requests/approve/:id',             wardenMiddleware, wardenController.approveLeave);
router.post('/leave-requests/reject/:id',              wardenMiddleware, wardenController.rejectLeave);

// ══════════════════════════════════════
// COMPLAINTS
// ══════════════════════════════════════
router.get('/complaints',               wardenMiddleware, wardenController.getComplaints);
router.post('/complaints/update/:id',   wardenMiddleware, wardenController.updateComplaintStatus);

// ══════════════════════════════════════
// ROOM REQUESTS
// ══════════════════════════════════════
router.get('/room-requests',                  wardenMiddleware, wardenController.getRoomRequests);
router.post('/room-requests/recommend/:id',   wardenMiddleware, wardenController.recommendRoomRequest);
router.post('/room-requests/reject/:id',      wardenMiddleware, wardenController.rejectRoomRequest);

// ══════════════════════════════════════
// MESS ORDERS
// ══════════════════════════════════════
// ══════════════════════════════════════
// MESS (Orders + Menu)
// ══════════════════════════════════════
router.get('/mess',                         wardenMiddleware, wardenController.getMessOrders);
router.post('/mess/update-status/:id',      wardenMiddleware, wardenController.updateMessStatus);
router.post('/mess/cash-received/:id',      wardenMiddleware, wardenController.markMessCashReceived);

router.post('/mess/menu/add-menu',          wardenMiddleware, wardenController.addMenu);
router.post('/mess/menu/items/add',         wardenMiddleware, upload.single('menuItemImage'), wardenController.addMenuItem);
router.post('/mess/menu/items/edit/:id',    wardenMiddleware, upload.single('menuItemImage'), wardenController.editMenuItem);
router.post('/mess/menu/items/delete/:id',  wardenMiddleware, wardenController.deleteMenuItem);
router.post('/mess/menu/publish',           wardenMiddleware, wardenController.publishTodayMenu);

// ══════════════════════════════════════
// LAUNDRY
// ══════════════════════════════════════
router.get('/laundry',                          wardenMiddleware, wardenController.getLaundryRequests);
router.post('/laundry/update-status/:id',       wardenMiddleware, wardenController.updateLaundryStatus);
router.post('/laundry/cash-received/:id',       wardenMiddleware, wardenController.markLaundryCashReceived);

// ══════════════════════════════════════
// MOBILE LOAD
// ══════════════════════════════════════
router.get('/mobile-load',                      wardenMiddleware, wardenController.getMobileLoad);
router.post('/mobile-load/cash-received/:id',   wardenMiddleware, wardenController.markMobileLoadCashReceived);
router.post('/mobile-load/complete/:id',        wardenMiddleware, wardenController.completeMobileLoad);
router.post('/mobile-load/reject/:id',          wardenMiddleware, wardenController.rejectMobileLoad);

// ══════════════════════════════════════
// NOTIFICATIONS
// ══════════════════════════════════════
router.get('/notifications',                    wardenMiddleware, wardenController.getNotifications);
router.post('/notifications/send',              wardenMiddleware, wardenController.sendNotification);
router.post('/notifications/mark-all-read',     wardenMiddleware, wardenController.markAllNotificationsRead);

// ══════════════════════════════════════
// VISITOR REQUESTS
// ══════════════════════════════════════
router.get('/visitor-requests', wardenMiddleware, wardenController.getVisitorRequests);
router.post('/visitor-requests/approve/:id', wardenMiddleware, wardenController.approveVisitorRequest);
router.post('/visitor-requests/reject/:id', wardenMiddleware, wardenController.rejectVisitorRequest);

module.exports = router;