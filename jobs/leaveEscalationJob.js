// =====================================================================
// jobs/leaveEscalationJob.js
//
// Catches the "timeout" half of leave escalation: a leave request that
// nobody has acted on for 24+ hours. Unlike the guardian-unreachable
// case (an event, handled immediately in services/leaveActions.js),
// nothing "happens" at the 24h mark — so this has to be checked
// periodically instead of triggered.
//
// Runs hourly rather than daily (unlike jobs/hostelFeeJob.js) because
// this is a timeout, not a calendar-day rollover — checking only once
// a day could mean a request sits escalated-but-unnotified for up to
// 23 extra hours after crossing the 24h mark.
//
// Idempotent via LeaveRequest.escalationNotifiedAt — shared with the
// guardian-unreachable path in leaveActions.js, so a leave that was
// already escalated for one reason is never double-notified for the
// other.
//
// UPDATED: Batch processing + isRunning flag + bulk updates to prevent
// event loop blocking. See inline comments.
// =====================================================================

const cron          = require('node-cron');
const LeaveRequest  = require('../models/leave');
const Notification  = require('../models/notification');
const User          = require('../models/user');

const TIMEOUT_MS = 24 * 3600000; // 24 hours
const BATCH_SIZE = 50;           // process 50 records at a time

// Prevent overlapping runs
let isRunning = false;

async function escalateOverdueLeaveRequests() {
    if (isRunning) {
        console.warn('[leaveEscalationJob] already running, skipping this cycle');
        return { skipped: true };
    }

    isRunning = true;
    const startTime = Date.now();
    const results = { checked: 0, escalated: 0, errors: 0, batches: 0 };

    try {
        const adminUser = await User.findOne({ role: 'admin' }).lean();
        if (!adminUser) {
            console.warn('[leaveEscalationJob] no admin user found — skipping run');
            return results;
        }

        // Paginate through all overdue requests
        let skip = 0;
        let hasMore = true;

        while (hasMore) {
            const overdue = await LeaveRequest.find({
                status              : 'Pending',
                escalationNotifiedAt: null,
                createdAt           : { $lte: new Date(Date.now() - TIMEOUT_MS) }
            })
                .populate({
                    path    : 'student',
                    populate: { path: 'user', select: '_id fullname' }
                })
                .skip(skip)
                .limit(BATCH_SIZE)
                .lean(); // Use lean for read-only processing

            if (overdue.length === 0) {
                hasMore = false;
                break;
            }

            results.checked += overdue.length;
            results.batches++;

            // Prepare bulk write operations for escalation updates
            const bulkOps = [];
            const notificationsToInsert = [];

            for (const leave of overdue) {
                try {
                    const studentName = leave.student?.user?.fullname || 'A student';
                    const hoursWaiting = Math.floor((Date.now() - new Date(leave.createdAt).getTime()) / 3600000);

                    // Notification
                    notificationsToInsert.push({
                        title    : 'Leave Request Pending 24+ Hours — Escalation',
                        message  : `${studentName}'s ${leave.leaveType} leave request has been pending for ${hoursWaiting}h with no decision. Manual review required.`,
                        recipient: adminUser._id,
                        category : 'Requests',
                        relatedTo: { model: 'LeaveRequest', docId: leave._id },
                        createdBy: adminUser._id,
                        priority : 'High'
                    });

                    // Prepare update for this leave
                    bulkOps.push({
                        updateOne: {
                            filter: { _id: leave._id },
                            update: { $set: { escalationNotifiedAt: new Date() } }
                        }
                    });

                    results.escalated++;

                } catch (perLeaveErr) {
                    results.errors++;
                    console.error('[leaveEscalationJob] failed for leave', leave._id, perLeaveErr);
                }
            }

            // Execute bulk update and notification creation
            if (bulkOps.length > 0) {
                await LeaveRequest.bulkWrite(bulkOps);
            }
            if (notificationsToInsert.length > 0) {
                await Notification.insertMany(notificationsToInsert);
            }

            // Yield to event loop after each batch
            await new Promise(resolve => setImmediate(resolve));

            skip += BATCH_SIZE;
        }

        console.log(
            `[leaveEscalationJob] completed in ${Date.now() - startTime}ms | ` +
            `batches=${results.batches} checked=${results.checked} ` +
            `escalated=${results.escalated} errors=${results.errors}`
        );

    } catch (err) {
        console.error('[leaveEscalationJob] fatal error', err);
    } finally {
        isRunning = false;
    }

    return results;
}

function schedule() {
    // Every hour, on the hour.
    cron.schedule('0 * * * *', () => {
        escalateOverdueLeaveRequests();
    });
    console.log('[leaveEscalationJob] scheduled — runs hourly');
}

module.exports = {
    schedule,
    escalateOverdueLeaveRequests // exported for manual triggering / testing
};