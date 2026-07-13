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
    'public/uploads/mess'
];
dirs.forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});


// ── Storage engine ─────────────────────────────────────────────────────
const storage = multer.diskStorage({

    destination(req, file, cb) {
    if (file.fieldname === 'idImage') {
        cb(null, 'public/uploads/ids');
    } else if (file.fieldname === 'attachment') {   // ADD THIS BLOCK
        cb(null, 'public/uploads/complaints');
    } else if (file.fieldname === 'menuItemImage') {   // ADD THIS BLOCK
            cb(null, 'public/uploads/mess');
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


// ── File filter — images only ──────────────────────────────────────────
function fileFilter(req, file, cb) {
    const allowed = /jpeg|jpg|png|webp|pdf/;
    const ext     = path.extname(file.originalname).toLowerCase();
    if (allowed.test(ext)) {
        cb(null, true);
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