// =====================================================================
// services/guestBookingActions.js
//
// Admin's approve/reject logic for GuestRoomBooking, plus the student's
// own cancel action and a helper for the "Upcoming Bookings" list shown
// in the admin Guest Rooms view. Deliberately does NOT touch Allocation
// or Room.occupiedBeds/status — this is an informational booking record
// only, exactly as discussed: real occupancy-locking for guest rooms can
// be added later if needed, but for now this keeps Room Management's
// tested occupancy math completely untouched.
//
// approveBooking / rejectBooking / getActiveBookingsForRoom are called
// by operationController.js. cancelBooking is called by studentController.js.
// =====================================================================

const GuestRoomBooking = require('../models/guestRoomBooking');
const Room             = require('../models/room');
const Student          = require('../models/student');
const Notification     = require('../models/notification');
const Due              = require('../models/due');

async function notifyStudent(booking, actingUserId, { title, message, priority, category }) {
    try {
        const student = await Student.findById(booking.student).populate('user', '_id');
        if (!student || !student.user) return;
        await Notification.create({
            title,
            message,
            recipient: student.user._id,
            category : category || 'Requests',
            relatedTo: { model: 'GuestRoomBooking', docId: booking._id },
            createdBy: actingUserId,
            priority : priority || 'Medium'
        });
    } catch (err) {
        console.error('notifyStudent (guestBookingActions):', err);
    }
}

// Finds any OTHER Approved booking for the same room whose date range
// overlaps the given range. Used both to block a conflicting approval
// and to warn admin before they even attempt one.
// Finds any conflicting booking for the same room whose date range
// overlaps the given range. `statuses` controls which booking states
// count as a conflict:
//   - Approval time (approveBooking): only 'Approved' bookings block —
//     an admin approving one Pending request shouldn't be blocked by
//     some other unrelated Pending request that was never approved.
//   - Submission time (student's postGuestBookingRequest) and the
//     availability-list endpoint: both 'Pending' AND 'Approved' block —
//     a student shouldn't be able to submit (or even see as available)
//     a second overlapping request while a first one is still awaiting
//     admin's decision, since it may get approved later.
async function findOverlappingBooking(roomId, fromDate, toDate, excludeBookingId, statuses = ['Approved']) {
    return GuestRoomBooking.findOne({
        room: roomId,
        status: { $in: statuses },
        _id: { $ne: excludeBookingId },
        fromDate: { $lt: toDate },
        toDate: { $gt: fromDate }
    }).populate('student');
}

// Thin wrapper for submission-time use — checks both Pending and
// Approved bookings, so students get blocked immediately instead of
// only discovering the conflict when admin reviews it.
async function findConflictingBooking(roomId, fromDate, toDate) {
    return findOverlappingBooking(roomId, fromDate, toDate, null, ['Pending', 'Approved']);
}

// Returns every Guest room that has NO Pending/Approved booking
// overlapping the given date range — powers the student-facing
// "Guest Room" dropdown so it only ever offers rooms actually free
// for the dates they've picked, instead of every Guest room that
// exists regardless of booking state.
async function getAvailableGuestRooms(fromDate, toDate) {
    const allGuestRooms = await Room.find({ roomCategory: 'Guest' })
        .select('roomNo block floor feePerNight capacity status')
        .sort({ roomNo: 1 })
        .lean();

    const conflictingBookings = await GuestRoomBooking.find({
        status  : { $in: ['Pending', 'Approved'] },
        fromDate: { $lt: toDate },
        toDate  : { $gt: fromDate }
    }).select('room').lean();

    const bookedRoomIds = new Set(conflictingBookings.map(b => String(b.room)));

    return allGuestRooms.filter(r => !bookedRoomIds.has(String(r._id)));
}

// ── Guest room status sync ────────────────────────────────────────────
// Guest Room.status was previously 100% manual — approving/rejecting/
// cancelling a booking never touched it, so a room showing "Available"
// could actually be mid-stay for an approved guest booking. This helper
// checks whether *today* falls inside any Approved booking's date range
// for the room and sets status accordingly. Only ever flips between
// Available <-> Occupied — never touches a room an admin has manually
// set to Maintenance, since that's an explicit admin decision that
// shouldn't be silently overridden by booking dates.
async function syncGuestRoomStatus(roomId) {
    try {
        const room = await Room.findById(roomId);
        if (!room || room.roomCategory !== 'Guest') return;
        if (room.status === 'Maintenance') return;

        const now = new Date();
        const activeBooking = await GuestRoomBooking.findOne({
            room: roomId,
            status: 'Approved',
            fromDate: { $lte: now },
            toDate: { $gte: now }
        });

        const newStatus = activeBooking ? 'Occupied' : 'Available';
        if (room.status !== newStatus) {
            room.status = newStatus;
            await room.save();
        }
    } catch (err) {
        console.error('syncGuestRoomStatus error:', err);
    }
}

exports.approveBooking = async function (id, adminUser, { note }) {
    const booking = await GuestRoomBooking.findById(id).populate('room', 'roomNo');
    if (!booking) return { ok: false, error: 'Booking not found.' };
    if (booking.status !== 'Pending') return { ok: false, error: 'This booking has already been decided.' };

    // Defensive guard — room must still exist and still be a Guest room.
    // (Admin could theoretically have edited/deleted it between the
    // student's request and this approval.)
    const room = booking.room;
    if (!room) return { ok: false, error: 'The requested room no longer exists.' };

    const freshRoom = await Room.findById(room._id);
    if (!freshRoom || freshRoom.roomCategory !== 'Guest') {
        return { ok: false, error: 'This room is no longer available as a Guest room.' };
    }

    // Prevent double-booking: block approval if this room already has an
    // Approved booking whose dates overlap this one.
    const overlap = await findOverlappingBooking(room._id, booking.fromDate, booking.toDate, booking._id);
    if (overlap) {
        const from = new Date(overlap.fromDate).toLocaleDateString('en-PK', { day: '2-digit', month: 'short' });
        const to   = new Date(overlap.toDate).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' });
        return { ok: false, error: `Room ${room.roomNo} is already booked for an overlapping period (${from} – ${to}).` };
    }

    booking.status        = 'Approved';
    booking.adminDecision = { note: note || '', by: adminUser._id, at: new Date() };
    await booking.save();

    // ── Create the guest-room Due, reusing the existing Due→Payment
    // pipeline the student already sees on Pending Payments. Amount is
    // nights × room.feePerNight (minimum 1 night, in case of same-day
    // edge cases).
    const nights = Math.max(
        1,
        Math.ceil((new Date(booking.toDate) - new Date(booking.fromDate)) / (1000 * 60 * 60 * 24))
    );
    const amount = nights * (freshRoom.feePerNight || 0);

    let due = null;
    try {
        due = await Due.create({
            student    : booking.student,
            dueType    : 'Guest Room',
            amount,
            dueDate    : booking.fromDate,
            status     : 'Pending',
            description: `Guest room booking — Room ${room.roomNo} (${new Date(booking.fromDate).toLocaleDateString('en-PK', { day:'2-digit', month:'short' })} – ${new Date(booking.toDate).toLocaleDateString('en-PK', { day:'2-digit', month:'short', year:'numeric' })})`,
            sourceType : 'GuestRoomBooking',
            sourceRef  : booking._id
        });
    } catch (err) {
        console.error('Guest room Due creation error:', err);
    }

    // ── Sync room status now that a booking is Approved — flips to
    // Occupied if the booking's date range covers today.
    await syncGuestRoomStatus(room._id);

    await notifyStudent(booking, adminUser._id, {
        title   : 'Guest Room Booking Approved',
        message : `Your guest room booking (Room ${room.roomNo}, ${new Date(booking.fromDate).toLocaleDateString('en-PK', { day:'2-digit', month:'short' })} – ${new Date(booking.toDate).toLocaleDateString('en-PK', { day:'2-digit', month:'short', year:'numeric' })}) has been approved.`,
        priority: 'High'
    });

    if (due) {
        await notifyStudent(booking, adminUser._id, {
            title   : 'Guest Room Payment Due',
            message : `A payment of Rs ${amount.toLocaleString()} is due for your guest room booking (Room ${room.roomNo}). Please pay via Pending Payments.`,
            priority: 'High',
            category: 'Payments'
        });
    }

    return { ok: true, booking, due };
};

exports.rejectBooking = async function (id, adminUser, { reason }) {
    const booking = await GuestRoomBooking.findById(id);
    if (!booking) return { ok: false, error: 'Booking not found.' };
    if (booking.status !== 'Pending') return { ok: false, error: 'This booking has already been decided.' };

    booking.status        = 'Rejected';
    booking.adminDecision = { note: reason || '', by: adminUser._id, at: new Date() };
    await booking.save();

    await notifyStudent(booking, adminUser._id, {
        title   : 'Guest Room Booking Rejected',
        message : `Your guest room booking request has been rejected. Reason: ${reason || 'No reason provided.'}`,
        priority: 'Medium'
    });

    return { ok: true, booking };
};

// Student-initiated cancel — only allowed while still Pending. If a
// booking was already Approved, cancelling it here just marks the
// record Cancelled (admin still sees the history); it does NOT touch
// Room.status, consistent with the "informational only" design.
exports.cancelBooking = async function (id, studentId) {
    const booking = await GuestRoomBooking.findById(id);
    if (!booking) return { ok: false, error: 'Booking not found.' };
    if (String(booking.student) !== String(studentId)) {
        return { ok: false, error: 'You are not authorized to cancel this booking.' };
    }
    if (booking.status !== 'Pending') {
        return { ok: false, error: 'Only pending bookings can be cancelled.' };
    }

    booking.status = 'Cancelled';
    await booking.save();

    return { ok: true, booking };
};

// Returns a room's active/upcoming Approved bookings (toDate in the
// future), for the "Upcoming Bookings" panel in the admin Guest Rooms
// view — lets admin see at a glance when a room is actually spoken for,
// since Room.status itself is manual and won't reflect this.
exports.getActiveBookingsForRoom = async function (roomId) {
    return GuestRoomBooking.find({
        room: roomId,
        status: 'Approved',
        toDate: { $gte: new Date() }
    })
    .populate({ path: 'student', populate: { path: 'user', select: 'fullname userId' } })
    .sort({ fromDate: 1 });
};

exports.findOverlappingBooking   = findOverlappingBooking;
exports.findConflictingBooking   = findConflictingBooking;
exports.getAvailableGuestRooms   = getAvailableGuestRooms;
exports.syncGuestRoomStatus      = syncGuestRoomStatus;

// Re-syncs every Guest room's status against today's date. Intended to
// be called once daily by a cron job (mirroring the existing
// hostelFeeJob.js pattern) so a room correctly flips back to Available
// the morning after checkout even with no admin action — approveBooking
// only syncs the one room it just touched, so without this a room
// could stay "Occupied" indefinitely after a guest's stay ends.
exports.syncAllGuestRoomStatuses = async function () {
    const guestRooms = await Room.find({ roomCategory: 'Guest' }).select('_id');
    for (const r of guestRooms) {
        await syncGuestRoomStatus(r._id);
    }
};