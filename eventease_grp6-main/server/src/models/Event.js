const mongoose = require('mongoose');
const { nanoid } = require('nanoid');

const eventSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true },
    slug: { type: String, unique: true, index: true },
    description: { type: String, required: true },
    category: {
      type: String,
      enum: ['concert', 'theatre', 'sports', 'cultural', 'festival', 'other'],
      index: true,
    },
    image: String,
    venue: {
      name: { type: String, required: true },
      address: String,
      city: { type: String, required: true, index: true },
      country: { type: String, default: 'SG' },
    },
    startDate: { type: Date, required: true, index: true },
    endDate: { type: Date, required: true },
    // One session per on-sale date. Each session has its own full inventory
    // (per-category availability), so one date selling out doesn't affect the
    // others. Organizers pick a date at checkout.
    sessions: [
      {
        _id: { type: mongoose.Schema.Types.ObjectId, auto: true },
        date: { type: Date, required: true },
        availability: [
          {
            categoryId: { type: String },
            sold: { type: Number, default: 0 },
            held: { type: Number, default: 0 },
          },
        ],
      },
    ],
    ticketCategories: [
      {
        _id: { type: String, default: () => nanoid(8) },
        name: { type: String, required: true },
        tier: { type: String, enum: ['vip', 'standard', 'concession'], default: 'standard' },
        price: { type: Number, required: true, min: 0 },
        qty: { type: Number, required: true, min: 0 },
        sold: { type: Number, default: 0 },
        held: { type: Number, default: 0 },
        earlyBirdPrice: Number,
        earlyBirdEnd: Date,
        bundleOffer: { qty: { type: Number, default: 0 }, price: { type: Number, default: 0 } },
        minPerOrder: { type: Number, default: 1 },
        maxPerOrder: { type: Number, default: 8 },
        description: String,
      },
    ],
    reservedSeating: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ['draft', 'published', 'sold_out', 'cancelled'],
      default: 'draft',
    },
    approval: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    approvalNote: String,
    // Proposed changes from an organizer editing a LIVE event. The live event
    // keeps showing its current details until an admin approves the edit.
    pendingEdit: { type: mongoose.Schema.Types.Mixed, default: null },
    editReviewStatus: {
      type: String,
      enum: ['none', 'pending', 'rejected'],
      default: 'none',
    },
    promo: {
      enabled: { type: Boolean, default: false },
      message: String,
      bannerColor: String,
    },
    salesCount: { type: Number, default: 0 },
    revenue: { type: Number, default: 0 },
    views: { type: Number, default: 0 },
    ratings: { type: Number, default: 0 },
    accessibility: {
      wheelchair: { type: Boolean, default: false },
      hearingLoop: { type: Boolean, default: false },
      sensory: { type: Boolean, default: false },
    },
    tags: [String],
  },
  { timestamps: true }
);

eventSchema.index({ title: 'text', description: 'text', tags: 'text' });
eventSchema.index({ startDate: 1, category: 1, 'venue.city': 1 });

eventSchema.pre('save', function (next) {
  if (!this.slug) {
    this.slug = `${this.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}-${nanoid(6)}`;
  }
  next();
});

eventSchema.methods.toPublicJSON = function () {
  const sessions = (this.sessions || []).map((s) => ({
    id: s._id,
    date: s.date,
  }));

  const mappedCategories = this.ticketCategories.map((c) => {
    const perSession = (this.sessions || []).map((s) => {
      const a = (s.availability || []).find((x) => String(x.categoryId) === String(c._id));
      return {
        sessionId: s._id,
        date: s.date,
        sold: a ? a.sold : 0,
        held: a ? a.held : 0,
        available: Math.max(0, c.qty - (a ? a.sold : 0) - (a ? a.held : 0)),
        soldOut: a ? a.sold >= c.qty : false,
      };
    });
    const totalSold = perSession.reduce((sum, p) => sum + p.sold, 0);
    const totalHeld = perSession.reduce((sum, p) => sum + p.held, 0);
    return {
      id: c._id,
      name: c.name,
      tier: c.tier,
      price: c.price,
      qty: c.qty,
      sold: totalSold,
      available: perSession.reduce((sum, p) => sum + p.available, 0),
      held: totalHeld,
      soldOut: perSession.length ? perSession.every((p) => p.soldOut) : c.sold >= c.qty,
      sessionAvailability: perSession,
      earlyBirdPrice: c.earlyBirdPrice,
      earlyBirdEnd: c.earlyBirdEnd,
      bundleOffer: c.bundleOffer,
      minPerOrder: c.minPerOrder,
      maxPerOrder: c.maxPerOrder,
      description: c.description,
    };
  });

  const totalSold = mappedCategories.reduce((sum, c) => sum + c.sold, 0);
  const totalHeld = mappedCategories.reduce((sum, c) => sum + c.held, 0);
  const totalAvailable = mappedCategories.reduce((sum, c) => sum + c.available, 0);

  return {
    id: this._id,
    slug: this.slug,
    title: this.title,
    description: this.description,
    category: this.category,
    image: this.image,
    venue: this.venue,
    startDate: this.startDate,
    endDate: this.endDate,
    sessions,
    ticketCategories: mappedCategories,
    reservedSeating: this.reservedSeating,
    status: this.status,
    approval: this.approval,
    approvalNote: this.approvalNote,
    editReviewStatus: this.editReviewStatus || 'none',
    hasPendingEdit: !!this.pendingEdit,
    promo: this.promo,
    salesCount: this.salesCount,
    sold: totalSold,
    available: totalAvailable,
    held: totalHeld,
    revenue: this.revenue,
    views: this.views,
    accessibility: this.accessibility,
    tags: this.tags,
    owner: this.owner,
    createdAt: this.createdAt,
  };
};

// Build one session per calendar day between startDate..endDate, reusing
// existing session docs when the date matches so seat bookings are preserved.
// New sessions get empty category availability; existing availability untouched.
const buildSessions = (startDate, endDate, existingSessions = [], categoryIds = []) => {
  if (!startDate || !endDate) return existingSessions;
  const s = new Date(startDate);
  const e = new Date(endDate);
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return existingSessions;
  const sHour = s.getHours();
  const sMin = s.getMinutes();
  const sSec = s.getSeconds();
  const sMs = s.getMilliseconds();
  const cursor = new Date(s);
  cursor.setHours(0, 0, 0, 0);
  const last = new Date(e);
  last.setHours(0, 0, 0, 0);
  const out = [];
  while (cursor <= last) {
    const existing = (existingSessions || []).find((x) => {
      const xd = new Date(x.date);
      xd.setHours(0, 0, 0, 0);
      return xd.getTime() === cursor.getTime();
    });
    const sessionDate = new Date(cursor);
    sessionDate.setHours(sHour, sMin, sSec, sMs);
    if (existing) {
      out.push(existing);
    } else {
      out.push({
        date: sessionDate,
        availability: categoryIds.map((cid) => ({ categoryId: cid, sold: 0, held: 0 })),
      });
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
};

const Event = mongoose.model('Event', eventSchema);
Event.buildSessions = buildSessions;
module.exports = Event;