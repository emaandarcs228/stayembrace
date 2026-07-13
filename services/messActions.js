const FoodOrder     = require('../models/foodOrder');
const Due           = require('../models/due');
const Payment       = require('../models/payment');
const Menu          = require('../models/mess');
const MenuItem      = require('../models/menuItem');
const MessLog       = require('../models/messDailyLog');
const Notification  = require('../models/notification');

// Common meals shown first if they exist; anything else warden adds
// (e.g. "Beverages", "Midnight Snacks") is free-text and just sorts
// alphabetically after these.
const PRIORITY_ORDER = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];

// ─────────────────────────────────────────────────────────────
// ORDERS
// ─────────────────────────────────────────────────────────────

// allowOverride = true → admin bypassing the "payment must be
// confirmed" rule. Warden always calls this with allowOverride:false.
async function updateOrderStatus(orderId, actor, { newStatus, allowOverride = false }) {
    const validStatuses = ['Accepted', 'Preparing', 'Delivered', 'Cancelled'];
    if (!validStatuses.includes(newStatus)) return { ok: false, error: 'Invalid status.' };

    const order = await FoodOrder.findById(orderId)
        .populate({ path: 'student', populate: { path: 'user', select: '_id' } })
        .populate('due');
    if (!order) return { ok: false, error: 'Order not found.' };

    const isPaid = order.due && order.due.status === 'Paid';
    // Cancelling is always allowed regardless of payment state.
    if (!isPaid && !allowOverride && newStatus !== 'Cancelled') {
        return { ok: false, error: 'Payment not confirmed for this order. Use override to force this change.' };
    }

    order.orderStatus = newStatus;
    order.handledBy   = actor._id;
    await order.save();

    try {
        await Notification.create({
            title    : 'Mess Order Update',
            message  : `Your mess order is now: ${newStatus}.` + (allowOverride && !isPaid ? ' (Admin override)' : ''),
            recipient: order.student.user._id,
            category : 'Requests',
            relatedTo: { model: 'FoodOrder', docId: order._id },
            createdBy: actor._id
        });
    } catch (_) {}

    return { ok: true, order };
}

async function markCashReceived(orderId, actor) {
    const order = await FoodOrder.findById(orderId)
        .populate({ path: 'student', populate: { path: 'user', select: '_id' } });
    if (!order) return { ok: false, error: 'Order not found.' };

    const due = await Due.findOne({ sourceType: 'FoodOrder', sourceRef: order._id });
    if (due && due.status !== 'Paid') {
        due.status     = 'Paid';
        due.paidAmount = due.amount;
        await due.save();

        await Payment.create({
            student      : order.student._id,
            paymentType  : due.dueType,
            paymentMethod: 'Cash',
            amount       : due.amount,
            status       : 'Verified',
            source       : 'Manual',
            verifiedBy   : actor._id,
            verifiedAt   : new Date(),
            dues         : [due._id],
            remarks      : `Cash collected by ${actor.role || 'staff'} for mess order`
        });
    }

    try {
        await Notification.create({
            title    : 'Mess Payment Confirmed',
            message  : 'Cash received for your mess order. Order is now being processed.',
            recipient: order.student.user._id,
            category : 'Payments',
            createdBy: actor._id
        });
    } catch (_) {}

    return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// MENU MANAGEMENT
// ─────────────────────────────────────────────────────────────

// Free-text category name — warden can add any meal category, not
// just the original 4. Case-insensitive duplicate check.
async function addMenu(name) {
    const trimmed = (name || '').trim();
    if (!trimmed) return { ok: false, error: 'Meal category name is required.' };

    const existing = await Menu.findOne({ name: { $regex: `^${trimmed}$`, $options: 'i' } });
    if (existing) return { ok: false, error: 'This meal category already exists.' };

    const menu = await Menu.create({ name: trimmed, isActive: true });
    return { ok: true, menu };
}

// imagePath is a pre-resolved 'uploads/mess/xyz.jpg' string built by
// the controller from req.file (multer) — this function stays
// upload-mechanism-agnostic.
async function addMenuItem({ menuId, name, price, description, imagePath }) {
    if (!menuId || !name || !price) return { ok: false, error: 'Please fill all required fields.' };
    const menu = await Menu.findById(menuId);
    if (!menu) return { ok: false, error: 'Meal category not found.' };

    const item = await MenuItem.create({
        menu       : menu._id,
        name,
        price      : parseFloat(price),
        description: description || '',
        image      : imagePath || null,
        isAvailable: true
    });
    return { ok: true, item };
}

async function editMenuItem(itemId, { name, price, description, isAvailable, imagePath }) {
    const item = await MenuItem.findById(itemId);
    if (!item) return { ok: false, error: 'Item not found.' };

    if (name)  item.name  = name;
    if (price) item.price = parseFloat(price);
    item.description = description || '';
    if (imagePath) item.image = imagePath;
    item.isAvailable = isAvailable === 'on';

    await item.save();
    return { ok: true, item };
}

async function deleteMenuItem(itemId) {
    const usedInOrder = await FoodOrder.findOne({ 'items.menuItem': itemId });
    if (usedInOrder) return { ok: false, error: 'Cannot delete — item used in existing orders. Disable it instead.' };
    await MenuItem.findByIdAndDelete(itemId);
    return { ok: true };
}

async function publishTodayMenu(itemIds, actor) {
    if (!Array.isArray(itemIds)) itemIds = itemIds ? [itemIds] : [];

    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayEnd   = new Date(); todayEnd.setHours(23, 59, 59, 999);

    let todayLog = await MessLog.findOne({ date: { $gte: todayStart, $lte: todayEnd } });

    if (todayLog) {
        todayLog.availableItems = itemIds;
        todayLog.updatedBy      = actor._id;
        await todayLog.save();
    } else {
        todayLog = await MessLog.create({
            date          : new Date(),
            availableItems: itemIds,
            updatedBy     : actor._id
        });
    }

    return { ok: true, todayLog };
}

// ─────────────────────────────────────────────────────────────
// Shared page-data builder — used by BOTH warden's getMessOrders
// and admin's getMessOrders, so the two pages can never drift.
// ─────────────────────────────────────────────────────────────
async function buildMessPageData({ statusFilter = 'active' } = {}) {
    let query = {};
    if (statusFilter === 'active') {
        query.orderStatus = { $in: ['Pending', 'Accepted', 'Preparing'] };
    } else if (statusFilter !== 'all') {
        query.orderStatus = statusFilter;
    }

    const orders = await FoodOrder.find(query)
        .populate({ path: 'student', populate: { path: 'user', select: 'fullname userId' } })
        .populate('items.menuItem', 'name price')
        .populate('due')
        .sort({ orderDate: -1 })
        .lean();

    const rawMenus  = await Menu.find().lean();
    const menuItems = await MenuItem.find().populate('menu', 'name').sort({ name: 1 }).lean();

    const itemsByMeal = {};
    menuItems.forEach(item => {
        const mealName = item.menu?.name || 'Unassigned';
        if (!itemsByMeal[mealName]) itemsByMeal[mealName] = [];
        itemsByMeal[mealName].push(item);
    });

    // Common 4 meals first (if they exist), then any custom categories
    // alphabetically.
    const menus = rawMenus.sort((a, b) => {
        const ai = PRIORITY_ORDER.indexOf(a.name);
        const bi = PRIORITY_ORDER.indexOf(b.name);
        if (ai === -1 && bi === -1) return a.name.localeCompare(b.name);
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
    });

    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayEnd   = new Date(); todayEnd.setHours(23, 59, 59, 999);
    const todayLog = await MessLog.findOne({ date: { $gte: todayStart, $lte: todayEnd } }).lean();
    const publishedItemIds = todayLog ? todayLog.availableItems.map(id => id.toString()) : [];

    return { orders, menus, itemsByMeal, publishedItemIds };
}

module.exports = {
    updateOrderStatus,
    markCashReceived,
    addMenu,
    addMenuItem,
    editMenuItem,
    deleteMenuItem,
    publishTodayMenu,
    buildMessPageData
};