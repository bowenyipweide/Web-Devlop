const request = require('supertest');
const mongoose = require('mongoose');

const User = require('../src/models/User');
const Event = require('../src/models/Event');
const Seat = require('../src/models/Seat');
const Booking = require('../src/models/Booking');
const Ticket = require('../src/models/Ticket');
const Voucher = require('../src/models/Voucher');
const VoucherRedemption = require('../src/models/VoucherRedemption');
const LoyaltyReward = require('../src/models/LoyaltyReward');
const Redemption = require('../src/models/Redemption');
const Notification = require('../src/models/Notification');

const { app } = require('../src/index');
const { signToken } = require('../src/middleware/auth');
const { generateSeats } = require('../src/services/inventory.service');
const { finalizePayment } = require('../src/controllers/booking.controller');

// Every request gets a fresh X-Forwarded-For so the per-IP rate limiters
// (apiLimiter: 2000/15min, bookingLimiter: 20/min) never trip during a run.
let ipCounter = 0;
const nextIp = () => {
  const n = ipCounter++;
  return `103.0.${Math.floor((n % 65025) / 255)}.${(n % 255) + 1}`;
};

const headers = (token) => ({
  'x-forwarded-for': nextIp(),
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

const api = {
  get: (url, token) => request(app).get(url).set(headers(token)),
  post: (url, token) => request(app).post(url).set(headers(token)),
  patch: (url, token) => request(app).patch(url).set(headers(token)),
  delete: (url, token) => request(app).delete(url).set(headers(token)),
};

const createUser = async ({ name, email, password = 'Password123!', role = 'customer', isApproved, organization, loyaltyPoints }) =>
  User.create({
    name,
    email,
    password,
    role,
    ...(isApproved === undefined ? {} : { isApproved }),
    ...(organization ? { organization } : {}),
    ...(loyaltyPoints !== undefined ? { loyaltyPoints } : {}),
  });

const tokenFor = (user) => signToken(user);

const makeReferral = (n) => `R${String(Math.random()).slice(2, 8).toUpperCase()}`;

const seedLiveEvent = async ({
  owner,
  title = `Live Event ${Math.random().toString(36).slice(2, 8)}`,
  description = 'A fantastic live event for testing.',
  category = 'concert',
  price = 50,
  qty = 100,
  city = 'Singapore',
  startDate = new Date(Date.now() + 7 * 24 * 3600e3),
  endDate,
  reservedSeating = false,
  sections,
}) => {
  const sDate = new Date(startDate);
  const eDate = new Date(endDate || sDate);

  const cats = [
    {
      name: 'Standard',
      tier: 'standard',
      price,
      qty,
      minPerOrder: 1,
      maxPerOrder: 8,
      description: 'Standard admission',
    },
  ];

  const event = await Event.create({
    owner,
    title,
    description,
    category,
    image: 'https://example.com/poster.png',
    venue: { name: 'Marina Bay Sands', address: '10 Bayfront Avenue', city },
    startDate: sDate,
    endDate: eDate,
    ticketCategories: cats,
    sessions: [],
    reservedSeating,
    status: 'published',
    approval: 'approved',
    salesCount: 0,
    revenue: 0,
  });

  const categoryIds = event.ticketCategories.map((c) => String(c._id));
  event.sessions = Event.buildSessions(event.startDate, event.endDate, [], categoryIds);
  await event.save();

  if (reservedSeating) {
    const resolved = (sections || [
      { name: 'Standard', rows: 2, cols: 10, tier: 'standard', price },
    ]).map((sec) => {
      const byName = event.ticketCategories.find(
        (c) => String(c.name).trim().toLowerCase() === String(sec.name || '').trim().toLowerCase()
      );
      return {
        ...sec,
        categoryId: byName ? String(byName._id) : String(event.ticketCategories[0]._id),
        categoryName: byName ? byName.name : event.ticketCategories[0].name,
      };
    });
    await generateSeats(event._id, resolved, event.sessions);
  }

  return event;
};

const seedDraftEvent = async ({ owner, title = `Draft ${Math.random().toString(36).slice(2, 8)}` }) =>
  Event.create({
    owner,
    title,
    description: 'An event not yet live.',
    category: 'theatre',
    venue: { name: 'Esplanade', city: 'Singapore' },
    startDate: new Date(Date.now() + 14 * 24 * 3600e3),
    endDate: new Date(Date.now() + 14 * 24 * 3600e3),
    ticketCategories: [{ name: 'Standard', tier: 'standard', price: 30, qty: 50 }],
    sessions: [],
    status: 'draft',
    approval: 'pending',
  });

const createConfirmedBooking = async ({ user, event, qty = 1, seatIds = [] }) => {
  const session = event.sessions[0];
  const cat = event.ticketCategories[0];
  const price = cat.price;
  const booking = await Booking.create({
    reference: `EE-TEST-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
    user: user._id,
    event: event._id,
    items: [
      {
        sessionId: session._id,
        sessionDate: session.date,
        categoryId: String(cat._id),
        categoryName: cat.name,
        tier: cat.tier,
        unitPrice: price,
        qty,
        seats: seatIds.map((seatId) => ({
          seatId,
          section: 'Standard',
          row: 'A',
          number: 1,
          label: `Standard A1`,
        })),
        bundleApplied: false,
        lineTotal: price * qty,
      },
    ],
    subtotal: price * qty,
    discount: 0,
    total: price * qty,
    status: 'pending',
  });

  for (const id of seatIds) {
    await Seat.updateOne({ _id: id, event: event._id, status: 'available' }, { $set: { status: 'booked', bookingId: booking._id } });
  }

  await finalizePayment({
    bookingId: booking._id,
    provider: 'simulated',
    method: 'simulated',
    intentId: null,
    amount: booking.total,
  });

  return Booking.findById(booking._id).populate('tickets');
};

const randomEmail = (prefix) => `${prefix}.${Math.random().toString(36).slice(2, 10)}@eventease.test`;

module.exports = {
  api,
  nextIp,
  createUser,
  tokenFor,
  makeReferral,
  randomEmail,
  seedLiveEvent,
  seedDraftEvent,
  createConfirmedBooking,
  models: {
    User,
    Event,
    Seat,
    Booking,
    Ticket,
    Voucher,
    VoucherRedemption,
    LoyaltyReward,
    Redemption,
    Notification,
    mongoose,
  },
};