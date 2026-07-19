/**
 * migrateRideStatuses.js
 *
 * One-off, manually-run migration: remaps existing CabBooking documents
 * from the old 7-value status vocabulary ('Pending', 'Reserved',
 * 'Awaiting Student', 'Confirmed', 'In Progress', 'Completed',
 * 'Cancelled') to the new 10-value vocabulary in utils/rideStatus.js, and
 * backfills a best-effort statusHistory from whatever timestamp fields
 * already exist on each document.
 *
 * Idempotent — bookings already on one of the new status values are left
 * untouched, and a document with a non-empty statusHistory is never
 * overwritten. Safe to run more than once.
 *
 * Not wired into server.js or package.json scripts on purpose — run
 * manually against a scratch/backed-up database:
 *   node scripts/migrateRideStatuses.js
 */
const mongoose = require('mongoose');
require('dotenv').config();
const CabBooking = require('../models/cabBooking');
const { STATUS_ORDER } = require('../utils/rideStatus');

const STATUS_MAP = {
    'Pending'          : 'Pending',
    'Reserved'         : 'Reserved by Driver',
    'Awaiting Student' : 'Waiting for Student Confirmation',
    'Confirmed'        : 'Ride Confirmed',
    // Best-effort: the old single "In Progress" stage can't tell us which
    // of the 4 new sub-stages an in-flight ride was actually at, so it
    // lands on the first one — an admin/warden can manually advance it
    // further if needed.
    'In Progress'      : 'Driver On the Way',
    'Completed'        : 'Ride Completed',
    'Cancelled'        : 'Cancelled'
};

async function run() {
    await mongoose.connect(process.env.MONGO_URI);

    const bookings = await CabBooking.find({}).lean();
    console.log(`Found ${bookings.length} cab booking(s) to inspect.`);

    let updated = 0, alreadyMigrated = 0, skipped = 0;

    for (const b of bookings) {
        // Already on the new vocabulary — nothing to remap.
        if (STATUS_ORDER.includes(b.status)) {
            alreadyMigrated++;
            continue;
        }

        const newStatus = STATUS_MAP[b.status];
        if (!newStatus) {
            console.warn(`Booking ${b._id}: unrecognized status "${b.status}" — skipping.`);
            skipped++;
            continue;
        }

        const update = { status: newStatus };

        // Backfill statusHistory only if it's empty — never overwrite
        // real history from a previous run or from post-migration activity.
        if (!b.statusHistory || b.statusHistory.length === 0) {
            const history = [];

            if (b.createdAt) {
                history.push({ status: 'Pending', changedBy: null, changedByRole: 'system', at: b.createdAt, note: 'Backfilled from createdAt' });
            }
            if (b.confirmedAt) {
                history.push({ status: 'Ride Confirmed', changedBy: null, changedByRole: 'system', at: b.confirmedAt, note: 'Backfilled from confirmedAt' });
            }
            if (b.status === 'In Progress') {
                // Exact historical sub-stage is unknown — stand in with the
                // first of the 4 new sub-stages, timestamped as close as we
                // can get from what already exists on the document.
                history.push({
                    status: 'Driver On the Way',
                    changedBy: null,
                    changedByRole: 'system',
                    at: b.confirmedAt || b.updatedAt || b.createdAt,
                    note: 'Backfilled — historical sub-stage detail unavailable (collapsed from legacy "In Progress")'
                });
            }
            if (b.completedAt) {
                history.push({ status: 'Ride Completed', changedBy: null, changedByRole: 'system', at: b.completedAt, note: 'Backfilled from completedAt' });
            }
            if (b.cancellation && b.cancellation.at) {
                history.push({
                    status: 'Cancelled',
                    changedBy: null,
                    changedByRole: b.cancellation.by || 'system',
                    at: b.cancellation.at,
                    note: b.cancellation.reason || 'Backfilled from cancellation.at'
                });
            }

            if (history.length > 0) update.statusHistory = history;
        }

        await CabBooking.updateOne({ _id: b._id }, { $set: update });
        updated++;
    }

    console.log(`Migration complete: ${updated} updated, ${alreadyMigrated} already on new vocabulary, ${skipped} skipped (unrecognized status).`);
    process.exit(0);
}

run().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
