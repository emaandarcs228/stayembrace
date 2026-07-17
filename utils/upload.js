// =====================================================================
// upload.js — Multer configuration for file uploads
//
// Handles:
//   - profileImage  (profile pictures)
//   - idImage       (student ID document uploaded at registration)
//
// Files are stored in /public/uploads/<subfolder>/
// Filenames are timestamped to avoid collisions.
// =====================================================================

const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

// ── Ensure upload directories exist ───────────────────────────────────
const dirs = [
    'public/uploads/profiles',
    'public/uploads/ids',
    'public/uploads/complaints',
    'public/uploads/mess',
    'public/uploads/driver-docs'
];
dirs.forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});


// ── Storage engine ─────────────────────────────────────────────────────
const storage = multer.diskStorage({

    destination(req, file, cb) {
    if (file.fieldname === 'idImage') {
        cb(null, 'public/uploads/ids');
    } else if (file.fieldname === 'attachment') {
        cb(null, 'public/uploads/complaints');
    } else if (file.fieldname === 'menuItemImage') {
        cb(null, 'public/uploads/mess');
    } else if (['cnicFront', 'cnicBack', 'licenseImage', 'vehicleDoc', 'profilePhoto', 'additionalDoc'].includes(file.fieldname)) {
        cb(null, 'public/uploads/driver-docs');
    } else {
        cb(null, 'public/uploads/profiles');
    }
    
    },

    filename(req, file, cb) {
        const ext      = path.extname(file.originalname).toLowerCase();
        const safeName = Date.now() + '-' + Math.round(Math.random() * 1e6) + ext;
        cb(null, safeName);
    }
});


// ── File filter — images & PDFs ────────────────────────────────────────
function fileFilter(req, file, cb) {
    // Profile photos must be images only (no PDFs)
    const isProfilePhoto = file.fieldname === 'profilePhoto';
    const allowed = isProfilePhoto ? /jpeg|jpg|png|webp/ : /jpeg|jpg|png|webp|pdf/;
    const ext     = path.extname(file.originalname).toLowerCase();
    if (allowed.test(ext)) {
        cb(null, true);
    } else if (isProfilePhoto) {
        cb(new Error('Profile photo must be an image (jpg, png, webp). PDFs are not allowed.'));
    } else {
        cb(new Error('Only image files (jpg, png, webp) and PDFs are allowed.'));
    }
}


// ── Multer instance — 5 MB limit ──────────────────────────────────────
const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 }   // 5 MB
});


module.exports = upload;