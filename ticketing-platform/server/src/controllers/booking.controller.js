const Event = require('../models/Event');
const Booking = require('../models/Booking');
const Ticket = require('../models/Ticket');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const { asyncHandler, ok } = require('../utils/asyncHandler');
const inventory = require('../services/inventory.service');
const notificationService = require('../services/notification.service');
const emailService = require('../services/email.service');
const { signQr, generateQrDataUrl } = require('../utils/qr');
const { nanoid } = require('nanoid');
const { audit } = require('../utils/audit');

const REFERENCE_PREFIX = 'EE';

const unitPriceFor = (category, date) => {
  const now = new Date();
  if (category.earlyBirdPrice != null && category.earlyBirdEnd && now <= new Date(category.earlyBirdEnd))
    return { price: category.earlyBirdPrice, isEarlyBird: true };
  return { price: category.price, isEarlyBird: false };
};

const lineTotals = (event, items) => {
  if (!Array.isArray(items)) throw ApiError.badRequest('Items must be an array');

  return items.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw ApiError.badRequest('Each booking item must be an object');

    // Resolve the session (date) for this line item. Defaults to the event's
    // single session when it has only one date, otherwise required.
    let sessionId = item.sessionId ? String(item.sessionId) : null;
    let session = null;
    if ((event.sessions || []).length === 1 && !sessionId) {
      session = event.sessions[0];
      sessionId = String(session._id);
    } else if (sessionId) {
      session = (event.sessions || []).find((s) => String(s._id) === sessionId);
    }
    if (!session) throw ApiError.badRequest('Select which date of the event you want to attend');
    if (!(event.sessions || []).length) session = { _id: 'legacy', date: event.startDate };

    const categoryId = String(item.categoryId || '');
    const category = event.ticketCategories.find((c) => String(c._id) === categoryId);
    if (!category) throw ApiError.badRequest('Unknown ticket category');

    const qty = Number(item.qty);
    if (!Number.isInteger(qty) || qty < 1)
      throw ApiError.badRequest(`Invalid quantity for ${category.name}`);

    if (category.minPerOrder && qty < category.minPerOrder)
      throw ApiError.badRequest(`Minimum ${category.minPerOrder} ticket(s) per order for ${category.name}`);
    if (category.maxPerOrder && qty > category.maxPerOrder)
      throw ApiError.badRequest(`Maximum ${category.maxPerOrder} tickets per order for ${category.name}`);

    let seatIds = [];
    if (event.reservedSeating) {
      if (!Array.isArray(item.seatIds))
        throw ApiError.badRequest(`Seat selection for ${category.name} must be an array`);
      seatIds = item.seatIds.map((id) => String(id)).filter(Boolean);
      if (seatIds.length !== qty)
        throw ApiError.badRequest('Seat selection required and must match ticket quantity');
    }

    const { price, isEarlyBird } = unitPriceFor(category);

    let lineTotal = price * qty;
    let bundleApplied = false;
    const bundle = category.bundleOffer;
    if (bundle && bundle.qty > 0 && qty >= bundle.qty) {
      const bundles = Math.floor(qty / bundle.qty);
      const remainder = qty % bundle.qty;
      lineTotal = bundles * bundle.price + remainder * price;
      bundleApplied = true;
    }

    return { category, qty, price, isEarlyBird, bundleApplied, lineTotal, seatIds, sessionId, session };
  });
};

// Shared booking creation used by the REST endpoint AND the chatbot assistant.
// Reserves inventory, applies the selected discounts and returns the pending booking.
const createBookingForUser = async ({ user, eventId, items, entitlements }) => {
  if (!eventId || !Array.isArray(items) || !items.length)
    throw ApiError.badRequest('Event and items are required');

  const event = await Event.findById(eventId);
  if (!event) throw ApiError.notFound('Event not found');
  if (event.status !== 'published' || event.approval !== 'approved')
    throw ApiError.badRequest('This event is not on sale');

  const computed = lineTotals(event, items);

  const subtotal = computed.reduce((s, c) => s + c.lineTotal, 0);

  // --- Inventory reservation ---
  const heldSeats = [];
  const holdExpiresAt = new Date(Date.now() + inventory.SEAT_HOLD_MINUTES * 60 * 1000);

  for (const c of computed) {
    if (event.reservedSeating) {
      const res = await inventory.holdSpecificSeats({
        eventId: event._id,
        userId: user._id,
        seatIds: c.seatIds,
        sessionId: c.sessionId,
      });
      c.reservation = res;
      c.releaseToken = res.token;
      c.heldUntil = res.heldUntil;
      heldSeats.push(...res.seats);
    } else {
      await inventory.reserveGa(event._id, c.sessionId, c.category._id, c.qty);
      c.releaseToken = null;
    }
  }

  // --- Discounts ---
  // Only voucher / loyalty gift card entitlements discount a booking now; promo
  // codes were removed from the product.
  let discount = 0;
  let discountName = null;

  // An explicit selection stacks and is honoured exactly as chosen; omitting the
  // field entirely falls back to auto-applying the best single entitlement
  // (chatbot + plain API callers).
  let voucherEntitlement = null;
  let voucherRedemptionIds = [];
  let voucherLabels = [];
  {
    const { voucherEntitlementFor, resolveEntitlements } = require('./voucher.controller');
    if (Array.isArray(entitlements)) {
      const resolved = await resolveEntitlements({
        userId: user._id,
        eventId: event._id,
        subtotal,
        entitlementIds: entitlements,
      });
      discount += resolved.discount;
      voucherRedemptionIds = resolved.entitlements.map((e) => e._id);
      voucherLabels = resolved.labels;
      voucherEntitlement = resolved.entitlements[0] || null;
    } else {
      const applied = await voucherEntitlementFor({ userId: user._id, eventId: event._id, subtotal });
      if (applied.entitlement) {
        discount += applied.discount;
        discountName = applied.discountName;
        voucherEntitlement = applied.entitlement;
        voucherRedemptionIds = [applied.entitlement._id];
        voucherLabels = [applied.discountName];
      }
    }
    if (voucherLabels.length > 1) discountName = voucherLabels.join(' + ');
    else if (voucherLabels.length === 1) discountName = voucherLabels[0];
    discount = Math.min(discount, subtotal);
  }

  const total = Math.max(0, subtotal - discount);

  const booking = await Booking.create({
    reference: `${REFERENCE_PREFIX}-${nanoid(8).toUpperCase()}`,
    user: user._id,
    event: event._id,
    voucherRedemptions: voucherRedemptionIds.length ? voucherRedemptionIds : undefined,
    voucherRedemption: voucherEntitlement ? voucherEntitlement._id : undefined,
    items: computed.map((c) => ({
      sessionId: c.session._id,
      sessionDate: c.session.date,
      categoryId: c.category._id,
      categoryName: c.category.name,
      tier: c.category.tier,
      unitPrice: c.price,
      qty: c.qty,
      seats: c.seatIds.length
        ? heldSeats.filter((s) => c.seatIds.map(String).includes(String(s._id))).map((s) => ({
            seatId: s._id,
            section: s.section,
            row: s.row,
            number: s.number,
            label: `${s.section} ${s.row}${s.number}`,
          }))
        : [],
      bundleApplied: c.bundleApplied,
      lineTotal: c.lineTotal,
    })),
    subtotal,
    discount,
    discountName,
    total,
    status: 'pending',
    holdExpiresAt,
  });

  // Lock the redeemed entitlements to this booking now that it exists.
  if (voucherRedemptionIds.length) {
    const { consumeVoucherRedemptions } = require('./voucher.controller');
    await consumeVoucherRedemptions(voucherRedemptionIds, booking._id);
  }

  // Persist seat hold tokens so payment confirmation can lock the exact seats.
  if (event.reservedSeating) {
    const seatIds = computed.flatMap((c) => c.seatIds);
    const tokens = [...new Set(computed.map((c) => c.reservation && c.reservation.token).filter(Boolean))];
    await require('../models/Seat').updateMany(
      { _id: { $in: seatIds }, status: 'held' },
      { $set: { bookingId: booking._id } }
    );
    if (tokens.length) {
      booking.holdTokens = tokens;
      await booking.save();
    }
  }

  // release hold timer: cancel pending booking if unpaid
  setTimeout(async () => {
    try {
      const b = await Booking.findById(booking._id);
      if (b && b.status === 'pending') {
        await cancelAndRelease(b, 'hold_expired');
      }
    } catch (e) {
      console.error('[booking] hold expiry cleanup failed', e.message);
    }
  }, inventory.SEAT_HOLD_MINUTES * 60 * 1000);

  return {
    booking,
    event,
    holdExpiresAt,
    seatsHeld: heldSeats.map((s) => ({ id: s._id, label: `${s.section} ${s.row}${s.number}` })),
    discount: discount > 0 ? { name: discountName, amount: discount } : null,
  };
};

const createBooking = asyncHandler(async (req, res) => {
  const result = await createBookingForUser({
    user: req.user,
    eventId: req.body.eventId,
    items: req.body.items,
    entitlements: req.body.entitlements,
  });

  await audit(req, { action: 'booking.create', targetType: 'Booking', targetId: result.booking._id, note: `pending ${result.booking.total}` });

  ok(res, result, 201);
});

// Re-price a pending booking from a new selection of voucher / gift card
// entitlements. Anything already locked to this booking is released first, so
// switching a selection in the checkout dropdown never burns credit.
const applyBookingEntitlements = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const booking = await Booking.findOne({ _id: id, user: req.user._id }).populate('event');
  if (!booking) throw ApiError.notFound('Booking not found');
  if (booking.status !== 'pending')
    throw ApiError.badRequest('Discounts can only be changed before payment');
  if (booking.holdExpiresAt && booking.holdExpiresAt <= new Date())
    throw ApiError.badRequest('This booking hold has expired — please start again');

  const { resolveEntitlements, releaseVoucherRedemption, consumeVoucherRedemptions } = require('./voucher.controller');

  // Validate against the old total-free subtotal before touching any state.
  const resolved = await resolveEntitlements({
    userId: req.user._id,
    eventId: booking.event,
    subtotal: booking.subtotal,
    entitlementIds: req.body.entitlements,
  });

  await releaseVoucherRedemption(booking);

  booking.voucherRedemptions = resolved.entitlements.map((e) => e._id);
  booking.voucherRedemption = resolved.entitlements[0] ? resolved.entitlements[0]._id : undefined;
  booking.discount = resolved.discount;
  booking.discountName = resolved.labels.length ? resolved.labels.join(' + ') : undefined;
  booking.total = Math.max(0, booking.subtotal - resolved.discount);
  await booking.save();

  await consumeVoucherRedemptions(booking.voucherRedemptions, booking._id);

  await audit(req, {
    action: 'booking.applyEntitlements',
    targetType: 'Booking',
    targetId: booking._id,
    note: booking.discountName || 'none',
  });

  // Populate the redeemed vouchers too, so the client can keep showing what is
  // applied after the change instead of the confirmation vanishing.
  // Nested object form on purpose: `.populate('voucherRedemptions.voucher')` is a
  // silent no-op on this array, which left the client with no applied-reward
  // details to show after the change.
  const fresh = await Booking.findById(booking._id)
    .populate('event')
    .populate({ path: 'voucherRedemptions', populate: { path: 'voucher' } });
  ok(res, { booking: fresh, applied: resolved.items });
});

const getMyBooking = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const booking = await Booking.findOne({ _id: id, user: req.user._id })
    .populate('event')
    .populate('tickets')
    .populate({ path: 'voucherRedemptions', populate: { path: 'voucher' } });
  if (!booking) throw ApiError.notFound('Booking not found');
  ok(res, { booking });
});

const myBookings = asyncHandler(async (req, res) => {
  const bookings = await Booking.find({ user: req.user._id })
    .sort({ createdAt: -1 })
    .populate('event', 'title slug image startDate venue category')
    .populate('tickets');
  ok(res, { bookings });
});

// ---- internal finalize used by payment controller ----
// Uses an atomic findOneAndUpdate to claim the booking from 'pending' → 'confirmed'.
// This prevents the race condition where both the Stripe webhook and the browser
// success page call finalizePayment concurrently and both create tickets.
const finalizePayment = async ({ bookingId, provider, method, intentId, amount }) => {
  const now = new Date();

  // Atomically claim: only the first caller transitions status from pending → confirmed.
  const booking = await Booking.findOneAndUpdate(
    { _id: bookingId, status: 'pending' },
    {
      $set: {
        status: 'confirmed',
        payment: { provider, method, intentId, status: 'succeeded' },
      },
      $push: {
        audit: { at: now, action: 'payment.confirmed', by: bookingId, note: provider },
      },
    },
    { new: true }
  ).populate('event').populate('user');

  if (!booking) {
    // Already confirmed (by concurrent call) or in another terminal state.
    const existing = await Booking.findById(bookingId);
    if (existing && existing.status === 'confirmed') return existing;
    throw ApiError.conflict('Booking is no longer awaiting payment');
  }

  const event = booking.event;

  // Create tickets with QR codes.
  const tickets = [];
  for (const item of booking.items) {
    for (let i = 0; i < item.qty; i++) {
      const seat = item.seats && item.seats[i] ? item.seats[i] : null;
      const seatLabel = seat ? seat.label : 'General admission';
      const ticket = await Ticket.create({
        user: booking.user,
        event: event._id,
        booking: booking._id,
        sessionId: item.sessionId,
        sessionDate: item.sessionDate || event.startDate,
        categoryName: item.categoryName,
        tier: item.tier,
        seatLabel,
        price: item.unitPrice,
        qrData: signQr(`EVENTEASE:v1:event=${event._id}:t=${Math.random().toString(36).slice(2)}`),
      });
      ticket.qrCode = await generateQrDataUrl(ticket.qrData);
      await ticket.save();
      tickets.push(ticket);
    }
  }

  // Lock seats to this booking.
  const seatIds = booking.items.flatMap((it) => it.seats.map((s) => s.seatId)).filter(Boolean);
  const tokens = booking.holdTokens || [];
  await inventory.bookSeats({ bookingId: booking._id, seatIds, tokens });

  // Move GA holds → sold.
  await Event.updateMany({ _id: event._id }, { $inc: { salesCount: 1 } });
  const hasSessions = (event.sessions || []).length > 0;
  for (const item of booking.items) {
    if (!item.seats || item.seats.length === 0) {
      // GA: decrement held, increment sold on the specific session's availability.
      // Legacy events without sessions use top-level category counters instead.
      if (hasSessions) {
        await Event.updateOne(
          { _id: event._id, 'sessions._id': item.sessionId },
          { $inc: { 'sessions.$.availability.$[a].held': -item.qty, 'sessions.$.availability.$[a].sold': item.qty } },
          { arrayFilters: [{ 'a.categoryId': String(item.categoryId) }] }
        );
      } else {
        await Event.updateOne(
          { _id: event._id, 'ticketCategories._id': String(item.categoryId) },
          { $inc: { 'ticketCategories.$.held': -item.qty, 'ticketCategories.$.sold': item.qty } }
        );
      }
    } else {
      // Reserved seats: increment sold on the specific session's availability
      await Event.updateOne(
        { _id: event._id, 'sessions._id': item.sessionId },
        { $inc: { 'sessions.$.availability.$[a].sold': item.qty } },
        { arrayFilters: [{ 'a.categoryId': String(item.categoryId) }] }
      );
    }
  }
  await Event.updateOne({ _id: event._id }, { $inc: { revenue: booking.total } });

  booking.tickets = tickets.map((t) => t._id);
  await booking.save();

  await User.updateOne({ _id: booking.user }, { $inc: { loyaltyPoints: Math.floor(booking.total) } });

  // Notifications + email with QR e-tickets.
  const user = booking.user;
  const html = emailService.renderBookingConfirmation({ user, booking, event, tickets });
  await notificationService.notify(user, {
    kind: 'booking.confirmed',
    subject: `EventEase · Booking ${booking.reference} confirmed 🎉`,
    title: `Booking confirmed: ${event.title}`,
    body: `Your booking ${booking.reference} for ${event.title} is confirmed. Total ${booking.currency} ${booking.total}. Check your e-tickets.`,
    html,
    link: `/account?booking=${booking.reference}`,
  });

  return booking;
};

// Ticket states that make a booking ineligible for a refund. A partially scanned
// ticket keeps its 'active' status until it is fully admitted, so entryCount is
// checked too rather than relying on the status alone.
const REFUND_BLOCKING_TICKET_STATUS = {
  resale_listed: 'listed for resale',
  used: 'already used for entry',
  transferred: 'transferred to someone else',
};

// Tickets on this booking that make it ineligible for a refund. Exported so the
// admin refund queue can show the problem before an approval is attempted.
const refundBlockers = async (bookingId) => Ticket.find({
  booking: bookingId,
  $or: [
    { status: { $in: Object.keys(REFUND_BLOCKING_TICKET_STATUS) } },
    // A partly scanned ticket is still 'active', so entryCount catches it.
    { status: 'active', $expr: { $gt: [{ $ifNull: ['$entryCount', 0] }, 0] } },
  ],
})
  .select('status seatLabel entryCount')
  .lean();

const refundBlockedError = (booking, blockers) => {
  const reasons = [...new Set(blockers.map((t) => REFUND_BLOCKING_TICKET_STATUS[t.status] || 'already used for entry'))];
  const seats = blockers.slice(0, 3).map((t) => t.seatLabel).filter(Boolean);
  return ApiError.badRequest(
    `${booking.reference} cannot be refunded: ${blockers.length} of its tickets are ${reasons.join(' and ')}`
    + (seats.length ? ` (${seats.join(', ')}${blockers.length > seats.length ? ', \u2026' : ''})` : '')
    + '. Settle the resale or transfer first.'
  );
};

// Cancel / refund (used by cancel endpoint + hold expiry).
const cancelAndRelease = async (booking, reason, byUser) => {
  const event = await Event.findById(booking.event);
  const seatIds = booking.items.flatMap((it) => it.seats.map((s) => s.seatId)).filter(Boolean);

  // A refund request must remain pending until an admin explicitly approves it.
  if (booking.status === 'refund_pending' && reason !== 'refunded') {
    return booking;
  }

  // Refunding after a ticket was resold, scanned in, or handed to someone else
  // would take the money back for admission the customer has already had. Checked
  // before anything is released so a refused refund leaves the booking untouched.
  if (reason === 'refunded') {
    const blockers = await refundBlockers(booking._id);
    if (blockers.length) throw refundBlockedError(booking, blockers);
  }

  if (booking.status === 'confirmed' || (booking.status === 'refund_pending' && reason === 'refunded')) {
    await Ticket.updateMany({ booking: booking._id }, { $set: { status: 'refunded' } });
    // release booked seats
    await require('../models/Seat').updateMany(
      { _id: { $in: seatIds }, status: 'booked' },
      { $set: { status: 'available' }, $unset: { bookingId: 1 } }
    );
    for (const item of booking.items) {
      await Event.updateOne(
        { _id: event._id, 'sessions._id': item.sessionId },
        { $inc: { 'sessions.$.availability.$[a].sold': -item.qty } },
        { arrayFilters: [{ 'a.categoryId': String(item.categoryId) }] }
      );
    }
    await Event.updateOne({ _id: event._id }, { $inc: { salesCount: -1, revenue: -booking.total } });
  } else if (booking.status === 'pending') {
    for (const item of booking.items) {
      if (item.seats && item.seats.length) {
        // Only release seats still held for THIS booking (by hold token or the
        // booking stamp). A previous releaseExpiredHolds sweep may have freed
        // them and another customer may have re-held them since.
        await require('../models/Seat').updateMany(
          {
            _id: { $in: item.seats.map((s) => s.seatId) },
            status: 'held',
            $or: [
              { holdToken: { $in: booking.holdTokens || [] } },
              { bookingId: booking._id },
            ],
          },
          { $set: { status: 'available' }, $unset: { heldBy: 1, heldUntil: 1, holdToken: 1, bookingId: 1 } }
        );
      } else {
        await inventory.releaseGa(event._id, item.sessionId, item.categoryId, item.qty);
      }
    }
  }

  const wasRefunded = reason === 'refunded';
  booking.status = wasRefunded ? 'refunded' : 'cancelled';
  booking.cancelReason = reason;
  booking.audit.push({ at: new Date(), action: 'booking.cancelled', by: byUser, note: reason });
  await booking.save();

  // Always hand the redeemed entitlement back. The money is coming off the card
  // again, so the customer's voucher must not stay burnt either.
  const { releaseVoucherRedemption } = require('./voucher.controller');
  await releaseVoucherRedemption(booking);

  // Payment granted loyalty points off the total; a refund gives that money back,
  // so the points are taken off again. Guarded by an audit entry so an approved
  // refund replayed twice cannot claw them back twice.
  if (wasRefunded && !booking.audit.some((a) => a.action === 'refund.loyalty_reversed')) {
    const granted = Math.floor(booking.total || 0);
    if (granted > 0) {
      await User.updateOne({ _id: booking.user }, { $inc: { loyaltyPoints: -granted } });
    }
    booking.audit.push({
      at: new Date(),
      action: 'refund.loyalty_reversed',
      by: byUser,
      note: `-${granted}`,
    });
    await booking.save();
  }
  return booking;
};

// Durable fallback for the per-booking in-memory setTimeout: cancels pending
// bookings whose seat hold has expired. Recovers bookings created right before
// a server restart (when the timer was lost) and GA bookings that the
// seat-based releaseExpiredHolds sweep doesn't cover.
const expirePendingBookings = async () => {
  const now = new Date();
  const expired = await Booking.find({ status: 'pending', holdExpiresAt: { $lte: now } }).limit(200);
  for (const booking of expired) {
    try {
      await cancelAndRelease(booking, 'hold_expired');
      console.log(`[booking] expired pending booking ${booking.reference}`);
    } catch (e) {
      console.error(`[booking] failed to expire booking ${booking._id}:`, e.message);
    }
  }
  return expired.length;
};

const cancelBooking = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const booking = await Booking.findOne({ _id: id, user: req.user._id });
  if (!booking) throw ApiError.notFound('Booking not found');
  if (booking.status === 'refund_pending') {
    throw ApiError.badRequest('A refund request for this booking is already pending admin approval.');
  }

  const event = await Event.findById(booking.event);
  // Use the earliest session date from the booking items for refund policy
  const earliestSession = booking.items
    .map((i) => i.sessionDate)
    .filter(Boolean)
    .sort((a, b) => new Date(a) - new Date(b))[0] || event.startDate;
  const hoursToEvent = (new Date(earliestSession) - Date.now()) / 36e5;

  if (booking.status === 'confirmed') {
    booking.status = 'refund_pending';
    booking.cancelReason = 'refund_requested';
    booking.audit.push({ at: new Date(), action: 'refund.requested', by: req.user._id, note: 'Waiting for admin approval' });
    await booking.save();

    await notificationService.notify(req.user, {
      kind: 'booking.cancelled',
      subject: `EventEase · Refund request submitted for ${booking.reference}`,
      title: 'Refund request submitted',
      body: `Your refund request for booking ${booking.reference} for ${event.title} is pending admin approval.`,
    });

    await audit(req, { action: 'booking.refund_requested', targetType: 'Booking', targetId: booking._id, note: 'refund_pending' });
    return ok(res, { booking, message: 'Refund request submitted. It is pending admin approval.' });
  }

  const cancelled = await cancelAndRelease(booking, 'cancelled', req.user._id);

  await notificationService.notify(req.user, {
    kind: 'booking.cancelled',
    subject: `EventEase · Booking ${booking.reference} cancelled`,
    title: 'Booking cancelled',
    body: `Your booking ${booking.reference} for ${event.title} was cancelled.`,
  });

  await audit(req, { action: 'booking.cancel', targetType: 'Booking', targetId: booking._id, note: cancelled.status });
  ok(res, { booking: cancelled, message: 'Booking cancelled.' });
});

module.exports = { createBookingForUser, createBooking, applyBookingEntitlements, getMyBooking, myBookings, finalizePayment, cancelBooking, cancelAndRelease, expirePendingBookings, lineTotals, refundBlockers, REFUND_BLOCKING_TICKET_STATUS };