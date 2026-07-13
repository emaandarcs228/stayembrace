// =====================================================================
// jobs/attendanceEscalationJob.js
//
// Time-based half of attendance dispute escalation. Unlike leave,
// attendance has no third-party "unreachable" event — a dispute is
// just student vs. warden — so the only trigger is a dispute sitting
// open too long. Threshold is 12h (not leave's 24h): an attendance
// dispute concerns TODAY's record, so waiting a full day risks a
// second day passing with unresolved/wrong data. 12h means a morning
// dispute surfaces by evening and vice versa.
//
// Idempotent via Attendance.escalationNotifiedAt, reset implicitly
// whenever a NEW dispute is raised (disputeRaisedAt changes but
// escalationNotifiedAt is only ever set by this job / cleared by
// resolution — see attendanceActions.resolveDispute, which doesn't
// need to touch it since a resolved dispute stops matching this
// job's query).
//
// UPDATED: Batch processing + isRunning flag + bulk updates to prevent
// event loop blocking. See inline comments.
// =====================================================================

const cron        = require('node-cron');
const Attendance  = require('../models/attendance');
const Notification = require('../models/notification');
const User         = require('../models/user');

const TIMEOUT_MS = 12 * 3600000; // 12 hours
const BATCH_SIZE = 50;

// Prevent overlapping runs
let isRunning = false;

async function escalateOverdueDisputes() {
    if (isRunning) {
        console.warn('[attendanceEscalationJob] already running, skipping this cycle');
        return { skipped: true };
    }

    isRunning = true;
    const startTime = Date.now();
    const results = { checked: 0, escalated: 0, errors: 0, batches: 0 };

    try {
        const adminUser = await User.findOne({ role: 'admin' }).lean();
        if (!adminUser) {
            console.warn('[attendanceEscalationJob] no admin user found — skipping run');
            return results;
        }

        let skip = 0;
        let hasMore = true;

        while (hasMore) {
            // Query: we use a dedicated field for dispute status for better performance.
            // If you don't have a separate boolean, we keep the regex, but consider adding an index.
            const overdue = await Attendance.find({
                isDisputed          : true,
                escalationNotifiedAt: null,
                disputeRaisedAt     : { $ne: null, $lte: new Date(Date.now() - TIMEOUT_MS) }
            })
                .populate({
                    path    : 'student',
                    populate: { path: 'user', select: '_id fullname' }
                })
                .skip(skip)
                .limit(BATCH_SIZE)
                .lean();

            if (overdue.length === 0) {
                hasMore = false;
                break;
            }

            results.checked += overdue.length;
            results.batches++;

            const bulkOps = [];
            const notificationsToInsert = [];

            for (const record of overdue) {
                try {
                    const studentName = record.student?.user?.fullname || 'A student';
                    const hoursWaiting = Math.floor((Date.now() - new Date(record.disputeRaisedAt).getTime()) / 3600000);
                    const dateStr = new Date(record.date).toLocaleDateString('en-PK', {
                        day: '2-digit', month: 'short', year: 'numeric'
                    });

                    notificationsToInsert.push({
                        title    : 'Attendance Dispute Pending 12+ Hours — Escalation',
                        message  : `${studentName}'s attendance dispute for ${dateStr} has been open for ${hoursWaiting}h with no decision. Manual review required.`,
                        recipient: adminUser._id,
                        category : 'Requests',
                        relatedTo: { model: 'Attendance', docId: record._id },
                        createdBy: adminUser._id,
                        priority : 'High'
                    });

                    bulkOps.push({
                        updateOne: {
                            filter: { _id: record._id },
                            update: { $set: { escalationNotifiedAt: new Date() } }
                        }
                    });

                    results.escalated++;

                } catch (perRecordErr) {
                    results.errors++;
                    console.error('[attendanceEscalationJob] failed for record', record._id, perRecordErr);
                }
            }

            if (bulkOps.length > 0) {
                await Attendance.bulkWrite(bulkOps);
            }
            if (notificationsToInsert.length > 0) {
                await Notification.insertMany(notificationsToInsert);
            }

            // Yield to event loop
            await new Promise(resolve => setImmediate(resolve));

            skip += BATCH_SIZE;
        }

        console.log(
            `[attendanceEscalationJob] completed in ${Date.now() - startTime}ms | ` +
            `batches=${results.batches} checked=${results.checked} ` +
            `escalated=${results.escalated} errors=${results.errors}`
        );

    } catch (err) {
        console.error('[attendanceEscalationJob] fatal error', err);
    } finally {
        isRunning = false;
    }

    return results;
}

function schedule() {
    cron.schedule('0 * * * *', () => {
        escalateOverdueDisputes();
    });
    console.log('[attendanceEscalationJob] scheduled — runs hourly');
}

module.exports = {
    schedule,
    escalateOverdueDisputes
};