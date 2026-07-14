// =====================================================================
// validateFile.js — File signature (magic byte) verification
//
// Reads the first few bytes of an uploaded file and compares them
// against known signatures for the allowed formats. This prevents
// users from renaming arbitrary files (e.g. .exe → .jpg) and
// uploading them as valid documents.
// =====================================================================

const fs   = require('fs');
const path = require('path');

// ── Magic byte signatures (first bytes of the file) ───────────────────
const SIGNATURES = {
    /**
     * JPEG:  FF D8 FF
     *   (first 3 bytes: 0xFF, 0xD8, 0xFF)
     */
    jpeg: { offset: 0, bytes: [0xFF, 0xD8, 0xFF] },

    /**
     * PNG:  89 50 4E 47 0D 0A 1A 0A
     *   (first 8 bytes)
     */
    png: { offset: 0, bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] },

    /**
     * WebP: RIFF .... WEBP
     *   (bytes 0-3: 0x52, 0x49, 0x46, 0x46 = 'RIFF')
     *   (bytes 8-11: 0x57, 0x45, 0x42, 0x50 = 'WEBP')
     */
    webp: [
        { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
        { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] }
    ],

    /**
     * PDF:  25 50 44 46 = '%PDF'
     *   (first 4 bytes)
     */
    pdf: { offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] }
};


/**
 * Read `length` bytes from a file starting at `offset`.
 * Returns a Buffer of the read bytes, or null on error.
 */
function readFileBytes(filePath, offset = 0, length = 12) {
    try {
        const fd = fs.openSync(filePath, 'r');
        const buf = Buffer.alloc(length);
        fs.readSync(fd, buf, 0, length, offset);
        fs.closeSync(fd);
        return buf;
    } catch (err) {
        return null;
    }
}


/**
 * Check whether `buf` (a Buffer) matches a single signature descriptor.
 * `sig` has the shape { offset, bytes } where `bytes` is an array of
 * expected byte values (0–255).
 */
function matchesSignature(buf, sig) {
    if (!buf || buf.length < sig.offset + sig.bytes.length) return false;
    for (let i = 0; i < sig.bytes.length; i++) {
        if (buf[sig.offset + i] !== sig.bytes[i]) return false;
    }
    return true;
}


/**
 * Determine the actual file type by reading magic bytes.
 *
 * @param {string} filePath - Absolute path to the uploaded file
 * @returns {string|null} - Detected extension ('jpeg'|'png'|'webp'|'pdf') or null if unknown/corrupt
 */
function detectFileType(filePath) {
    const buf = readFileBytes(filePath);
    if (!buf) return null;

    // JPEG
    if (matchesSignature(buf, SIGNATURES.jpeg)) return 'jpeg';
    // PNG
    if (matchesSignature(buf, SIGNATURES.png))   return 'png';
    // WebP (two signature parts at offset 0 and offset 8)
    if (matchesSignature(buf, SIGNATURES.webp[0]) && matchesSignature(buf, SIGNATURES.webp[1])) return 'webp';
    // PDF
    if (matchesSignature(buf, SIGNATURES.pdf))   return 'pdf';

    return null;
}


/**
 * Validate a single uploaded file.
 *
 * @param {string} filePath - Absolute path to the file
 * @param {number} [minSizeBytes=5120] - Minimum file size in bytes (default 5 KB)
 * @returns {{ valid: boolean, type: string|null, reason: string }}
 */
function validateFile(filePath, minSizeBytes = 5120) {
    // 1. Check file exists and has minimum size
    let stat;
    try {
        stat = fs.statSync(filePath);
    } catch (_) {
        return { valid: false, type: null, reason: 'File not found on server.' };
    }

    if (stat.size < minSizeBytes) {
        return { valid: false, type: null, reason: `File is too small (${stat.size} bytes). Minimum is ${minSizeBytes} bytes.` };
    }

    // 2. Check magic bytes
    const detected = detectFileType(filePath);
    if (!detected) {
        return { valid: false, type: null, reason: 'File does not match any allowed format (JPEG, PNG, WebP, PDF). The file may be corrupt or renamed.' };
    }

    return { valid: true, type: detected, reason: null };
}


/**
 * Validate all document files uploaded for a driver registration.
 * Returns the first invalid file found, or null if all are valid.
 *
 * @param {object} files - req.files object from multer (fieldname → [file, ...])
 * @param {number} [minSizeBytes=5120]
 * @returns {{ field: string, reason: string } | null}
 */
function validateDriverDocuments(files, minSizeBytes = 5120) {
    if (!files) return null;

    const expectedFields = ['cnicFront', 'cnicBack', 'licenseImage', 'vehicleDoc'];

    for (const field of expectedFields) {
        const fileArr = files[field];
        if (!fileArr || !fileArr[0]) continue; // Field not uploaded (optional)

        const filePath = fileArr[0].path;
        const result = validateFile(filePath, minSizeBytes);

        if (!result.valid) {
            return { field, reason: result.reason };
        }
    }

    return null;
}


module.exports = {
    detectFileType,
    validateFile,
    validateDriverDocuments
};
