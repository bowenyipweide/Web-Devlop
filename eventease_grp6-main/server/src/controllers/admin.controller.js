const User = require('../models/User');
const Event = require('../models/Event');
const Booking = require('../models/Booking');
const Seat = require('../models/Seat');
const AuditLog = require('../models/AuditLog');
const ResaleListing = require('../models/ResaleListing');
const ApiError = require('../utils/ApiError');
const { asyncHandler, ok } = require('../utils/asyncHandler');
const { applyEventChanges, reconstructSections } = require('./event.controller');
const notificationService = require('../services/notification.service');
const chatbot = require('../services/chatbot.service');
const { audit } = require('../utils/audit');

const platformStats = asyncHandler(async (req, res) => {
  const [users, events, bookings, revenueAgg, resale] = await Promise.all([
    User.countDocuments(),
    Event.countDocuments(),
    Booking.countDocuments({ status: { $in: ['confirmed', 'refunded'] } }),
    Booking.aggregate([
      { $match: { status: 'confirmed' } },
      { $group: { _id: null, revenue: { $sum: '$total' }, tickets: { $sum: { $size: '$tickets' } } } },
    ]),
    ResaleListing.countDocuments({ status: 'sold' }),
  ]);
  ok(res, {
    users,
    events,
    bookings,
    revenue: revenueAgg[0]?.revenue || 0,
    ticketsSold: revenueAgg[0]?.tickets || 0,
    resaleSold: resale,
    refundRequests: await Booking.countDocuments({ status: 'refund_pending' }),
  });
});

const listUsers = asyncHandler(async (req, res) => {
  const { role, q, page = 1, limit = 20 } = req.query;
  const filter = {};
  if (role) filter.role = role;
  if (q) filter.name = new RegExp(q, 'i');

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.min(50, parseInt(limit, 10) || 20);
  const [users, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip((pageNum - 1) * pageSize).limit(pageSize),
    User.countDocuments(filter),
  ]);
  ok(res, {
    users: users.map((u) => ({ ...u.toSafeJSON(), role: u.role, isApproved: u.isApproved })),
    total,
    page: pageNum,
  });
});

const updateUserStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { approve, ban, role } = req.body;
  if (String(req.user._id) === String(id)) throw ApiError.badRequest('Cannot modify your own account');

  const update = {};
  if (typeof approve === 'boolean') {
    update.isApproved = approve;
    update.role = approve ? 'organizer' : update.role;
  }
  if (typeof ban === 'boolean') {
    update.isBanned = ban;
    if (!ban) update.isBanned = false;
  }
  if (role && ['customer', 'organizer', 'admin'].includes(role)) update.role = role;

  const user = await User.findByIdAndUpdate(id, update, { new: true });
  if (!user) throw ApiError.notFound('User not found');

  await audit(req, { action: 'admin.user.update', targetType: 'User', targetId: id, note: JSON.stringify(update) });
  ok(res, { user: { ...user.toSafeJSON(), role: user.role, isApproved: user.isApproved } });
});

const moderationQueue = asyncHandler(async (req, res) => {
  // New-event submissions (approval pending/rejected) plus pending edit
  // proposals (editReviewStatus pending) on already-live events.
  const events = await Event.find({
    $or: [{ approval: { $in: ['pending', 'rejected'] } }, { editReviewStatus: 'pending' }],
  }).sort({ createdAt: 1 }).populate('owner', 'name organization');

  const mapped = [];
  for (const e of events) {
    const pub = e.toPublicJSON();
    let currentSections = null;
    if (e.pendingEdit && e.reservedSeating) {
      const seats = await Seat.find({ event: e._id }).select('section row number categoryId categoryName tier price').lean();
      currentSections = reconstructSections(seats);
    }
    mapped.push({
      ...pub,
      owner: e.owner,
      isEdit: !!e.pendingEdit,
      proposedChanges: e.pendingEdit || null,
      currentSections,
    });
  }
  ok(res, { events: mapped });
});

const reviewEvent = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { decision, note } = req.body; // decision: approved | rejected
  if (!['approved', 'rejected'].includes(decision)) throw ApiError.badRequest('Decision must be approved or rejected');

  const event = await Event.findById(id);
  if (!event) throw ApiError.notFound('Event not found');

  if (event.pendingEdit) {
    if (decision === 'approved') {
      await applyEventChanges(event, event.pendingEdit);
      event.set('pendingEdit', null);
      event.set('editReviewStatus', 'none');
      event.approval = 'approved';
      event.approvalNote = note;
      await event.save();
      const owner = await User.findById(event.owner);
      await notificationService.notify(owner, {
        kind: 'event.edit_approved',
        subject: `EventEase · Edit approved for ${event.title}`,
        title: 'Your changes are now live',
        body: `Your updated details for "${event.title}" were approved and the listing now shows the new information. ${note || ''}`,
      });
      await audit(req, { action: 'admin.event.edit_approved', targetType: 'Event', targetId: event._id, note });
    } else {
      event.set('editReviewStatus', 'rejected');
      event.approvalNote = note;
      await event.save();
      const owner = await User.findById(event.owner);
      await notificationService.notify(owner, {
        kind: 'event.edit_rejected',
        subject: `EventEase · Edit rejected for ${event.title}`,
        title: 'Your changes were rejected',
        body: `Your requested changes to "${event.title}" were rejected. The published listing is unchanged. ${note || ''}`,
      });
      await audit(req, { action: 'admin.event.edit_rejected', targetType: 'Event', targetId: event._id, note });
    }
    chatbot.invalidateCache();
    return ok(res, { event: event.toPublicJSON() });
  }

  const update = await Event.findByIdAndUpdate(
    { _id: id, approval: 'pending' },
    { approval: decision, approvalNote: note, status: decision === 'approved' ? 'published' : 'draft' },
    { new: true }
  );
  if (!update) throw ApiError.notFound('Event not found or already reviewed');

  const owner = await User.findById(update.owner);
  await notificationService.notify(owner, {
    kind: 'event.review',
    subject: `EventEase · Event ${decision}`,
    title: `Your event was ${decision}`,
    body: `"${update.title}" was ${decision}. ${note || ''}`,
  });
  await audit(req, { action: `admin.event.${decision}`, targetType: 'Event', targetId: update._id, note });
  chatbot.invalidateCache();
  ok(res, { event: update.toPublicJSON() });
});

const listRefundRequests = asyncHandler(async (req, res) => {
  const bookings = await Booking.find({ status: 'refund_pending' })
    .populate('user', 'name email role')
    .populate('event', 'title startDate venue')
    .sort({ updatedAt: -1 });

  // Flag anything that cannot be approved, so the admin is not left clicking
  // Approve and reading a 400 to find out a ticket was resold or already scanned.
  const { refundBlockers, REFUND_BLOCKING_TICKET_STATUS } = require('./booking.controller');
  const refunds = await Promise.all(bookings.map(async (b) => {
    const blockers = await refundBlockers(b._id);
    return {
      ...b.toObject(),
      refundBlockers: blockers.map((t) => ({
        status: t.status,
        seatLabel: t.seatLabel || null,
        reason: REFUND_BLOCKING_TICKET_STATUS[t.status] || 'already used for entry',
      })),
      refundBlocked: blockers.length > 0,
    };
  }));

  ok(res, { refunds });
});

const reviewRefund = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { decision, note } = req.body;
  if (!['approved', 'rejected'].includes(decision)) throw ApiError.badRequest('Decision must be approved or rejected');

  const booking = await Booking.findById(id);
  if (!booking) throw ApiError.notFound('Refund request not found');
  if (booking.status !== 'refund_pending') throw ApiError.badRequest('This booking is not waiting for refund approval');

  if (decision === 'approved') {
    const refunded = await require('../controllers/booking.controller').cancelAndRelease(booking, 'refunded', req.user._id);
    await notificationService.notify(booking.user, {
      kind: 'booking.refunded',
      subject: `EventEase · Refund approved for ${booking.reference}`,
      title: 'Refund approved',
      body: `Your refund for booking ${booking.reference} has been approved and processed.`,
    });
    await audit(req, { action: 'admin.refund.approved', targetType: 'Booking', targetId: booking._id, note: note || 'approved' });
    ok(res, { booking: refunded, message: 'Refund approved and processed.' });
    return;
  }

  booking.status = 'confirmed';
  booking.cancelReason = 'refund_rejected';
  booking.audit.push({ at: new Date(), action: 'refund.rejected', by: req.user._id, note: note || 'rejected by admin' });
  await booking.save();

  await notificationService.notify(booking.user, {
    kind: 'booking.refund_rejected',
    subject: `EventEase · Refund request rejected for ${booking.reference}`,
    title: 'Refund request rejected',
    body: `Your refund request for booking ${booking.reference} was rejected by an admin.`,
  });

  await audit(req, { action: 'admin.refund.rejected', targetType: 'Booking', targetId: booking._id, note: note || 'rejected' });
  ok(res, { booking, message: 'Refund request rejected.' });
});

// ---- Fraud monitoring ----
const fraudMonitor = asyncHandler(async (req, res) => {
  const now = new Date();

  const suspiciousBookings = await Booking.aggregate([
    { $match: { status: { $in: ['cancelled', 'expired'] }, createdAt: { $gte: new Date(now - 7 * 24 * 3600e3) } } },
    { $group: { _id: '$user', cancellations: { $sum: 1 } } },
    { $match: { cancellations: { $gte: 5 } } },
    { $sort: { cancellations: -1 } },
    { $limit: 10 },
  ]);

  const totals = await Booking.aggregate([
    { $match: { createdAt: { $gte: new Date(now - 7 * 24 * 3600e3) } } },
    { $group: { _id: '$user', total: { $sum: 1 } } },
  ]);
  const totalByUser = new Map(totals.map((t) => [String(t._id), t.total]));

  const flaggedUsers = [];
  for (const s of suspiciousBookings) {
    const total = totalByUser.get(String(s._id)) || s.cancellations;
    const user = await User.findById(s._id).select('name email role isBanned');
    if (!user) continue;

    // The individual cancelled/expired bookings behind the flag, so admins
    // can see exactly when each action happened.
    const actions = await Booking.find({
      user: s._id,
      status: { $in: ['cancelled', 'expired'] },
      createdAt: { $gte: new Date(now - 7 * 24 * 3600e3) },
    })
      .populate('event', 'title slug')
      .sort({ updatedAt: -1 })
      .limit(20)
      .select('reference status cancelReason createdAt updatedAt event');

    flaggedUsers.push({
      user,
      cancellations: s.cancellations,
      total,
      cancelRate: Math.round((s.cancellations / total) * 100),
      actions: actions.map((b) => ({
        eventTitle: b.event?.title || null,
        reference: b.reference,
        status: b.status,
        cancelReason: b.cancelReason || null,
        at: (b.updatedAt || b.createdAt).toISOString(),
      })),
    });
  }

  const invalidQrAttempts = await AuditLog.countDocuments({
    action: 'ticket.validate',
    createdAt: { $gte: new Date(now - 7 * 24 * 3600e3) },
  }).catch(() => 0);

  // Resale price gouging detection (tickets resold > 50% above face value).
  const gouging = await ResaleListing.aggregate([
    { $match: { status: { $in: ['listed', 'sold', 'reserved'] } } },
    { $lookup: { from: 'tickets', localField: 'ticket', foreignField: '_id', as: 'tk' } },
    { $unwind: '$tk' },
    { $lookup: { from: 'users', localField: 'seller', foreignField: '_id', as: 'seller' } },
    { $unwind: { path: '$seller', preserveNullAndEmptyArrays: true } },
    { $match: { $expr: { $gt: ['$price', { $multiply: ['$tk.price', 1.5] }] } } },
    { $project: {
      price: 1,
      faceValue: '$tk.price',
      status: 1,
      listedAt: '$createdAt',
      sellerName: '$seller.name',
      sellerEmail: '$seller.email',
    } },
    { $limit: 10 },
  ]);

  const flaggedEvents = await Event.find({
    $or: [{ views: { $gt: 100 } }, { approval: 'rejected' }],
  }).countDocuments();

  ok(res, {
    flaggedUsers,
    invalidQrAttempts,
    priceGouging: gouging,
    flaggedEvents,
    summary: {
      cancelled7d: suspiciousBookings.reduce((s, x) => s + x.cancellations, 0),
      riskyUsers: flaggedUsers.length,
    },
  });
});

module.exports = {
  platformStats,
  listUsers,
  updateUserStatus,
  moderationQueue,
  reviewEvent,
  listRefundRequests,
  reviewRefund,
  fraudMonitor,
};