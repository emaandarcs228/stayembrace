/**
 * reservationTimeoutJob.js
 *
 * Runs every 30 seconds. Finds CabBooking records that are in
 * 'Reserved by Driver' or 'Waiting for Student Confirmation' status with
 * an expired reservationExpiresAt, and releases them back to 'Pending' so
 * other drivers can pick them up.
 *
 * Also sends a notification to the student when their ride request
 * reservation times out, and to the driver who lost the reservation.
 */
const CabBooking    = require('../models/cabBooking');
const Notification  = require('../models/notification');
const Student       = require('../models/student');

async function releaseExpiredReservations() {
    try {
        const now = new Date();

        // ── Find all bookings whose reservation has expired ──────────
        const expired = await CabBooking.find({
            reservationExpiresAt: { $lte: now },
            status: { $in: ['Reserved by Driver', 'Waiting for Student Confirmation'] }
        }).populate({
            path: 'reservedBy',
            select: 'fullname _id'
        }).lean();

        if (expired.length === 0) return;

        const expiredIds = expired.map(b => b._id);

        // ── Atomically release them back to Pending ─────────────────
        const releaseResult = await CabBooking.updateMany(
            {
                _id: { $in: expiredIds },
                status: { $in: ['Reserved by Driver', 'Waiting for Student Confirmation'] },
                reservationExpiresAt: { $lte: new Date() }
            },
            {
                $set: {
                    status                  : 'Pending',
                    reservedBy              : null,
                    reservedAt              : null,
                    reservationExpiresAt    : null,
                    'quote.fare'            : null,
                    'quote.eta'             : '',
                    'quote.comments'        : '',
                    'quote.submittedAt'     : null,
                    'studentDecision.status': 'expired',
                    'studentDecision.decidedAt': new Date()
                },
                $push: {
                    statusHistory: { status: 'Pending', changedBy: null, changedByRole: 'system', at: now, note: 'Reservation expired' }
                }
            }
        );

        // ── Notify each student that their request is available again,
        // and notify the driver who lost the reservation ──
        for (const booking of expired) {
            try {
                const studentRec = await Student.findById(booking.student)
                    .populate('user', '_id fullname')
                    .lean();

                if (studentRec && studentRec.user) {
                    const driverName = booking.reservedBy?.fullname || 'A driver';
                    await Notification.create({
                        title     : 'Ride Request — Driver Timed Out',
                        message   : `${driverName} did not complete the booking in time. Your ride request from "${booking.pickupLocation}" to "${booking.dropoffLocation}" is now open for other drivers.`,
                        recipient : studentRec.user._id,
                        category  : 'Requests',
                        relatedTo : { model: 'CabBooking', docId: booking._id },
                        createdBy : studentRec.user._id,
                        priority  : 'Medium'
                    });
                }
            } catch (notifErr) {
                console.error('reservationTimeoutJob: Notification error for', booking._id, notifErr.message);
            }

            try {
                if (booking.reservedBy) {
                    const hadQuoted = booking.status === 'Waiting for Student Confirmation';
                    await Notification.create({
                        title     : 'Reservation Expired',
                        message   : hadQuoted
                            ? `The student did not respond in time to your fare quote for the ride from "${booking.pickupLocation}" to "${booking.dropoffLocation}". The request has been released and is open for other drivers.`
                            : `Your 2-minute reservation window for the ride from "${booking.pickupLocation}" to "${booking.dropoffLocation}" expired before you submitted a fare quote. The request has been released and is open for other drivers.`,
                        recipient : booking.reservedBy._id,
                        category  : 'Requests',
                        relatedTo : { model: 'CabBooking', docId: booking._id },
                        createdBy : booking.reservedBy._id,
                        priority  : 'Medium'
                    });
                }
            } catch (notifErr) {
                console.error('reservationTimeoutJob: Driver notification error for', booking._id, notifErr.message);
            }
        }

        console.log(`⏰ Released ${releaseResult.modifiedCount} expired reservation(s).`);
    } catch (err) {
        console.error('reservationTimeoutJob Error:', err.message);
    }
}

module.exports = releaseExpiredReservations;
