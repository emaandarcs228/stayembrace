// =====================================================================
// roomController.js
// Handles: Room CRUD, Allocation, Vacate, Transfer, Occupants JSON
//
// UPDATED (Phase 2 — Guest Room Category):
// Rooms are now split by `roomCategory` ('Student' | 'Guest').
// - Student rooms: unchanged behavior — full allocation/vacate/transfer
//   flow via the Allocation model, monthlyFee billing.
// - Guest rooms: NOT linked to the Allocation model at all (Allocation
//   requires a Student doc, which a visitor/guest is not). Guest rooms
//   are booked as a WHOLE room (private, max `capacity` people per
//   booking) — no per-bed tracking. Priced with `feePerNight` instead
//   of `monthlyFee`. Occupancy/status for Guest rooms is set manually
//   by admin for now (Phase 3 — visitor requests — will decide how
//   bookings flip a Guest room's status automatically, if at all).
// =====================================================================

const Room       = require('../models/room');
const Allocation = require('../models/allocation');
const Student    = require('../models/student');
const User       = require('../models/user');
const Due          = require('../models/due');
const Notification = require('../models/notification');
const { billingPeriodFor } = require('../jobs/hostelFeeJob');
const guestBookingActions = require('../services/guestBookingActions');
const GuestRoomBooking = require('../models/guestRoomBooking');
const { getSidebarBadges } = require('../utils/sidebarBadges');

function timeAgo(date) {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1)  return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return hrs + 'h ago';
    const days = Math.floor(hrs / 24);
    if (days < 7)  return days + 'd ago';
    return new Date(date).toLocaleDateString();
}

// ══════════════════════════════════════
// HELPER — recompute room occupiedBeds
// and auto-flip status Available ↔ Occupied
// Student rooms only — Guest rooms never call this.
// ══════════════════════════════════════
async function syncRoomOccupancy(roomId) {
    const activeCount = await Allocation.countDocuments({
        room   : roomId,
        status : 'Active'
    });

    const room = await Room.findById(roomId);
    if (!room) return;

    room.occupiedBeds = activeCount;

    // Auto-flip status only if it is not Maintenance
    if (room.status !== 'Maintenance') {
        room.status = activeCount >= room.capacity ? 'Occupied' : 'Available';
    }

    await room.save();
}


// ══════════════════════════════════════
// GET ROOM MANAGEMENT PAGE
// GET /admin/rooms
// ══════════════════════════════════════
exports.getRoomManagement = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'admin')
            return res.status(403).send('Access Denied');

        // All rooms — then split by category. Student-facing tabs/stats
        // (Overview, All Rooms, Available, Occupied, Maintenance,
        // Allocations) keep working exactly as before, scoped to
        // Student rooms only. Guest rooms get their own separate tab.
        const allRoomsRaw = await Room.find().sort({ block: 1, floor: 1, roomNo: 1 });
        const rooms      = allRoomsRaw.filter(r => r.roomCategory !== 'Guest');
        const guestRooms = allRoomsRaw.filter(r => r.roomCategory === 'Guest');

        // All allocations — populate student→user and room and allocatedBy
        // (Allocation only ever references Student rooms, so no filtering
        // needed here — Guest rooms can never appear in this collection.)
        const allocations = await Allocation.find()
            .populate({
                path    : 'student',
                populate: { path: 'user', select: 'fullname userId email phoneNumber' }
            })
            .populate('room',        'roomNo block floor')
            .populate('allocatedBy', 'fullname')
            .sort({ createdAt: -1 });

        // Recent 5 allocations for the overview panel
        const recentAllocations = allocations.slice(0, 5);

        // Unallocated students — approved students with no active allocation
        const activeAllocStudentIds = await Allocation.distinct('student', { status: 'Active' });

        const unallocatedStudents = await Student.find({
            _id: { $nin: activeAllocStudentIds }
        }).populate({
            path  : 'user',
            // FIX: added phoneNumber and email so they appear in the table
            select: 'fullname userId email phoneNumber status',
            match : { status: 'approved' }   // only approved users
        });

        // Filter out students whose user didn't match (not approved)
        const filteredUnallocated = unallocatedStudents.filter(s => s.user);

        // Stats — Student rooms only, exactly as before
        const totalRooms       = rooms.length;
        const availableRooms   = rooms.filter(r => r.status === 'Available').length;
        const occupiedRooms    = rooms.filter(r => r.status === 'Occupied').length;
        const maintenanceRooms = rooms.filter(r => r.status === 'Maintenance').length;
        const totalBeds        = rooms.reduce((sum, r) => sum + r.capacity, 0);
        const occupiedBeds     = rooms.reduce((sum, r) => sum + r.occupiedBeds, 0);
        const freeBeds         = totalBeds - occupiedBeds;

        // Guest room stats (own tab, own counters — not mixed into
        // the Student stat cards above)
        const totalGuestRooms       = guestRooms.length;
        const availableGuestRooms   = guestRooms.filter(r => r.status === 'Available').length;
        const occupiedGuestRooms    = guestRooms.filter(r => r.status === 'Occupied').length;
        const maintenanceGuestRooms = guestRooms.filter(r => r.status === 'Maintenance').length;

        // ── Upcoming bookings for the Guest Rooms table ──────────────────
        // Room.status only reflects TODAY (see syncGuestRoomStatus in
        // guestBookingActions.js) — it has no concept of "booked starting
        // in 3 days". Previously the only way to see a room's future
        // bookings was to click View (which fires a separate per-room
        // AJAX call to /admin/rooms/:roomId/guest-bookings). That hid
        // real information behind an extra click, and made the summary
        // stat cards misleading (a room "Available" today could still be
        // fully booked for next week).
        //
        // Fetch every guest room's upcoming (Approved, not-yet-ended)
        // booking in ONE query here, grouped by room, so the table can
        // render this inline without touching syncGuestRoomStatus or the
        // existing modal/AJAX endpoint at all.
        const guestRoomIds = guestRooms.map(r => r._id);

        const upcomingGuestBookingsRaw = guestRoomIds.length
            ? await GuestRoomBooking.find({
                  room  : { $in: guestRoomIds },
                  status: 'Approved',
                  toDate: { $gte: new Date() }
              })
              .populate({ path: 'student', populate: { path: 'user', select: 'fullname' } })
              .sort({ fromDate: 1 })
              .lean()
            : [];

        const guestBookingsByRoom = {};
        upcomingGuestBookingsRaw.forEach(b => {
            const rid = String(b.room);
            if (!guestBookingsByRoom[rid]) guestBookingsByRoom[rid] = [];
            guestBookingsByRoom[rid].push({
                studentName: b.student && b.student.user ? b.student.user.fullname : 'Unknown',
                fromDate   : new Date(b.fromDate).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' }),
                toDate     : new Date(b.toDate).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' })
            });
        });

        // Count of guest rooms that have at least one upcoming booking —
        // powers the new "Booked Upcoming" stat card, which is the piece
        // that was missing from guestStats entirely. This is intentionally
        // separate from availableGuestRooms/occupiedGuestRooms (which are
        // both "today only") so a room can correctly be both "Available"
        // (today) AND counted here (booked starting later).
        const roomsWithUpcomingBookings = Object.keys(guestBookingsByRoom).length;

        const unreadCount = await Notification.countDocuments({
            isActive: true,
            $or: [
                { target: { $in: ['All', 'Admins'] }, readBy: { $nin: [req.user._id] } },
                { recipient: req.user._id, readBy: { $nin: [req.user._id] } }
            ]
        });
        const recentNotifs = await Notification.find({
            isActive: true,
            $or: [
                { target: { $in: ['All', 'Admins'] } },
                { recipient: req.user._id }
            ]
        }).sort({ createdAt: -1 }).limit(5).lean();
        recentNotifs.forEach(n => { n._timeAgo = timeAgo(n.createdAt); });
        const badges = await getSidebarBadges(req.user);

        res.render('admin/roomM', {
            activePage   : 'rooms',
            pageTitle    : 'Room Management',
            pageSubtitle : 'Manage rooms, allocations, and transfers',
            user               : req.user,
            rooms,
            guestRooms,
            guestBookingsByRoom,
            allocations,
            ...badges,
            recentAllocations,
            unreadCount,
            recentNotifs,
            unassignedStudentsCount: filteredUnallocated.length,
            unallocatedStudents: filteredUnallocated,
            stats: {
                totalRooms,
                availableRooms,
                occupiedRooms,
                maintenanceRooms,
                totalBeds,
                occupiedBeds,
                freeBeds
            },
            guestStats: {
                totalGuestRooms,
                availableGuestRooms,
                occupiedGuestRooms,
                maintenanceGuestRooms,
                roomsWithUpcomingBookings
            },
            successMessage: req.query.success || null,
            errorMessage  : req.query.error   || null
        });

    } catch (err) {
        console.error('getRoomManagement Error:', err);
        res.status(500).send('Server Error');
    }
};


// ══════════════════════════════════════
// ADD ROOM
// POST /admin/rooms/add
// ══════════════════════════════════════
exports.addRoom = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'admin')
            return res.status(403).send('Access Denied');

        const {
            roomNo, block, floor, capacity, roomType, roomCategory,
            monthlyFee, feePerNight, status, description
        } = req.body;

        const category = roomCategory === 'Guest' ? 'Guest' : 'Student';

        // Base required fields (same for both categories)
        if (!roomNo || !block || !floor || !capacity || !roomType)
            return res.redirect('/admin/rooms?error=All+required+fields+must+be+filled.&page=add-room');

        // Category-specific fee requirement
        if (category === 'Student' && !monthlyFee)
            return res.redirect('/admin/rooms?error=Monthly+fee+is+required+for+Student+rooms.&page=add-room');
        if (category === 'Guest' && !feePerNight)
            return res.redirect('/admin/rooms?error=Fee+per+night+is+required+for+Guest+rooms.&page=add-room');

        const existing = await Room.findOne({ roomNo });
        if (existing)
            return res.redirect('/admin/rooms?error=Room+number+already+exists.&page=add-room');

        await Room.create({
            roomNo,
            block,
            floor       : Number(floor),
            capacity    : Number(capacity),
            roomType,
            roomCategory: category,
            monthlyFee  : category === 'Student' ? Number(monthlyFee) : 0,
            feePerNight : category === 'Guest'   ? Number(feePerNight) : 0,
            status      : status || 'Available',
            occupiedBeds: 0,
            description : description || ''
        });

        const successPage = category === 'Guest' ? 'guest-rooms' : 'all-rooms';
        return res.redirect('/admin/rooms?success=Room+added+successfully.&page=' + successPage);

    } catch (err) {
        console.error('addRoom Error:', err);
        res.redirect('/admin/rooms?error=Server+error+while+adding+room.&page=add-room');
    }
};


// ══════════════════════════════════════
// EDIT ROOM
// POST /admin/rooms/edit/:id
// ══════════════════════════════════════
exports.editRoom = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'admin')
            return res.status(403).send('Access Denied');

        const {
            roomNo, block, floor, capacity, roomType, roomCategory,
            monthlyFee, feePerNight, status, description
        } = req.body;

        const room = await Room.findById(req.params.id);
        if (!room)
            return res.redirect('/admin/rooms?error=Room+not+found.');

        const newCategory = roomCategory === 'Guest' ? 'Guest' : 'Student';

        // Prevent capacity reduction below current occupancy (Student rooms
        // track occupiedBeds via Allocation; Guest rooms don't use this
        // the same way, but the guard is harmless either way)
        if (Number(capacity) < room.occupiedBeds)
            return res.redirect(
                '/admin/rooms?error=Cannot+reduce+capacity+below+current+occupancy+(' +
                room.occupiedBeds + '+occupied).&page=all-rooms'
            );

        // Prevent switching a room to Guest while students are still
        // actively allocated to it — must vacate/transfer them first.
        if (newCategory === 'Guest' && room.roomCategory === 'Student' && room.occupiedBeds > 0) {
            return res.redirect(
                '/admin/rooms?error=Cannot+convert+to+Guest+room+while+students+are+still+allocated.+Vacate+first.&page=all-rooms'
            );
        }

        room.roomNo       = roomNo;
        room.block        = block;
        room.floor        = Number(floor);
        room.capacity     = Number(capacity);
        room.roomType     = roomType;
        room.roomCategory = newCategory;
        room.monthlyFee   = newCategory === 'Student' ? Number(monthlyFee || 0) : 0;
        room.feePerNight  = newCategory === 'Guest'   ? Number(feePerNight || 0) : 0;
        room.description  = description || '';

        // Only update status to Maintenance/Available from edit;
        // Occupied is managed automatically by syncRoomOccupancy for
        // Student rooms. Guest rooms don't get auto-synced, so admin's
        // chosen status is respected as-is (including 'Occupied').
        if (status === 'Maintenance') {
            room.status = 'Maintenance';
        } else if (newCategory === 'Guest') {
            room.status = status || room.status;
        } else if (room.status === 'Maintenance') {
            // Un-maintenance: fall back to real occupancy state
            room.status = room.occupiedBeds >= room.capacity ? 'Occupied' : 'Available';
        }

        await room.save();
        const successPage = newCategory === 'Guest' ? 'guest-rooms' : 'all-rooms';
        return res.redirect('/admin/rooms?success=Room+updated+successfully.&page=' + successPage);

    } catch (err) {
        console.error('editRoom Error:', err);
        res.redirect('/admin/rooms?error=Server+error+while+updating+room.&page=all-rooms');
    }
};


// ══════════════════════════════════════
// DELETE ROOM
// POST /admin/rooms/delete/:id
// ══════════════════════════════════════
exports.deleteRoom = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'admin')
            return res.status(403).send('Access Denied');

        const roomId = req.params.id;
        const room   = await Room.findById(roomId);

        if (!room)
            return res.redirect('/admin/rooms?error=Room+not+found.&page=all-rooms');

        const activeAllocations = await Allocation.countDocuments({
            room  : roomId,
            status: 'Active'
        });

        if (activeAllocations > 0)
            return res.redirect(
                '/admin/rooms?error=Cannot+delete+an+occupied+room.+Vacate+all+students+first.&page=all-rooms'
            );

        const wasGuest = room.roomCategory === 'Guest';
        await Room.findByIdAndDelete(roomId);
        const successPage = wasGuest ? 'guest-rooms' : 'all-rooms';
        return res.redirect('/admin/rooms?success=Room+deleted+successfully.&page=' + successPage);

    } catch (err) {
        console.error('deleteRoom Error:', err);
        return res.redirect('/admin/rooms?error=Server+error+while+deleting+room.&page=all-rooms');
    }
};


// ══════════════════════════════════════
// ALLOCATE ROOM  (Student rooms only)
// POST /admin/rooms/allocate/:roomId
// ══════════════════════════════════════
exports.allocateRoom = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'admin')
            return res.status(403).send('Access Denied');

        const { studentId, bedNo, remarks } = req.body;
        const roomId = req.params.roomId;

        if (!studentId || !bedNo)
            return res.redirect('/admin/rooms?error=Student+and+bed+number+are+required.&page=all-rooms');

        const room = await Room.findById(roomId);
        if (!room)
            return res.redirect('/admin/rooms?error=Room+not+found.&page=all-rooms');

        // Guest rooms never take a student allocation — they're booked
        // as a whole room for visitors, handled entirely outside the
        // Allocation model (see Phase 3 — visitor requests).
        if (room.roomCategory === 'Guest')
            return res.redirect('/admin/rooms?error=Cannot+allocate+students+to+a+Guest+room.&page=all-rooms');

        if (room.status === 'Maintenance')
            return res.redirect('/admin/rooms?error=Cannot+allocate+a+room+under+maintenance.&page=all-rooms');

        if (room.occupiedBeds >= room.capacity)
            return res.redirect('/admin/rooms?error=Room+is+already+at+full+capacity.&page=all-rooms');

        // Check student exists and is approved
        const student = await Student.findById(studentId).populate('user');
        if (!student || !student.user || student.user.status !== 'approved')
            return res.redirect('/admin/rooms?error=Student+not+found+or+not+approved.&page=all-rooms');

        // Check student doesn't already have an active allocation
        const existing = await Allocation.findOne({ student: studentId, status: 'Active' });
        if (existing)
            return res.redirect('/admin/rooms?error=Student+already+has+an+active+room+allocation.&page=all-rooms');

        // Check bed number is not already occupied in this room
        const bedTaken = await Allocation.findOne({
            room  : roomId,
            bedNo : Number(bedNo),
            status: 'Active'
        });
        if (bedTaken)
            return res.redirect('/admin/rooms?error=Bed+' + bedNo + '+is+already+occupied.&page=all-rooms');

        // Create allocation
        const allocation = await Allocation.create({
            student       : studentId,
            room          : roomId,
            bedNo         : Number(bedNo),
            allocatedBy   : req.user._id,
            allocationDate: new Date(),
            status        : 'Active',
            remarks       : remarks || ''
        });

        // Update Student document
        student.room              = roomId;
        student.currentAllocation = allocation._id;
        await student.save();

        // ── First month's Hostel Fee Due ────────────────────────────────
        // Created immediately on allocation. Every subsequent month is
        // handled by the recurring job in jobs/hostelFeeJob.js, which
        // uses the same sourceType/sourceRef/billingPeriod pattern so it
        // never double-charges this first month.
        if (room.monthlyFee && room.monthlyFee > 0) {
            const dueDate = new Date(allocation.allocationDate);
            dueDate.setDate(dueDate.getDate() + 7); // 7-day grace period

            const hostelDue = await Due.create({
                student    : studentId,
                dueType    : 'Hostel Fee',
                amount     : room.monthlyFee,
                dueDate,
                description: 'Hostel Fee — Room ' + room.roomNo + ' (first month)',
                sourceType : 'Allocation',
                sourceRef  : allocation._id,
                billingPeriod: billingPeriodFor(allocation.allocationDate)
            });

            try {
                await Notification.create({
                    title    : 'Hostel Fee Due',
                    message  : `A Hostel Fee of Rs ${room.monthlyFee.toLocaleString()} for Room ${room.roomNo} has been added to your account. Due by ${dueDate.toLocaleDateString()}.`,
                    recipient: student.user._id,
                    category : 'Payments',
                    priority : 'Medium',
                    createdBy: req.user._id,
                    relatedTo: { model: 'Due', docId: hostelDue._id }
                });
            } catch (notifyErr) {
                console.error('allocateRoom notify error:', notifyErr);
            }
        }

        // Sync room occupancy
        await syncRoomOccupancy(roomId);

        return res.redirect('/admin/rooms?success=Room+allocated+successfully.&page=allocations');

    } catch (err) {
        console.error('allocateRoom Error:', err);
        res.redirect('/admin/rooms?error=Server+error+while+allocating+room.&page=all-rooms');
    }
};


// ══════════════════════════════════════
// VACATE ROOM
// POST /admin/rooms/vacate/:allocId
// ══════════════════════════════════════
exports.vacateRoom = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'admin')
            return res.status(403).send('Access Denied');

        const allocation = await Allocation.findById(req.params.allocId);
        if (!allocation)
            return res.redirect('/admin/rooms?error=Allocation+not+found.&page=allocations');

        if (allocation.status !== 'Active')
            return res.redirect('/admin/rooms?error=Allocation+is+not+active.&page=allocations');

        const roomId = allocation.room;

        allocation.status      = 'Vacated';
        allocation.vacatedDate = new Date();
        await allocation.save();

        await Student.findByIdAndUpdate(allocation.student, {
            room             : null,
            currentAllocation: null
        });

        await syncRoomOccupancy(roomId);

        return res.redirect('/admin/rooms?success=Student+vacated+successfully.&page=allocations');

    } catch (err) {
        console.error('vacateRoom Error:', err);
        res.redirect('/admin/rooms?error=Server+error+while+vacating+room.&page=allocations');
    }
};


// ══════════════════════════════════════
// TRANSFER STUDENT  (Student rooms only)
// POST /admin/rooms/transfer/:allocId
// ══════════════════════════════════════
exports.transferStudent = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'admin')
            return res.status(403).send('Access Denied');

        const { newRoomId, newBedNo, remarks } = req.body;
        const allocId = req.params.allocId;

        if (!newRoomId || !newBedNo)
            return res.redirect('/admin/rooms?error=New+room+and+bed+are+required.&page=allocations');

        const oldAlloc = await Allocation.findById(allocId);
        if (!oldAlloc || oldAlloc.status !== 'Active')
            return res.redirect('/admin/rooms?error=Active+allocation+not+found.&page=allocations');

        const newRoom = await Room.findById(newRoomId);
        if (!newRoom)
            return res.redirect('/admin/rooms?error=New+room+not+found.&page=allocations');

        // Guest rooms are never a valid transfer destination for a student.
        if (newRoom.roomCategory === 'Guest')
            return res.redirect('/admin/rooms?error=Cannot+transfer+a+student+to+a+Guest+room.&page=allocations');

        if (newRoom.status === 'Maintenance')
            return res.redirect('/admin/rooms?error=Cannot+transfer+to+a+room+under+maintenance.&page=allocations');

        if (newRoom.occupiedBeds >= newRoom.capacity)
            return res.redirect('/admin/rooms?error=New+room+is+at+full+capacity.&page=allocations');

        const bedTaken = await Allocation.findOne({
            room  : newRoomId,
            bedNo : Number(newBedNo),
            status: 'Active'
        });
        if (bedTaken)
            return res.redirect('/admin/rooms?error=Bed+' + newBedNo + '+is+already+occupied+in+the+new+room.&page=allocations');

        const oldRoomId = oldAlloc.room;

        oldAlloc.status      = 'Transferred';
        oldAlloc.vacatedDate = new Date();
        oldAlloc.remarks     = (oldAlloc.remarks ? oldAlloc.remarks + ' | ' : '') + 'Transferred: ' + (remarks || '');
        await oldAlloc.save();

        const newAlloc = await Allocation.create({
            student       : oldAlloc.student,
            room          : newRoomId,
            bedNo         : Number(newBedNo),
            allocatedBy   : req.user._id,
            allocationDate: new Date(),
            status        : 'Active',
            remarks       : remarks || ''
        });

        await Student.findByIdAndUpdate(oldAlloc.student, {
            room             : newRoomId,
            currentAllocation: newAlloc._id
        });

        await syncRoomOccupancy(oldRoomId);
        await syncRoomOccupancy(newRoomId);

        return res.redirect('/admin/rooms?success=Student+transferred+successfully.&page=allocations');

    } catch (err) {
        console.error('transferStudent Error:', err);
        res.redirect('/admin/rooms?error=Server+error+during+transfer.&page=allocations');
    }
};


// ══════════════════════════════════════
// GET ROOM OCCUPANTS (JSON — for modal)
// GET /admin/rooms/:roomId/occupants
// ══════════════════════════════════════
exports.getRoomOccupants = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'admin')
            return res.status(403).json({ error: 'Access Denied' });

        const allocations = await Allocation.find({
            room  : req.params.roomId,
            status: 'Active'
        }).populate({
            path    : 'student',
            populate: { path: 'user', select: 'fullname userId' }
        });

        const occupants = allocations.map(al => ({
            allocationId  : al._id,
            studentName   : al.student?.user?.fullname || '—',
            studentUserId : al.student?.user?.userId   || '—',
            bedNo         : al.bedNo,
            since         : new Date(al.allocationDate).toLocaleDateString()
        }));

        res.json({ occupants });

    } catch (err) {
        console.error('getRoomOccupants Error:', err);
        res.status(500).json({ error: 'Server Error' });
    }
};


// ══════════════════════════════════════
// GET AVAILABLE BEDS (JSON)  (Student rooms only)
// GET /admin/rooms/:roomId/free-beds
// ══════════════════════════════════════
exports.getAvailableBeds = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'admin')
            return res.status(403).json({ error: 'Access Denied' });

        const room = await Room.findById(req.params.roomId);
        if (!room)
            return res.status(404).json({ error: 'Room not found' });

        // Defensive guard — the room-select dropdowns already exclude
        // Guest rooms, but block it here too in case this endpoint is
        // ever hit directly with a Guest room id.
        if (room.roomCategory === 'Guest')
            return res.status(400).json({ error: 'Guest rooms do not support student bed allocation.' });

        const activeAllocations = await Allocation.find({
            room  : room._id,
            status: 'Active'
        });

        const occupiedBeds = activeAllocations.map(a => Number(a.bedNo));
        const freeBeds     = [];

        for (let i = 1; i <= room.capacity; i++) {
            if (!occupiedBeds.includes(i)) freeBeds.push(i);
        }

        res.json({ freeBeds });

    } catch (err) {
        console.error('getAvailableBeds Error:', err);
        res.status(500).json({ error: 'Server Error' });
    }
};


exports.getRoomGuestBookings = async (req, res) => {
    try {
        const bookings = await guestBookingActions.getActiveBookingsForRoom(req.params.roomId);

        const formatted = bookings.map(b => ({
            studentName: b.student && b.student.user ? b.student.user.fullname : 'Unknown',
            fromDate   : new Date(b.fromDate).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' }),
            toDate     : new Date(b.toDate).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' })
        }));

        res.json({ bookings: formatted });
    } catch (err) {
        console.error('getRoomGuestBookings:', err);
        res.status(500).json({ bookings: [], error: 'Failed to load bookings.' });
    }
};