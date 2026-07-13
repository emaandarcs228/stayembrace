// =====================================================================
// services/roomRequestActions.js
// =====================================================================

const RoomRequest  = require('../models/roomRequest');
const Allocation   = require('../models/allocation');
const Room         = require('../models/room');
const Student      = require('../models/student');
const Notification = require('../models/notification');

// ── Same occupancy-sync helper as roomController.js ─────────────────
async function syncRoomOccupancy(roomId) {
    const activeCount = await Allocation.countDocuments({ room: roomId, status: 'Active' });
    const room = await Room.findById(roomId);
    if (!room) return;

    room.occupiedBeds = activeCount;
    if (room.status !== 'Maintenance') {
        room.status = activeCount >= room.capacity ? 'Occupied' : 'Available';
    }
    await room.save();
}

async function notifyStudent(rr, actingUserId, { title, message, priority }) {
    try {
        const student = await Student.findById(rr.student).populate('user', '_id');
        if (!student || !student.user) return;
        await Notification.create({
            title,
            message,
            recipient: student.user._id,
            category : 'Requests',
            relatedTo: { model: 'RoomRequest', docId: rr._id },
            createdBy: actingUserId,
            priority : priority || 'Medium'
        });
    } catch (err) {
        console.error('notifyStudent (roomRequestActions):', err);
    }
}

// ═══════════════════════════════════════════════════════════════════
// APPROVE TRANSFER — admin picks the new room/bed, request finalized
// ═══════════════════════════════════════════════════════════════════
exports.adminApproveTransfer = async function (id, adminUser, { newRoomId, newBedNo, note }) {
    const rr = await RoomRequest.findById(id);
    if (!rr) return { ok: false, error: 'Request not found.' };
    if (rr.requestType !== 'Transfer') return { ok: false, error: 'This is not a transfer request.' };
    if (rr.status === 'Approved' || rr.status === 'Rejected') return { ok: false, error: 'Request already finalized.' };
    if (!newRoomId || !newBedNo) return { ok: false, error: 'New room and bed are required.' };

    const oldAlloc = await Allocation.findOne({ student: rr.student, status: 'Active' });
    if (!oldAlloc) return { ok: false, error: 'Student has no active room allocation to transfer from.' };

    const newRoom = await Room.findById(newRoomId);
    if (!newRoom) return { ok: false, error: 'New room not found.' };

    // FIX: Phase 2 introduced Guest rooms, which must never be a valid
    // transfer destination for a student — roomController.transferStudent
    // already guards this, but this parallel path was missing the same
    // check, so an admin could accidentally move a student into a Guest
    // room via the Room Requests approval flow.
    if (newRoom.roomCategory === 'Guest') return { ok: false, error: 'Cannot transfer a student to a Guest room.' };

    if (newRoom.status === 'Maintenance') return { ok: false, error: 'Cannot transfer to a room under maintenance.' };
    if (newRoom.occupiedBeds >= newRoom.capacity) return { ok: false, error: 'New room is at full capacity.' };

    const bedTaken = await Allocation.findOne({
        room  : newRoomId,
        bedNo : Number(newBedNo),
        status: 'Active'
    });
    if (bedTaken) return { ok: false, error: `Bed ${newBedNo} is already occupied in the new room.` };

    const oldRoomId = oldAlloc.room;

    oldAlloc.status      = 'Transferred';
    oldAlloc.vacatedDate = new Date();
    oldAlloc.remarks     = (oldAlloc.remarks ? oldAlloc.remarks + ' | ' : '') + 'Transferred via Room Request: ' + (note || '');
    await oldAlloc.save();

    const newAlloc = await Allocation.create({
        student       : rr.student,
        room          : newRoomId,
        bedNo         : Number(newBedNo),
        allocatedBy   : adminUser._id,
        allocationDate: new Date(),
        status        : 'Active',
        remarks       : note || ''
    });

    await Student.findByIdAndUpdate(rr.student, {
        room             : newRoomId,
        currentAllocation: newAlloc._id
    });

    await syncRoomOccupancy(oldRoomId);
    await syncRoomOccupancy(newRoomId);

    rr.status        = 'Approved';
    rr.newRoom       = newRoomId;
    rr.newBedNo      = Number(newBedNo);
    rr.adminApproval = { status: 'Approved', note: note || '', by: adminUser._id, at: new Date() };
    await rr.save();

    await notifyStudent(rr, adminUser._id, {
        title   : 'Room Transfer Approved',
        message : `Your room transfer request has been approved. You have been moved to room ${newRoom.roomNo} (Bed ${newBedNo}).`,
        priority: 'High'
    });

    return { ok: true, request: rr };
};

// ═══════════════════════════════════════════════════════════════════
// APPROVE VACATE — closes out the student's active allocation
// ═══════════════════════════════════════════════════════════════════
exports.adminApproveVacate = async function (id, adminUser, { note }) {
    const rr = await RoomRequest.findById(id);
    if (!rr) return { ok: false, error: 'Request not found.' };
    if (rr.requestType !== 'Vacate') return { ok: false, error: 'This is not a vacate request.' };
    if (rr.status === 'Approved' || rr.status === 'Rejected') return { ok: false, error: 'Request already finalized.' };

    const alloc = await Allocation.findOne({ student: rr.student, status: 'Active' });
    if (!alloc) return { ok: false, error: 'Student has no active room allocation to vacate.' };

    const roomId = alloc.room;

    alloc.status      = 'Vacated';
    alloc.vacatedDate = new Date();
    await alloc.save();

    await Student.findByIdAndUpdate(rr.student, { room: null, currentAllocation: null });
    await syncRoomOccupancy(roomId);

    rr.status        = 'Approved';
    rr.adminApproval = { status: 'Approved', note: note || '', by: adminUser._id, at: new Date() };
    await rr.save();

    await notifyStudent(rr, adminUser._id, {
        title   : 'Vacate Request Approved',
        message : 'Your request to vacate your room has been approved. Please complete check-out with the admin office.',
        priority: 'High'
    });

    return { ok: true, request: rr };
};

// ═══════════════════════════════════════════════════════════════════
// REJECT (admin stage) — works for either request type
// ═══════════════════════════════════════════════════════════════════
exports.adminReject = async function (id, adminUser, { reason }) {
    const rr = await RoomRequest.findById(id);
    if (!rr) return { ok: false, error: 'Request not found.' };
    if (rr.status === 'Approved' || rr.status === 'Rejected') return { ok: false, error: 'Request already finalized.' };

    rr.status        = 'Rejected';
    rr.adminApproval = { status: 'Rejected', note: reason || '', by: adminUser._id, at: new Date() };
    await rr.save();

    await notifyStudent(rr, adminUser._id, {
        title   : 'Room Request Rejected',
        message : `Your ${rr.requestType} request has been rejected by admin. Reason: ${reason || 'No reason provided.'}`,
        priority: 'Medium'
    });

    return { ok: true, request: rr };
};