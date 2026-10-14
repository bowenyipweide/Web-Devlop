const Event = require('../models/Event');
const Booking = require('../models/Booking');
const Ticket = require('../models/Ticket');
const ApiError = require('../utils/ApiError');
const { asyncHandler, ok } = require('../utils/asyncHandler');

const organizerEvents = (req) => {
  const filter = req.user.role === 'admin' ? {} : { owner: req.user._id };
  return filter;
};

const dashboard = asyncHandler(async (req, res) => {
  const filter = organizerEvents(req);
  const events = await Event.find(filter).sort({ createdAt: -1 });

  const now = new Date();
  const summary = events.reduce(
    (acc, e) => {
      acc.events += 1;
      acc.published += e.status === 'published' ? 1 : 0;
      acc.seatsSold += e.salesCount || 0;
      acc.revenue += e.revenue || 0;
      return acc;
    },
    { events: 0, published: 0, seatsSold: 0, revenue: 0 }
  );

  const eventIds = events.map((e) => e._id);
  const bookings = await Booking.find({ event: { $in: eventIds } })
    .sort({ createdAt: -1 })
    .limit(10)
    .populate('user', 'name email');

  summary.bookings = bookings.length;

  const rows = events.map((e) => ({
    id: e._id,
    slug: e.slug,
    title: e.title,
    category: e.category,
    startDate: e.startDate,
    endDate: e.endDate,
    reservedSeating: e.reservedSeating,
    status: e.status,
    approval: e.approval,
    salesCount: e.salesCount,
    revenue: e.revenue,
    soldPct:
      e.ticketCategories.length && e.ticketCategories[0].qty
        ? Math.min(100, Math.round((e.salesCount / e.ticketCategories.reduce((s, c) => s + c.qty, 0)) * 100))
        : 0,
    views: e.views,
    editReviewStatus: e.editReviewStatus || 'none',
    hasPendingEdit: !!e.pendingEdit,
  }));

  ok(res, { summary, rows, recentBookings: bookings.map((b) => ({
    id: b._id, reference: b.reference, customer: b.user?.name, status: b.status, total: b.total, createdAt: b.createdAt,
  })) });
});

// ---- Analytics ----
const salesAnalytics = asyncHandler(async (req, res) => {
  const { eventId, days = 30 } = req.query;
  const filter = organizerEvents(req);
  if (eventId) filter._id = eventId;

  const since = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000);
  const match = { status: { $in: ['confirmed', 'refunded'] }, createdAt: { $gte: since } };
  const ids = (await Event.find(filter).select('_id')).map((e) => e._id);
  match.event = { $in: ids };

  const series = await Booking.aggregate([
    { $match: match },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        revenue: { $sum: '$total' },
        bookings: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const byEvent = await Booking.aggregate([
    { $match: { ...match, status: 'confirmed' } },
    { $group: { _id: '$event', revenue: { $sum: '$total' }, tickets: { $sum: { $size: '$tickets' } } } },
  ]);

  ok(res, { series, byEvent, days: Number(days) });
});

// Simple demand forecast: linear regression on daily revenue, extrapolated 7 days.
const demandForecast = asyncHandler(async (req, res) => {
  const { eventId } = req.query;
  const filter = organizerEvents(req);
  if (eventId) filter._id = eventId;

  const ids = (await Event.find(filter).select('_id')).map((e) => e._id);
  const bookings = await Booking.find({
    event: { $in: ids },
    status: { $in: ['confirmed', 'refunded'] },
    createdAt: { $gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
  }).select('createdAt total');

  const byDay = new Map();
  bookings.forEach((b) => {
    const key = b.createdAt.toISOString().slice(0, 10);
    byDay.set(key, (byDay.get(key) || 0) + b.total);
  });

  const sorted = [...byDay.entries()].sort();
  const n = sorted.length;
  const xMean = (n * (n - 1)) / 2 / Math.max(1, n);
  const yMean = sorted.reduce((s, [, v]) => s + v, 0) / Math.max(1, n);
  let num = 0, den = 0;
  sorted.forEach(([k, v], i) => {
    num += (i - xMean) * (v - yMean);
    den += (i - xMean) ** 2;
  });
  const slope = den ? num / den : 0;
  const intercept = yMean - slope * xMean;

  const forecast = [];
  for (let d = 1; d <= 7; d++) {
    const day = new Date(Date.now() + d * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const predicted = Math.max(0, intercept + slope * (n - 1 + d));
    forecast.push({ day, predictedRevenue: Math.round(predicted * 100) / 100, trend: slope });
  }

  ok(res, { observed: sorted.map(([k, v]) => ({ day: k, revenue: v })), forecast });
});

// Engagement: bookings-per-day, top events, repeat customers.
const engagement = asyncHandler(async (req, res) => {
  const filter = organizerEvents(req);
  const ids = (await Event.find(filter).select('_id')).map((e) => e._id);

  const events = await Event.find({ _id: { $in: ids } }).sort({ salesCount: -1 }).limit(5).select('title category revenue salesCount views');
  const repeatCustomers = await Booking.aggregate([
    { $match: { event: { $in: ids }, status: 'confirmed' } },
    { $group: { _id: '$user', n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
    { $count: 'repeat' },
  ]);
  const audience = await Booking.aggregate([
    { $match: { event: { $in: ids }, status: 'confirmed' } },
    { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }, count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);

  ok(res, {
    topEvents: events,
    repeatCustomers: repeatCustomers[0]?.repeat || 0,
    audienceByMonth: audience,
    engagementScore: events.length ? Math.round((events.reduce((s, e) => s + (e.salesCount || 0), 0) / events.length) * (events.reduce((s, e) => s + (e.views || 0), 0) / 100) * 100) / 100 : 0,
  });
});

module.exports = { dashboard, salesAnalytics, demandForecast, engagement };