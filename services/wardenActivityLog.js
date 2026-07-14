// =====================================================================
// services/wardenActivityLog.js
// Logs warden actions to the WardenActivityLog collection for audit
// and admin oversight. Each call creates a single document recording
// who did what, when, and to which target entity.
// =====================================================================

const WardenActivityLog = require('../models/wardenActivityLog');

/**
 * Log a warden action.
 *
 * @param {Object}   warden        - Mongoose User doc (warden who acted)
 * @param {string}   action        - One of the WardenActivityLog schema enum values
 * @param {string}   description   - Human-readable summary
 * @param {Object}   [opts]        - Optional metadata
 * @param {string}   [opts.targetModel]  - Mongoose model name of the target entity
 * @param {ObjectId} [opts.targetId]     - _id of the target entity
 * @param {ObjectId} [opts.relatedStudent]   - User._id of related student
 * @param {string}   [opts.relatedStudentName]  - Fullname of related student
 * @param {string}   [opts.relatedStudentUserId] - userId of related student
 * @param {Object}   [opts.details]        - Extra JSON payload
 * @param {string}   [opts.ip]             - Request IP
 */
async function logActivity(warden, action, description, opts = {}) {
    try {
        const entry = {
            warden        : warden._id,
            wardenName    : warden.fullname || 'Unknown',
            wardenUserId  : warden.userId   || '—',
            action,
            description   : description || '',
            targetModel   : opts.targetModel   || null,
            targetId      : opts.targetId      || null,
            relatedStudent      : opts.relatedStudent      || null,
            relatedStudentName  : opts.relatedStudentName  || null,
            relatedStudentUserId: opts.relatedStudentUserId || null,
            details       : opts.details || {},
            ip            : opts.ip      || null
        };

        await WardenActivityLog.create(entry);
    } catch (err) {
        // Never let a logging failure crash the main request
        console.error('wardenActivityLog Error:', err);
    }
}

/**
 * Convenience: build a description from a student's fullname and userId.
 */
function studentDesc(studentUser) {
    if (!studentUser) return 'Unknown student';
    const name = studentUser.fullname || 'Unknown';
    const uid  = studentUser.userId   || '—';
    return `${name} (${uid})`;
}

module.exports = { logActivity, studentDesc };