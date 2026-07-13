const express        = require('express');
const router         = express.Router();

const authController = require('../controllers/authController');
const upload         = require('../utils/upload.js');   // ← multer config

// ── Student registration (multipart — handles idImage file upload) ──
router.post(
    '/register/student',
    upload.single('idImage'),          // multer processes the file first
    authController.registerStudent
);

// ── Login routes ──
router.post('/login/student', authController.loginStudent);
router.post('/login/admin',   authController.loginAdmin);
router.post('/login/warden',  authController.loginWarden);

// ── Logout ──
router.get('/logout', authController.logout);

// ── Pending approval page ──
router.get('/register/student/pending', (req, res) => {
    res.render('register-pending');
});

module.exports = router;