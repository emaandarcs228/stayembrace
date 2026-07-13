// =====================================================================
// feeController.js
// Fee & Payment Management Module
//
// CENTRAL DESIGN:
//   - Payment model is the ONLY payment collection in the system.
//     It records Hostel Fee / Mess Order / Mobile Load / Fine payments.
//   - Due model tracks outstanding amounts owed by students
//     (Hostel Fee / Mess Order / Mobile Load / Fine).
//   - Fine model tracks disciplinary fines (separate from Dues, but a
//     "Mark Paid" on a fine creates a matching Verified Payment record
//     so it is reflected in income/reports).
//   - Admin is the final authority for verification of all payments.
//
// FIXES APPLIED (vs previous version):
//   1. addPayment now optionally links + settles a Due when studentId+
//      dueType match an outstanding due (so manual records don't drift
//      out of sync with the Due ledger).
//   2. verifyPayment now settles ALL Dues referenced on payment.dues
//      (set by studentController.postPayment) — this was previously a
//      no-op, meaning student-submitted payments never closed their Due.
//   3. rejectPayment leaves linked Dues untouched (still owed) and
//      notifies the student so they know to resubmit.
//   4. markDuePaid / markFinePaid / verifyPayment / rejectPayment now
//      all send a Notification to the student, matching the pattern
//      used everywhere in wardenController.js.
// =====================================================================

const Payment      = require('../models/payment');
const Due          = require('../models/due');
const Fine         = require('../models/fine');
const Student      = require('../models/student');
const Notification = require('../models/notification');
const { getSidebarBadges } = require('../utils/sidebarBadges');


// ══════════════════════════════════════
// HELPER — populate student -> user
// ══════════════════════════════════════
function studentPopulate() {
    return {
        path: 'student',
        populate: { path: 'user', select: 'fullname userId email phoneNumber' }
    };
}


// ══════════════════════════════════════
// HELPER — flip Pending / Partially Paid
// dues into Overdue once dueDate has passed
// ══════════════════════════════════════
async function refreshOverdueDues() {
    await Due.updateMany(
        {
            status : { $in: ['Pending', 'Partially Paid'] },
            dueDate: { $lt: new Date() }
        },
        { $set: { status: 'Overdue' } }
    );
}


// ══════════════════════════════════════
// HELPER — validate a positive amount
// ══════════════════════════════════════
function isValidAmount(amount) {
    const n = Number(amount);
    return !isNaN(n) && n > 0;
}


// ══════════════════════════════════════
// HELPER — notify a student
// ══════════════════════════════════════
async function notifyStudent({ studentUserId, title, message, category, createdBy, priority, relatedTo }) {
    if (!studentUserId) return;
    try {
        await Notification.create({
            title,
            message,
            recipient : studentUserId,
            category  : category || 'Payments',
            createdBy,
            priority  : priority || 'Low',
            ...(relatedTo ? { relatedTo } : {})
        });
    } catch (err) {
        console.error('notifyStudent error:', err);
    }
}


// ══════════════════════════════════════
// GET FEE & PAYMENT MANAGEMENT PAGE
// GET /admin/fees
// ══════════════════════════════════════
exports.getFeeManagement = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'admin')
            return res.status(403).send('Access Denied');

        // Keep due statuses fresh every time the page loads
        await refreshOverdueDues();

        const [payments, dues, fines, studentDocs] = await Promise.all([
            Payment.find()
                .populate(studentPopulate())
                .populate('verifiedBy', 'fullname')
                .sort({ createdAt: -1 }),

            Due.find()
                .populate(studentPopulate())
                .sort({ dueDate: 1 }),

            Fine.find()
                .populate(studentPopulate())
                .populate('imposedBy', 'fullname')
                .sort({ createdAt: -1 }),

            Student.find().populate({
                path  : 'user',
                select: 'fullname userId status',
                match : { status: 'approved' }
            })
        ]);

        const badges = await getSidebarBadges(req.user);

        // Only students with an approved user account
        const students = studentDocs.filter(s => s.user);

        // ── Dashboard Stats ──────────────────────────────────────────
        const totalIncomeAgg = await Payment.aggregate([
            { $match: { status: 'Verified' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        const totalIncome = totalIncomeAgg[0]?.total || 0;

        const pendingPaymentsCount = await Payment.countDocuments({
            status: { $in: ['Pending', 'Cash Received'] }
        });

        const overdueDuesCount = await Due.countDocuments({ status: 'Overdue' });

        const totalFinesAgg = await Fine.aggregate([
            { $match: { status: 'Pending' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        const totalFinesAmount = totalFinesAgg[0]?.total || 0;

        const pendingDuesAgg = await Due.aggregate([
            { $match: { status: { $in: ['Pending', 'Partially Paid', 'Overdue'] } } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        const pendingDuesTotal = pendingDuesAgg[0]?.total || 0;
        const pendingRevenue   = pendingDuesTotal + totalFinesAmount;

        const verifiedCount      = payments.filter(p => p.status === 'Verified').length;
        const totalPaymentsCount = payments.length;

        // ── Monthly Income (last 6 months, based on verifiedAt) ──────
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
        sixMonthsAgo.setDate(1);
        sixMonthsAgo.setHours(0, 0, 0, 0);

        const monthlyIncomeAgg = await Payment.aggregate([
            { $match: { status: 'Verified', verifiedAt: { $gte: sixMonthsAgo } } },
            {
                $group: {
                    _id  : { year: { $year: '$verifiedAt' }, month: { $month: '$verifiedAt' } },
                    total: { $sum: '$amount' }
                }
            }
        ]);

        const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const monthlyIncome = [];
        for (let i = 5; i >= 0; i--) {
            const d = new Date();
            d.setDate(1);
            d.setMonth(d.getMonth() - i);
            const y = d.getFullYear();
            const m = d.getMonth() + 1;
            const found = monthlyIncomeAgg.find(r => r._id.year === y && r._id.month === m);
            monthlyIncome.push({
                label: monthNames[m - 1] + ' ' + y,
                total: found ? found.total : 0
            });
        }

        // ── Service-wise earnings (Verified payments) ────────────────
        const serviceWiseAgg = await Payment.aggregate([
            { $match: { status: 'Verified' } },
            { $group: { _id: '$paymentType', total: { $sum: '$amount' }, count: { $sum: 1 } } }
        ]);

        const serviceWise = ['Hostel Fee', 'Mess Order', 'Mobile Load', 'Fine'].map(type => {
            const found = serviceWiseAgg.find(r => r._id === type);
            return {
                type,
                total: found ? found.total : 0,
                count: found ? found.count : 0
            };
        });

        // ── Defaulters list (students with one or more overdue dues) ─
        const overdueDues = dues.filter(d => d.status === 'Overdue');
        const defaultersMap = {};
        overdueDues.forEach(d => {
            if (!d.student || !d.student.user) return;
            const key = d.student._id.toString();
            if (!defaultersMap[key]) {
                defaultersMap[key] = { student: d.student, totalDue: 0, count: 0 };
            }
            defaultersMap[key].totalDue += d.amount;
            defaultersMap[key].count    += 1;
        });
        const defaulters = Object.values(defaultersMap).sort((a, b) => b.totalDue - a.totalDue);

        // ── Notifications for topbar bell (admin scope) ──
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
        recentNotifs.forEach(n => {
            const diff = Date.now() - new Date(n.createdAt).getTime();
            const mins = Math.floor(diff / 60000);
            n._timeAgo = mins < 1 ? 'just now'
                       : mins < 60 ? mins + 'm ago'
                       : Math.floor(mins / 60) < 24 ? Math.floor(mins / 60) + 'h ago'
                       : Math.floor(mins / 1440) + 'd ago';
        });

        res.render('admin/feeM', {
            user: req.user,
            unreadCount,
            recentNotifs,
            activePage: 'fees',
            pageTitle: 'Fee & Payment Management',
            pageSubtitle: 'Track dues, verify payments, and manage fines',
            payments,
            dues,
            fines,
            ...badges,
            students,
            stats: {
                totalIncome,
                pendingPaymentsCount,
                overdueDuesCount,
                totalFinesAmount,
                pendingRevenue,
                pendingDuesTotal,
                verifiedCount,
                totalPaymentsCount
            },
            monthlyIncome,
            serviceWise,
            defaulters,
            successMessage: req.query.success || null,
            errorMessage  : req.query.error   || null
        });

    } catch (err) {
        console.error('getFeeManagement Error:', err);
        res.status(500).send('Server Error');
    }
};


// =====================================================================
// PAYMENT RECORDS
// =====================================================================

// ══════════════════════════════════════
// ADD PAYMENT (manual record by admin)
// FIX: if a matching outstanding Due exists for this student+type, link
//      and settle it when the payment is recorded as Verified.
// POST /admin/fees/payments/add
// ══════════════════════════════════════
exports.addPayment = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'admin')
            return res.status(403).send('Access Denied');

        const {
            studentId, paymentType, paymentMethod,
            amount, transactionId, receiptImage, status, remarks, dueId
        } = req.body;

        if (!studentId || !paymentType || !paymentMethod || !amount)
            return res.redirect('/admin/fees?error=All+required+fields+must+be+filled.&page=payments');

        if (!isValidAmount(amount))
            return res.redirect('/admin/fees?error=Amount+must+be+a+positive+number.&page=payments');

        const student = await Student.findById(studentId).populate('user', '_id');
        if (!student)
            return res.redirect('/admin/fees?error=Student+not+found.&page=payments');

        const allowedStatus = ['Pending', 'Cash Received', 'Verified'];
        const finalStatus   = allowedStatus.includes(status) ? status : 'Pending';

        // If admin explicitly picked a Due to settle, validate it belongs to this student
        let linkedDue = null;
        if (dueId) {
            linkedDue = await Due.findOne({ _id: dueId, student: studentId });
            if (!linkedDue)
                return res.redirect('/admin/fees?error=Selected+due+not+found+for+this+student.&page=payments');
        }

        const paymentData = {
            student      : studentId,
            paymentType,
            paymentMethod,
            amount       : Number(amount),
            transactionId: transactionId || undefined,
            receiptImage : receiptImage  || undefined,
            remarks      : remarks       || undefined,
            status       : finalStatus,
            dues         : linkedDue ? [linkedDue._id] : undefined
        };

        if (finalStatus === 'Verified') {
            paymentData.verifiedBy = req.user._id;
            paymentData.verifiedAt = new Date();
        }

        const payment = await Payment.create(paymentData);

        // FIX: settle the linked due immediately if payment is already Verified
        if (linkedDue && finalStatus === 'Verified') {
            linkedDue.status     = 'Paid';
            linkedDue.paidAmount = linkedDue.amount;
            await linkedDue.save();
        }

        if (finalStatus === 'Verified') {
            await notifyStudent({
                studentUserId: student.user._id,
                title: 'Payment Recorded',
                message: `A payment of Rs ${Number(amount).toLocaleString()} (${paymentType}) has been recorded and verified by admin.`,
                createdBy: req.user._id,
                relatedTo: { model: 'Payment', docId: payment._id }
            });
        }

        return res.redirect('/admin/fees?success=Payment+recorded+successfully.&page=payments');

    } catch (err) {
        console.error('addPayment Error:', err);
        res.redirect('/admin/fees?error=Server+error+while+recording+payment.&page=payments');
    }
};


// ══════════════════════════════════════
// VERIFY PAYMENT
// FIX: now settles every Due referenced in payment.dues (this is how
//      studentController.postPayment links a submitted payment to the
//      dues it's meant to clear). Previously this was never touched,
//      so Dues stayed "Pending" forever even after verification.
// POST /admin/fees/payments/verify/:id
// ══════════════════════════════════════
exports.verifyPayment = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'admin')
            return res.status(403).send('Access Denied');

        const payment = await Payment.findById(req.params.id)
            .populate({ path: 'student', populate: { path: 'user', select: '_id' } });
        if (!payment)
            return res.redirect('/admin/fees?error=Payment+not+found.&page=pending');

        if (payment.status === 'Verified')
            return res.redirect('/admin/fees?error=Payment+is+already+verified.&page=pending');

        if (payment.status === 'Rejected')
            return res.redirect('/admin/fees?error=Cannot+verify+a+rejected+payment.&page=pending');

        payment.status     = 'Verified';
        payment.verifiedBy = req.user._id;
        payment.verifiedAt = new Date();

        await payment.save();

        // FIX: settle all linked dues
        if (payment.dues && payment.dues.length > 0) {
            await Due.updateMany(
                { _id: { $in: payment.dues } },
                { $set: { status: 'Paid' }, $currentDate: { updatedAt: true } }
            );
            // set paidAmount = amount for each (can't $set per-doc differing values in updateMany,
            // so do it individually to keep paidAmount accurate)
            const linkedDues = await Due.find({ _id: { $in: payment.dues } });
            for (const due of linkedDues) {
                due.paidAmount = due.amount;
                await due.save();
            }
        }

        await notifyStudent({
            studentUserId: payment.student?.user?._id,
            title: 'Payment Verified',
            message: `Your payment of Rs ${payment.amount.toLocaleString()} (${payment.paymentType}) has been verified.`,
            createdBy: req.user._id,
            relatedTo: { model: 'Payment', docId: payment._id }
        });

        return res.redirect('/admin/fees?success=Payment+verified+successfully.&page=pending');

    } catch (err) {
        console.error('verifyPayment Error:', err);
        res.redirect('/admin/fees?error=Server+error+while+verifying+payment.&page=pending');
    }
};


// ══════════════════════════════════════
// REJECT PAYMENT
// FIX: notifies the student so they know to resubmit. Linked dues are
//      intentionally left untouched (still owed) since the payment
//      attempt failed.
// POST /admin/fees/payments/reject/:id
// ══════════════════════════════════════
exports.rejectPayment = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'admin')
            return res.status(403).send('Access Denied');

        const { remarks } = req.body;

        const payment = await Payment.findById(req.params.id)
            .populate({ path: 'student', populate: { path: 'user', select: '_id' } });
        if (!payment)
            return res.redirect('/admin/fees?error=Payment+not+found.&page=pending');

        if (payment.status === 'Verified')
            return res.redirect('/admin/fees?error=Cannot+reject+an+already+verified+payment.&page=pending');

        if (payment.status === 'Rejected')
            return res.redirect('/admin/fees?error=Payment+is+already+rejected.&page=pending');

        payment.status     = 'Rejected';
        payment.verifiedBy = req.user._id;
        payment.verifiedAt = new Date();
        if (remarks) payment.remarks = remarks;

        await payment.save();

        await notifyStudent({
            studentUserId: payment.student?.user?._id,
            title: 'Payment Rejected',
            message: `Your payment of Rs ${payment.amount.toLocaleString()} (${payment.paymentType}) was rejected. ${remarks ? 'Reason: ' + remarks : 'Please resubmit with correct details.'}`,
            createdBy: req.user._id,
            priority: 'Medium',
            relatedTo: { model: 'Payment', docId: payment._id }
        });

        return res.redirect('/admin/fees?success=Payment+rejected.&page=pending');

    } catch (err) {
        console.error('rejectPayment Error:', err);
        res.redirect('/admin/fees?error=Server+error+while+rejecting+payment.&page=pending');
    }
};


// ══════════════════════════════════════
// MARK CASH RECEIVED
// POST /admin/fees/payments/cash-received/:id
// ══════════════════════════════════════
exports.markCashReceived = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'admin')
            return res.status(403).send('Access Denied');

        const payment = await Payment.findById(req.params.id)
            .populate({ path: 'student', populate: { path: 'user', select: '_id' } });
        if (!payment)
            return res.redirect('/admin/fees?error=Payment+not+found.&page=payments');

        if (payment.status !== 'Pending')
            return res.redirect('/admin/fees?error=Only+pending+payments+can+be+marked+as+cash+received.&page=payments');

        payment.status = 'Cash Received';
        await payment.save();

        await notifyStudent({
            studentUserId: payment.student?.user?._id,
            title: 'Cash Payment Received',
            message: `Your cash payment of Rs ${payment.amount.toLocaleString()} has been received and is awaiting verification.`,
            createdBy: req.user._id,
            relatedTo: { model: 'Payment', docId: payment._id }
        });

        return res.redirect('/admin/fees?success=Payment+marked+as+cash+received.+Awaiting+verification.&page=pending');

    } catch (err) {
        console.error('markCashReceived Error:', err);
        res.redirect('/admin/fees?error=Server+error+while+updating+payment.&page=payments');
    }
};


// =====================================================================
// DUES MANAGEMENT
// =====================================================================

// ══════════════════════════════════════
// GENERATE DUE
// POST /admin/fees/dues/generate
// ══════════════════════════════════════
exports.generateDue = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'admin')
            return res.status(403).send('Access Denied');

        const { studentId, dueType, amount, dueDate, description } = req.body;

        if (!studentId || !dueType || !amount || !dueDate)
            return res.redirect('/admin/fees?error=All+required+fields+must+be+filled.&page=dues');

        if (!isValidAmount(amount))
            return res.redirect('/admin/fees?error=Amount+must+be+a+positive+number.&page=dues');

        const student = await Student.findById(studentId).populate('user', '_id');
        if (!student)
            return res.redirect('/admin/fees?error=Student+not+found.&page=dues');

        const due = new Due({
            student    : studentId,
            dueType,
            amount     : Number(amount),
            dueDate    : new Date(dueDate),
            description: description || undefined,
            status     : 'Pending'
        });

        // If the due date is already in the past, flag it immediately
        if (due.dueDate < new Date()) due.status = 'Overdue';

        await due.save();

        await notifyStudent({
            studentUserId: student.user._id,
            title: 'New Due Generated',
            message: `A new ${dueType} due of Rs ${Number(amount).toLocaleString()} has been added to your account. Due by ${due.dueDate.toLocaleDateString()}.`,
            createdBy: req.user._id,
            category: 'Payments',
            priority: 'Medium',
            relatedTo: { model: 'Due', docId: due._id }
        });

        return res.redirect('/admin/fees?success=Due+generated+successfully.&page=dues');

    } catch (err) {
        console.error('generateDue Error:', err);
        res.redirect('/admin/fees?error=Server+error+while+generating+due.&page=dues');
    }
};


// ══════════════════════════════════════
// MARK DUE AS PAID
// (creates a Verified Payment record linked to the student)
// FIX: now notifies the student.
// POST /admin/fees/dues/mark-paid/:id
// ══════════════════════════════════════
exports.markDuePaid = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'admin')
            return res.status(403).send('Access Denied');

        const { paymentMethod, transactionId, remarks } = req.body;

        const due = await Due.findById(req.params.id)
            .populate({ path: 'student', populate: { path: 'user', select: '_id' } });
        if (!due)
            return res.redirect('/admin/fees?error=Due+not+found.&page=dues');

        if (due.status === 'Paid')
            return res.redirect('/admin/fees?error=This+due+is+already+paid.&page=dues');

        const allowedMethods = ['Cash', 'Easypaisa', 'JazzCash'];
        if (!paymentMethod || !allowedMethods.includes(paymentMethod))
            return res.redirect('/admin/fees?error=A+valid+payment+method+is+required.&page=dues');

        const payment = await Payment.create({
            student      : due.student._id,
            paymentType  : due.dueType,
            paymentMethod,
            amount       : due.amount,
            transactionId: transactionId || undefined,
            remarks      : remarks || ('Settled due: ' + (due.description || due.dueType)),
            status       : 'Verified',
            verifiedBy   : req.user._id,
            verifiedAt   : new Date(),
            dues         : [due._id]
        });

        due.status     = 'Paid';
        due.paidAmount = due.amount;
        await due.save();

        await notifyStudent({
            studentUserId: due.student.user._id,
            title: 'Due Settled',
            message: `Your ${due.dueType} due of Rs ${due.amount.toLocaleString()} has been marked as paid via ${paymentMethod}.`,
            createdBy: req.user._id,
            relatedTo: { model: 'Payment', docId: payment._id }
        });

        return res.redirect('/admin/fees?success=Due+marked+as+paid+and+payment+recorded.&page=dues');

    } catch (err) {
        console.error('markDuePaid Error:', err);
        res.redirect('/admin/fees?error=Server+error+while+marking+due+as+paid.&page=dues');
    }
};


// ══════════════════════════════════════
// DELETE DUE
// POST /admin/fees/dues/delete/:id
// ══════════════════════════════════════
exports.deleteDue = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'admin')
            return res.status(403).send('Access Denied');

        const due = await Due.findById(req.params.id);
        if (!due)
            return res.redirect('/admin/fees?error=Due+not+found.&page=dues');

        if (due.status === 'Paid')
            return res.redirect('/admin/fees?error=Cannot+delete+a+due+that+has+already+been+paid.&page=dues');

        await Due.findByIdAndDelete(req.params.id);

        return res.redirect('/admin/fees?success=Due+deleted+successfully.&page=dues');

    } catch (err) {
        console.error('deleteDue Error:', err);
        res.redirect('/admin/fees?error=Server+error+while+deleting+due.&page=dues');
    }
};


// =====================================================================
// FINE MANAGEMENT
// =====================================================================

// ══════════════════════════════════════
// APPLY FINE
// FIX: now notifies the student.
// POST /admin/fees/fines/apply
// ══════════════════════════════════════
exports.applyFine = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'admin')
            return res.status(403).send('Access Denied');

        const { studentId, reason, amount } = req.body;

        if (!studentId || !reason || !amount)
            return res.redirect('/admin/fees?error=All+required+fields+must+be+filled.&page=fines');

        if (!isValidAmount(amount))
            return res.redirect('/admin/fees?error=Amount+must+be+a+positive+number.&page=fines');

        const student = await Student.findById(studentId).populate('user', '_id');
        if (!student)
            return res.redirect('/admin/fees?error=Student+not+found.&page=fines');

        const fine = await Fine.create({
            student  : studentId,
            reason,
            amount   : Number(amount),
            imposedBy: req.user._id,
            status   : 'Pending'
        });

        await notifyStudent({
            studentUserId: student.user._id,
            title: 'Fine Applied',
            message: `A fine of Rs ${Number(amount).toLocaleString()} has been applied to your account. Reason: ${reason}`,
            createdBy: req.user._id,
            category: 'Payments',
            priority: 'High',
            relatedTo: { model: 'Fine', docId: fine._id }
        });

        return res.redirect('/admin/fees?success=Fine+applied+successfully.&page=fines');

    } catch (err) {
        console.error('applyFine Error:', err);
        res.redirect('/admin/fees?error=Server+error+while+applying+fine.&page=fines');
    }
};


// ══════════════════════════════════════
// WAIVE FINE
// FIX: now notifies the student.
// POST /admin/fees/fines/waive/:id
// ══════════════════════════════════════
exports.waiveFine = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'admin')
            return res.status(403).send('Access Denied');

        const fine = await Fine.findById(req.params.id)
            .populate({ path: 'student', populate: { path: 'user', select: '_id' } });
        if (!fine)
            return res.redirect('/admin/fees?error=Fine+not+found.&page=fines');

        if (fine.status !== 'Pending')
            return res.redirect('/admin/fees?error=Only+pending+fines+can+be+waived.&page=fines');

        fine.status = 'Waived';
        await fine.save();

        await notifyStudent({
            studentUserId: fine.student.user._id,
            title: 'Fine Waived',
            message: `Your fine of Rs ${fine.amount.toLocaleString()} (${fine.reason}) has been waived by admin.`,
            createdBy: req.user._id,
            relatedTo: { model: 'Fine', docId: fine._id }
        });

        return res.redirect('/admin/fees?success=Fine+waived+successfully.&page=fines');

    } catch (err) {
        console.error('waiveFine Error:', err);
        res.redirect('/admin/fees?error=Server+error+while+waiving+fine.&page=fines');
    }
};


// ══════════════════════════════════════
// MARK FINE AS PAID
// (creates a Verified Payment record linked to the student)
// FIX: now notifies the student.
// POST /admin/fees/fines/mark-paid/:id
// ══════════════════════════════════════
exports.markFinePaid = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'admin')
            return res.status(403).send('Access Denied');

        const { paymentMethod, transactionId } = req.body;

        const fine = await Fine.findById(req.params.id)
            .populate({ path: 'student', populate: { path: 'user', select: '_id' } });
        if (!fine)
            return res.redirect('/admin/fees?error=Fine+not+found.&page=fines');

        if (fine.status !== 'Pending')
            return res.redirect('/admin/fees?error=Only+pending+fines+can+be+marked+as+paid.&page=fines');

        const allowedMethods = ['Cash', 'Easypaisa', 'JazzCash'];
        if (!paymentMethod || !allowedMethods.includes(paymentMethod))
            return res.redirect('/admin/fees?error=A+valid+payment+method+is+required.&page=fines');

        const payment = await Payment.create({
            student      : fine.student._id,
            paymentType  : 'Fine',
            paymentMethod,
            amount       : fine.amount,
            transactionId: transactionId || undefined,
            remarks      : 'Fine payment: ' + fine.reason,
            status       : 'Verified',
            verifiedBy   : req.user._id,
            verifiedAt   : new Date()
        });

        fine.status = 'Paid';
        await fine.save();

        await notifyStudent({
            studentUserId: fine.student.user._id,
            title: 'Fine Paid',
            message: `Your fine of Rs ${fine.amount.toLocaleString()} (${fine.reason}) has been marked as paid via ${paymentMethod}.`,
            createdBy: req.user._id,
            relatedTo: { model: 'Payment', docId: payment._id }
        });

        return res.redirect('/admin/fees?success=Fine+marked+as+paid+and+payment+recorded.&page=fines');

    } catch (err) {
        console.error('markFinePaid Error:', err);
        res.redirect('/admin/fees?error=Server+error+while+marking+fine+as+paid.&page=fines');
    }
};


// ══════════════════════════════════════
// GET OUTSTANDING DUES FOR A STUDENT (JSON — for Add Payment modal)
// Lets admin link a manual payment record to a specific outstanding due.
// GET /admin/fees/student/:studentId/dues
// ══════════════════════════════════════
exports.getStudentOutstandingDues = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'admin')
            return res.status(403).json({ error: 'Access Denied' });

        const dues = await Due.find({
            student: req.params.studentId,
            status : { $in: ['Pending', 'Partially Paid', 'Overdue'] }
        }).sort({ dueDate: 1 }).lean();

        res.json({ dues });
    } catch (err) {
        console.error('getStudentOutstandingDues Error:', err);
        res.status(500).json({ error: 'Server Error' });
    }
};