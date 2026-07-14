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

// ── Driver registration (multipart — handles 4 document uploads) ──
router.post(
    '/register/driver',
    upload.fields([
        { name: 'cnicFront',    maxCount: 1 },
        { name: 'cnicBack',     maxCount: 1 },
        { name: 'licenseImage', maxCount: 1 },
        { name: 'vehicleDoc',   maxCount: 1 }
    ]),
    authController.registerDriver
);

// ── Login routes ──
router.post('/login/student', authController.loginStudent);
router.post('/login/admin',   authController.loginAdmin);
router.post('/login/warden',  authController.loginWarden);
router.post('/login/driver',  authController.loginDriver);

// ── Logout ──
router.get('/logout', authController.logout);

// ── Pending approval pages ──
router.get('/register/student/pending', (req, res) => {
    res.render('register-pending');
});
router.get('/register/driver/pending', (req, res) => {
    res.render('register-driver-pending');
});

module.exports = router;