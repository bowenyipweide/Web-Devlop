const Ticket = require('../models/Ticket');
const Booking = require('../models/Booking');
const Event = require('../models/Event');
const ResaleListing = require('../models/ResaleListing');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const { asyncHandler, ok } = require('../utils/asyncHandler');
const { verifyQr, generateQrDataUrl } = require('../utils/qr');
const notificationService = require('../services/notification.service');
const emailService = require('../services/email.service');
const { nanoid } = require('nanoid');
const { audit } = require('../utils/audit');

const myTickets = asyncHandler(async (req, res) => {
  const tickets = await Ticket.find({ user: req.user._id, status: { $in: ['active', 'resale_listed', 'used'] } })
    .populate('event', 'title slug image startDate endDate venue category');
  // Sort by the ticket's session/event date so the nearest date comes first.
  tickets.sort((a, b) => {
    const da = new Date(a.sessionDate || a.event?.startDate || 0).getTime();
    const db = new Date(b.sessionDate || b.event?.startDate || 0).getTime();
    return da - db;
  });
  ok(res, { tickets });
});

const detail = asyncHandler(async (req, res) => {
  const { code } = req.params;
  const ticket = await Ticket.findOne({ code: code.toUpperCase() }).populate('event').populate('booking');
  if (!ticket) throw ApiError.notFound('Ticket not found');
  const isOwner = String(ticket.user) === String(req.user._id);
  const isOrg = req.user.role === 'admin' || (req.user.role === 'organizer' && String(ticket.event.owner) === String(req.user._id));
  if (!isOwner && !isOrg) throw ApiError.forbidden('Not your ticket');

  if (!ticket.qrCode) {
    ticket.qrCode = await generateQrDataUrl(ticket.qrData);
    await ticket.save();
  }
  ok(res, { ticket });
});

// ---- QR validation at entry (organizer / admin) ----
const validate = asyncHandler(async (req, res) => {
  const { code, qrData } = req.body;
  if (!code && !qrData) throw ApiError.badRequest('Provide a ticket code or QR data');

  let ticket = null;
  if (code) {
    ticket = await Ticket.findOne({ code: String(code).toUpperCase() }).populate('event');
  } else if (qrData) {
    if (!verifyQr(qrData)) throw ApiError.badRequest('QR signature invalid — possible forgery');
    ticket = await Ticket.findOne({ qrData }).populate('event');
  }
  if (!ticket) throw ApiError.conflict('Ticket not recognised');

  const event = ticket.event;
  const isAllowed = req.user.role === 'admin' || String(event.owner) === String(req.user._id);
  if (!isAllowed) throw ApiError.forbidden('You are not authorised to validate this event');

  const eventStarted = new Date(ticket.sessionDate || event.startDate) <= new Date();
  if (req.body.strictEntry && !eventStarted)
    throw ApiError.badRequest('Entry validation not yet open');

  if (ticket.status === 'used') {
    return ok(res, { valid: false, reason: 'already_used', ticket: summary(ticket) });
  }
  if (ticket.status === 'refunded') {
    return ok(res, { valid: false, reason: 'refunded', ticket: summary(ticket) });
  }
  if (ticket.status === 'transferred') {
    return ok(res, { valid: false, reason: 'transferred', ticket: summary(ticket) });
  }

  ticket.entryCount = (ticket.entryCount || 0) + 1;
  if (ticket.entryCount >= (ticket.admissionCount || 1)) ticket.status = 'used';
  ticket.validatedAt = new Date();
  ticket.audit.push({ at: new Date(), action: 'entry.validated', by: req.user._id });
  await ticket.save();

  await audit(req, { action: 'ticket.validate', targetType: 'Ticket', targetId: ticket._id, note: ticket.entryCount });
  ok(res, { valid: true, entry: ticket.entryCount, allowedEntries: ticket.admissionCount, ticket: summary(ticket) });
});

const summary = (t) => ({
  code: t.code,
  status: t.status,
  seatLabel: t.seatLabel,
  sessionDate: t.sessionDate,
  entryCount: t.entryCount,
  title: t.event?.title,
  startDate: t.event?.startDate,
  venue: t.event?.venue,
});

// ---- Transfer ----
const initiateTransfer = asyncHandler(async (req, res) => {
  const { code } = req.params;
  const ticket = await Ticket.findOne({ code: code.toUpperCase(), user: req.user._id });
  if (!ticket) throw ApiError.notFound('Ticket not found or not yours');
  if (ticket.status !== 'active') throw ApiError.badRequest('Only active tickets can be transferred');

  if (!ticket.transfer || !ticket.transfer.code) {
    ticket.transfer = { code: nanoid(8).toUpperCase() };
    await ticket.save();
  }
  ok(res, {
    transferCode: ticket.transfer.code,
    link: `${process.env.CLIENT_URL}/transfer/${ticket.transfer.code}`,
  });
});

const claimTransfer = asyncHandler(async (req, res) => {
  const { transferCode } = req.params;
  const ticket = await Ticket.findOne({ 'transfer.code': transferCode.toUpperCase() })
    .populate('event')
    .populate('user');
  if (!ticket) throw ApiError.notFound('Invalid transfer code');
  if (String(ticket.user) === String(req.user._id)) throw ApiError.badRequest('You already own this ticket');
  if (ticket.status === 'transferred') throw ApiError.badRequest('Ticket already transferred');
  if (ticket.status !== 'active') throw ApiError.badRequest('Ticket is no longer transferable');

  const previousOwner = ticket.user;
  ticket.user = req.user._id;
  ticket.status = 'active';
  ticket.transfer.claimToken = undefined;
  ticket.transfer.toUser = req.user._id;
  ticket.transfer.claimedAt = new Date();
  ticket.audit.push({ at: new Date(), action: 'transfer.claimed', by: req.user._id });
  await ticket.save();

  await notificationService.notify(previousOwner, {
    kind: 'ticket.transferred',
    subject: 'EventEase · Ticket transferred',
    title: 'Your ticket was transferred',
    body: `Ticket ${ticket.code} for ${ticket.event?.title} was transferred to ${req.user.name}.`,
  });
  await audit(req, { action: 'ticket.transfer.claim', targetType: 'Ticket', targetId: ticket._id });
  ok(res, { ticket });
});

// ---- Resale ----
const listOnResale = asyncHandler(async (req, res) => {
  const { code, price } = req.body;
  const ticket = await Ticket.findOne({ code: String(code).toUpperCase(), user: req.user._id }).populate('event');
  if (!ticket) throw ApiError.notFound('Ticket not found or not yours');
  if (ticket.status !== 'active') throw ApiError.badRequest('Only active tickets can be listed for resale');
  if (new Date(ticket.sessionDate || ticket.event.startDate) < new Date()) throw ApiError.badRequest('Event already started');

  const listing = await ResaleListing.create({
    ticket: ticket._id,
    event: ticket.event._id,
    seller: req.user._id,
    price: Number(price),
    fee: 0,
  });
  ticket.status = 'resale_listed';
  ticket.resaleSeller = req.user._id;
  ticket.resalePrice = Number(price);
  ticket.save();
  await audit(req, { action: 'ticket.resale.list', targetType: 'Ticket', targetId: ticket._id });
  ok(res, { listing }, 201);
});

const resaleMarket = asyncHandler(async (req, res) => {
  const { eventId } = req.query;
  const filter = { status: 'listed' };
  if (eventId) filter.event = eventId;
  const listings = await ResaleListing.find(filter)
    .populate('ticket', 'code seatLabel categoryName event sessionDate')
    .populate('seller', 'name')
    .populate('event', 'title startDate venue image category')
    .sort({ price: 1 });
  ok(res, { listings });
});

const myResale = asyncHandler(async (req, res) => {
  const listings = await ResaleListing.find({ seller: req.user._id })
    .populate('ticket', 'code seatLabel categoryName event')
    .populate('event', 'title startDate venue image category')
    .sort({ createdAt: -1 });
  ok(res, { listings });
});

const buyResale = asyncHandler(async (req, res) => {
  const { listingId } = req.params;
  const listing = await ResaleListing.findById(listingId).populate('ticket').populate('event').populate('seller');
  if (!listing) throw ApiError.notFound('Listing not found');
  if (listing.status !== 'listed') throw ApiError.conflict('Ticket no longer available');
  if (String(listing.seller._id) === String(req.user._id)) throw ApiError.badRequest('Cannot buy your own listing');

  listing.status = 'reserved';
  listing.buyer = req.user._id;
  listing.reservedUntil = new Date(Date.now() + 10 * 60 * 1000);
  await listing.save();

  const ticket = listing.ticket;
  const seller = listing.seller;

  // Transfer ownership to buyer.
  ticket.user = req.user._id;
  ticket.status = 'active';
  ticket.resaleSeller = seller._id;
  ticket.audit.push({ at: new Date(), action: 'resale.sold', by: req.user._id });
  await ticket.save();

  listing.status = 'sold';
  listing.soldAt = new Date();
  await listing.save();

  // Seller payment simulated (promptly available in wallet for demo).
  await User.updateOne({ _id: seller._id }, { $inc: { loyaltyPoints: Math.floor(listing.price * 10) } });

  await notificationService.notify(seller, {
    kind: 'ticket.sold',
    subject: 'EventEase · Your ticket was sold',
    title: `Your ticket sold for ${listing.price}`,
    body: `Your ticket ${ticket.code} for ${listing.event.title} has been sold on the resale market.`,
  });
  await notificationService.notify(req.user, {
    kind: 'ticket.purchased',
    subject: 'EventEase · Resale ticket purchased',
    title: `Resale ticket purchased: ${listing.event.title}`,
    body: `You bought ticket ${ticket.code}. Present the QR code at the venue.`,
  });
  await audit(req, { action: 'ticket.resale.buy', targetType: 'Ticket', targetId: ticket._id });
  ok(res, { listing, message: 'Resale ticket secured. It is now in your wallet.' });
});

const cancelListing = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const listing = await ResaleListing.findOne({ _id: id, seller: req.user._id }).populate('event');
  if (!listing) throw ApiError.notFound('Listing not found');
  if (listing.status === 'sold') throw ApiError.badRequest('Already sold — cannot cancel');
  if (listing.status === 'cancelled') throw ApiError.badRequest('Listing already cancelled');
  listing.status = 'cancelled';
  listing.cancelledAt = new Date();
  await listing.save();
  await Ticket.updateOne(
    { _id: listing.ticket },
    {
      $set: { status: 'active', resaleSeller: null, resalePrice: null },
      $push: { audit: { at: new Date(), action: 'resale.cancelled', by: req.user._id } },
    }
  );
  await audit(req, { action: 'ticket.resale.cancel', targetType: 'Ticket', targetId: listing.ticket });
  ok(res, { listing, message: 'Listing cancelled. Your ticket is back in your wallet and can be used or re-listed.' });
});

module.exports = {
  myTickets,
  detail,
  validate,
  initiateTransfer,
  claimTransfer,
  listOnResale,
  resaleMarket,
  myResale,
  buyResale,
  cancelListing,
};