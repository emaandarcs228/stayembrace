const express = require('express');
const router = express.Router();
const upload = require('../utils/upload'); 
const { studentMiddleware } = require('../middleware/authMiddleware');
const studentController = require('../controllers/studentController');

// ══════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════
router.get('/dashboard', studentMiddleware, studentController.getDashboard);

// ══════════════════════════════════════
// PROFILE
// ══════════════════════════════════════
router.get('/profile', studentMiddleware, studentController.getProfile);

// ══════════════════════════════════════
// ROOM
// ══════════════════════════════════════
router.get('/room', studentMiddleware, studentController.getRoom);
router.post('/room/request', studentMiddleware, studentController.postRoomRequest);

// ══════════════════════════════════════
// ATTENDANCE
// ══════════════════════════════════════
router.get('/attendance', studentMiddleware, studentController.getAttendance);
router.post('/attendance/dispute', studentMiddleware, studentController.postAttendanceDispute);

// ══════════════════════════════════════
// LEAVE
// ══════════════════════════════════════
router.get('/leave', studentMiddleware, studentController.getLeave);
router.post('/leave/apply', studentMiddleware, studentController.postLeaveRequest);
router.post('/leave/cancel/:id', studentMiddleware, studentController.cancelLeaveRequest);

// ══════════════════════════════════════
// COMPLAINTS
// ══════════════════════════════════════
router.get('/complaints', studentMiddleware, studentController.getComplaints);
router.post(
    '/complaints/submit',
    studentMiddleware,
    upload.single('attachment'),
    studentController.postComplaint
);

// ══════════════════════════════════════
// MESS
// ══════════════════════════════════════
router.get('/mess', studentMiddleware, studentController.getMess);
router.post('/mess/order', studentMiddleware, studentController.postFoodOrder);
router.post('/mess/cancel/:id', studentMiddleware, studentController.cancelFoodOrder);

// ══════════════════════════════════════
// LAUNDRY
// ══════════════════════════════════════
router.get('/laundry', studentMiddleware, studentController.getLaundry);
router.post('/laundry/opt-out', studentMiddleware, studentController.optOutLaundry);
router.post('/laundry/second', studentMiddleware, studentController.requestSecondLaundry);
router.post('/laundry/second/cancel/:id', studentMiddleware, studentController.cancelSecondLaundry);

// ══════════════════════════════════════
// MOBILE LOAD
// ══════════════════════════════════════
router.get('/mobile-load', studentMiddleware, studentController.getMobileLoad);
router.post('/mobile-load/request', studentMiddleware, studentController.postMobileLoadRequest);

// ══════════════════════════════════════
// FEE & FINE
// ══════════════════════════════════════
router.get('/fee-fine', studentMiddleware, studentController.getFeeFine);

// ══════════════════════════════════════
// PENDING PAYMENTS
// ══════════════════════════════════════
router.get('/pending-payments', studentMiddleware, studentController.getPendingPayments);
router.post('/pending-payments/pay', studentMiddleware, studentController.postPayment);

// ══════════════════════════════════════
// JAZZCASH PAYMENTS (Mobile Wallet / MPIN)
// ══════════════════════════════════════
router.post('/payments/jazzcash/initiate', studentMiddleware, studentController.initiateJazzCashPayment);

// PUBLIC — JazzCash's server posts the transaction result here directly.
// It has no session cookie, so this route must NOT have studentMiddleware.
router.post('/payments/jazzcash/callback', studentController.jazzCashCallback);

router.get('/payments/jazzcash/status/:txnRef', studentMiddleware, studentController.getPaymentStatus);
router.get('/payments/jazzcash/result', studentMiddleware, studentController.showPaymentResult);

// ══════════════════════════════════════
// EASYPAISA PAYMENTS (Mobile Account)
// ══════════════════════════════════════
router.post('/payments/easypaisa/initiate', studentMiddleware, studentController.initiateEasypaisaPayment);

// PUBLIC — Easypaisa's server posts the IPN result here directly.
// It has no session cookie, so this route must NOT have studentMiddleware.
router.post('/payments/easypaisa/callback', studentController.easypaisaCallback);

router.get('/payments/easypaisa/status/:txnRef', studentMiddleware, studentController.getPaymentStatus);
router.get('/payments/easypaisa/result', studentMiddleware, studentController.showPaymentResult);

// ══════════════════════════════════════
// NOTIFICATIONS
// ══════════════════════════════════════
router.get('/notifications', studentMiddleware, studentController.getNotifications);
router.post('/notifications/mark-all-read', studentMiddleware, studentController.markAllNotificationsRead);

// ══════════════════════════════════════
// VISITORS & GUEST ROOM BOOKINGS
// ══════════════════════════════════════
router.get('/visitors', studentMiddleware, studentController.getVisitors);
router.post('/visitors/apply', studentMiddleware, studentController.postVisitorRequest);
router.post('/visitors/cancel/:id', studentMiddleware, studentController.cancelVisitorRequest);
router.post('/visitors/guest-room/request', studentMiddleware, studentController.postGuestBookingRequest);
router.post('/visitors/guest-room/cancel/:id', studentMiddleware, studentController.cancelGuestBooking);
router.get('/visitors/guest-room/available-rooms', studentMiddleware, studentController.getAvailableGuestRoomsForDates);

// ══════════════════════════════════════
// TRANSPORT — View approved providers
// ══════════════════════════════════════
router.get('/transport', studentMiddleware, studentController.getTransport);

// ══════════════════════════════════════
// CAB BOOKING — Book & cancel rides
// ══════════════════════════════════════
router.post('/transport/book', studentMiddleware, studentController.postCabBooking);
router.post('/transport/cancel/:id', studentMiddleware, studentController.cancelCabBooking);
router.post('/transport/rate/:id', studentMiddleware, studentController.rateCabBooking);
router.get('/transport/status', studentMiddleware, studentController.getCabBookingStatuses);

module.exports = router;