const Voucher = require('../models/Voucher');
const VoucherRedemption = require('../models/VoucherRedemption');
const Event = require('../models/Event');
const ApiError = require('../utils/ApiError');
const { asyncHandler, ok } = require('../utils/asyncHandler');
const notificationService = require('../services/notification.service');
const { audit } = require('../utils/audit');
const { nanoid } = require('nanoid');

// How long a loyalty gift card stays redeemable for.
const GIFT_CARD_VALID_DAYS = 365;

const normalizeVoucher = async (req, res) => {
  const {
    code,
    title,
    description,
    eventId,
    type,
    value,
    maxDiscount,
    minSpend,
    usageLimit,
    perUserLimit,
    startsAt,
    expiresAt,
    active,
  } = req.body;

  if (!code || !title) throw ApiError.badRequest('Code and title are required');
  if (value == null) throw ApiError.badRequest('Voucher value is required');
  const event = await Event.findById(eventId);
  if (!event) throw ApiError.notFound('Selected event not found');
  if (event.status !== 'published' || event.approval !== 'approved')
    throw ApiError.badRequest('Vouchers can only be attached to live, approved events');

  const existing = await Voucher.findOne({ code: code.trim().toUpperCase() });
  if (existing) throw ApiError.badRequest('That voucher code already exists');

  const voucher = await Voucher.create({
    code: code.trim().toUpperCase(),
    title,
    description,
    event: event._id,
    type: type === 'fixed' ? 'fixed' : 'percent',
    value: Number(value),
    maxDiscount: maxDiscount != null ? Number(maxDiscount) : undefined,
    minSpend: minSpend != null ? Number(minSpend) : 0,
    usageLimit: usageLimit != null ? Number(usageLimit) : undefined,
    perUserLimit: perUserLimit != null ? Number(perUserLimit) : 1,
    startsAt,
    expiresAt,
    active: active !== false,
    createdBy: req.user._id,
  });

  await audit(req, { action: 'admin.voucher.create', targetType: 'Voucher', targetId: voucher._id, note: `${voucher.code} → ${event.title}` });
  return ok(res, { voucher }, 201);
};

const create = asyncHandler(normalizeVoucher);

const listAll = asyncHandler(async (req, res) => {
  const vouchers = await Voucher.find().sort({ createdAt: -1 }).populate('event', 'title slug startDate venue');
  ok(res, { vouchers });
});

const myRedemptions = asyncHandler(async (req, res) => {
  const redemptions = await VoucherRedemption.find({ user: req.user._id })
    .sort({ createdAt: -1 })
    .populate('voucher', 'code title type value maxDiscount minSpend')
    .populate('event', 'title slug image startDate venue');
  ok(res, { redemptions });
});

// Redeem a code: creates an entitlement for this user on the voucher's event.
const redeem = asyncHandler(async (req, res) => {
  const { code } = req.body;
  if (!code) throw ApiError.badRequest('Redemption code required');

  const voucher = await Voucher.findOne({ code: code.trim().toUpperCase() }).populate('event', 'title slug image startDate venue');
  if (!voucher) throw ApiError.notFound('Invalid voucher code');

  const now = new Date();
  if (!voucher.active) throw ApiError.badRequest('This voucher is no longer active');
  if (voucher.startsAt && now < voucher.startsAt) throw ApiError.badRequest('This voucher has not started yet');
  if (voucher.expiresAt && now > voucher.expiresAt) throw ApiError.badRequest('This voucher has expired');
  if (voucher.usageLimit && voucher.usedCount >= voucher.usageLimit)
    throw ApiError.badRequest('This voucher has been fully redeemed');

  const already = await VoucherRedemption.countDocuments({ user: req.user._id, voucher: voucher._id });
  if (already >= (voucher.perUserLimit || 1))
    throw ApiError.badRequest(`You have already redeemed this voucher ${already} time(s)`);

  const redemption = await VoucherRedemption.create({
    user: req.user._id,
    voucher: voucher._id,
    event: voucher.event._id,
    used: false,
  });

  await audit(req, { action: 'voucher.redeem', targetType: 'Voucher', targetId: voucher._id, note: `redeemed by ${req.user._id}` });

  ok(res, {
    redemption,
    voucher: {
      code: voucher.code,
      title: voucher.title,
      type: voucher.type,
      value: voucher.value,
      event: voucher.event,
    },
    message: `Voucher ${voucher.code} redeemed — valid for ${voucher.event?.title}. Your discount applies automatically at checkout.`,
  }, 201);
});

// Mint a platform-wide gift card for a customer who spent loyalty points on a
// gift card reward. The entitlement applies automatically to their next booking
// on any event, and is consumed once that booking is paid for.
const issueGiftCard = async ({ userId, title, value, description }) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0)
    throw ApiError.badRequest('This gift card has no monetary value configured');

  const voucher = await Voucher.create({
    code: `GIFT-${nanoid(8).toUpperCase()}`,
    title,
    description: description || `${amount} off any booking on EventEase.`,
    event: null,
    source: 'loyalty',
    type: 'fixed',
    value: amount,
    minSpend: 0,
    perUserLimit: 1,
    expiresAt: new Date(Date.now() + GIFT_CARD_VALID_DAYS * 24 * 60 * 60 * 1000),
    active: true,
  });

  const redemption = await VoucherRedemption.create({
    user: userId,
    voucher: voucher._id,
    event: null,
  });

  return { voucher, redemption };
};

// Dropdown data for checkout: what this customer can spend on the given booking.
// Accepts a bookingId (preferred — derives user, event and exact subtotal) or a
// raw eventId + subtotal for previews.
const available = asyncHandler(async (req, res) => {
  const { bookingId, eventId, subtotal } = req.query;

  let resolvedEventId = eventId;
  let resolvedSubtotal = Number(subtotal);
  let bookingDoc = null;

  if (bookingId) {
    const Booking = require('../models/Booking');
    const booking = await Booking.findOne({ _id: bookingId, user: req.user._id });
    if (!booking) throw ApiError.notFound('Booking not found');
    bookingDoc = booking;
    resolvedEventId = booking.event;
    resolvedSubtotal = booking.subtotal;
  }

  if (!resolvedEventId) throw ApiError.badRequest('An event or booking is required');
  if (!Number.isFinite(resolvedSubtotal) || resolvedSubtotal < 0) throw ApiError.badRequest('A subtotal is required');

  const entitlements = await listAvailableEntitlements({
    userId: req.user._id,
    eventId: resolvedEventId,
    subtotal: resolvedSubtotal,
  });

  // Applying a reward consumes it, which drops it out of `listAvailableEntitlements`.
  // Without sending what is already on this booking the customer could see a
  // discount in the total with nothing ticked, and had no way to take it off.
  let applied = [];
  if (bookingDoc && (bookingDoc.voucherRedemptions || []).length) {
    const VoucherRedemptionModel = require('../models/VoucherRedemption');
    const used = await VoucherRedemptionModel.find({
      _id: { $in: bookingDoc.voucherRedemptions },
      usedBooking: bookingDoc._id,
    })
      .populate('voucher')
      .populate('event', 'title');
    applied = used
      .map((e) => {
        const described = describeEntitlement(e, entitlementValue(e, resolvedSubtotal));
        return described ? { ...described, applied: true } : null;
      })
      .filter(Boolean);
  }

  ok(res, { entitlements, applied });
});

// ---- Used by booking controller ----

// Computes what one entitlement is worth against a given subtotal, or null when
// it cannot be used here (wrong event, inactive, expired, or min spend unmet).
const entitlementValue = (entitlement, subtotal) => {
  const v = entitlement.voucher;
  if (!v || !v.active) return null;
  const now = new Date();
  if (v.startsAt && now < v.startsAt) return null;
  if (v.expiresAt && now > v.expiresAt) return null;
  if (v.minSpend && subtotal < v.minSpend) return null;

  let discount = v.type === 'percent' ? (subtotal * v.value) / 100 : v.value;
  if (v.maxDiscount) discount = Math.min(discount, v.maxDiscount);
  discount = Math.min(discount, subtotal);
  return discount > 0 ? discount : null;
};

const describeEntitlement = (entitlement, discount) => ({
  id: entitlement._id,
  code: entitlement.voucher.code,
  title: entitlement.voucher.title,
  type: entitlement.voucher.type,
  value: entitlement.voucher.value,
  discount,
  isGiftCard: !entitlement.event,
  event: entitlement.event,
  expiresAt: entitlement.voucher.expiresAt,
});

// Every unused entitlement this customer could spend on this booking: the ones
// scoped to the event, plus all platform-wide ones (loyalty gift cards). Used to
// populate the checkout dropdown. Sorted best-value first.
const listAvailableEntitlements = async ({ userId, eventId, subtotal }) => {
  const entitlements = await VoucherRedemption.find({
    user: userId,
    used: false,
    $or: [{ event: eventId }, { event: null }],
  })
    .populate('voucher')
    .populate('event', 'title');

  return entitlements
    .map((e) => {
      const discount = entitlementValue(e, subtotal);
      return discount ? describeEntitlement(e, discount) : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.discount - a.discount);
};

// Resolves an explicit selection of entitlements and stacks their discounts.
// Throws if any id is not the customer's, is already spent, or cannot be used on
// this booking — silently dropping one would charge the customer full price for
// a discount they were shown.
const resolveEntitlements = async ({ userId, eventId, subtotal, entitlementIds }) => {
  const ids = [...new Set((entitlementIds || []).map(String))].filter(Boolean);
  if (!ids.length) return { discount: 0, labels: [], items: [], entitlements: [] };

  // Callers routinely load the booking with .populate('event'), so `eventId` can
  // arrive as a populated document rather than a raw id. Compare on the raw id or
  // an event-scoped voucher is wrongly rejected as belonging to another event.
  const rawEventId = eventId && typeof eventId === 'object' ? eventId._id : eventId;

  const entitlements = await VoucherRedemption.find({ _id: { $in: ids }, user: userId })
    .populate('voucher')
    .populate('event', 'title');

  if (entitlements.length !== ids.length)
    throw ApiError.notFound('One or more selected rewards could not be found');

  const applied = [];
  for (const e of entitlements) {
    if (e.used) throw ApiError.badRequest(`${e.voucher?.title || 'That reward'} has already been used`);
    if (e.event && String(e.event._id) !== String(rawEventId))
      throw ApiError.badRequest(`${e.voucher?.title || 'That reward'} is not valid for this event`);
    const discount = entitlementValue(e, subtotal);
    if (!discount) throw ApiError.badRequest(`${e.voucher?.title || 'That reward'} cannot be used on this booking`);
    applied.push({ entitlement: e, discount });
  }

  // Never discount below zero. The combined total is what the customer is
  // actually charged off, so it is what every line is scaled down to.
  const rawTotal = applied.reduce((s, a) => s + a.discount, 0);
  const discount = Math.min(subtotal, rawTotal);
  const scale = rawTotal > 0 ? discount / rawTotal : 0;

  return {
    discount,
    labels: applied.map((a) => a.entitlement.voucher.title || a.entitlement.voucher.code),
    // Per-item amounts share the capped total, so the lines always add up to the
    // discount actually applied.
    items: applied.map((a) => ({
      id: a.entitlement._id,
      title: a.entitlement.voucher.title || a.entitlement.voucher.code,
      code: a.entitlement.voucher.code,
      discount: Math.round(a.discount * scale * 100) / 100,
    })),
    entitlements: applied.map((a) => a.entitlement),
  };
};

// Returns the best single entitlement for this booking without consuming it.
// Used when no explicit selection was made (chatbot bookings, plain API calls).
const voucherEntitlementFor = async ({ userId, eventId, subtotal }) => {
  const available = await listAvailableEntitlements({ userId, eventId, subtotal });
  if (!available.length) return { discount: 0, discountName: null, entitlement: null };

  // An event-specific entitlement always beats generic platform-wide credit.
  const scoped = available.filter((a) => a.event);
  const best = scoped.length
    ? scoped.reduce((a, b) => (b.discount > a.discount ? b : a))
    : available[0];
  const entitlement = await VoucherRedemption.findById(best.id).populate('voucher');

  return { discount: best.discount, discountName: best.title || best.code, entitlement };
};

// Marks entitlements as consumed once their booking exists. The `used: false`
// guard keeps a concurrent request from double-consuming the same credit.
const consumeVoucherRedemptions = async (entitlementIds, bookingId) => {
  const ids = [...new Set((entitlementIds || []).map(String))].filter(Boolean);
  if (!ids.length || !bookingId) return;
  await VoucherRedemption.updateMany(
    { _id: { $in: ids }, used: false },
    { $set: { used: true, usedBooking: bookingId, usedAt: new Date() } }
  ).catch(() => {});
};

const consumeVoucherRedemption = (entitlementId, bookingId) =>
  consumeVoucherRedemptions([entitlementId], bookingId);

// If a booking that consumed entitlements is cancelled or its hold expires before
// payment, give every one of them back to the customer. Handles both the current
// `voucherRedemptions` array and the legacy single `voucherRedemption` ref.
const releaseVoucherRedemption = async (booking) => {
  if (!booking) return;
  const ids = [
    ...(booking.voucherRedemptions || []).map(String),
    ...(booking.voucherRedemption ? [String(booking.voucherRedemption)] : []),
  ];
  if (!ids.length) return;
  await VoucherRedemption.updateMany(
    { _id: { $in: [...new Set(ids)] }, usedBooking: booking._id },
    { $set: { used: false, usedAt: null }, $unset: { usedBooking: 1 } }
  ).catch(() => {});
};

module.exports = {
  create,
  listAll,
  myRedemptions,
  redeem,
  available,
  issueGiftCard,
  listAvailableEntitlements,
  resolveEntitlements,
  voucherEntitlementFor,
  consumeVoucherRedemption,
  consumeVoucherRedemptions,
  releaseVoucherRedemption,
};