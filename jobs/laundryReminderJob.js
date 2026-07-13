// =====================================================================
// jobs/laundryReminderJob.js
//
// Weekly reminder: free laundry pickup happens every Monday, so this
// notifies all students the day before (Sunday evening) so they don't
// miss opting in / preparing their laundry.
//
// Pure notification job — does NOT touch LaundryRequest, Due, or any
// other laundry backend logic. It only creates a broadcast
// Notification, same shape as adminController.sendNotification's
// 'all'/'students' broadcasts.
//
// Idempotent per week via a dedupe check against Notification title +
// week key so a server restart on Sunday doesn't send duplicates.
// =====================================================================

const cron         = require('node-cron');
const Notification = require('../models/notification');
const User         = require('../models/user');

function getWeekKey(date = new Date()) {
    const d    = new Date(date);
    const day  = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const mon  = new Date(d.setDate(diff));
    const yr   = mon.getFullYear();
    const wk   = Math.ceil(((mon - new Date(yr, 0, 1)) / 86400000 + 1) / 7);
    return `${yr}-W${String(wk).padStart(2, '0')}`;
}

async function sendLaundryPickupReminder() {
    try {
        // The upcoming Monday's week key — since this runs Sunday
        // evening, "next Monday" is just the start of the *next*
        // calendar week relative to today.
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const weekKey = getWeekKey(tomorrow);

        const title = 'Laundry Pickup Reminder';

        // Idempotency guard — skip if this week's reminder already went out
        const alreadySent = await Notification.findOne({
            title,
            target : { $in: ['All', 'Students'] },
            message: { $regex: weekKey }
        }).lean();

        if (alreadySent) {
            console.log(`[laundryReminderJob] reminder for ${weekKey} already sent — skipping`);
            return { skipped: true };
        }

        const adminUser = await User.findOne({ role: 'admin' }).lean();
        if (!adminUser) {
            console.warn('[laundryReminderJob] no admin user found — skipping run');
            return { skipped: true };
        }

        await Notification.create({
            title,
            message  : `Reminder: your free weekly laundry pickup is tomorrow (Monday). Please have your laundry ready for collection. [${weekKey}]`,
            target   : 'Students',
            category : 'Announcements',
            priority : 'Medium',
            createdBy: adminUser._id
        });

        console.log(`[laundryReminderJob] reminder sent for week ${weekKey}`);
        return { sent: true, weekKey };

    } catch (err) {
        console.error('[laundryReminderJob] fatal error', err);
        return { error: true };
    }
}

function schedule() {
    // Every Sunday at 6:00 PM — one day before Monday's pickup.
    cron.schedule('0 18 * * 0', () => {
        sendLaundryPickupReminder();
    });
    console.log('[laundryReminderJob] scheduled — runs every Sunday at 6 PM');
}

module.exports = {
    schedule,
    sendLaundryPickupReminder // exported for manual triggering / testing
};