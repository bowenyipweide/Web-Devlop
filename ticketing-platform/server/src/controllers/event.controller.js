const Event = require('../models/Event');
const User = require('../models/User');
const Seat = require('../models/Seat');
const ApiError = require('../utils/ApiError');
const { asyncHandler, ok } = require('../utils/asyncHandler');
const { generateSeats, listSeats, seedSessionSeats } = require('../services/inventory.service');
const chatbot = require('../services/chatbot.service');
const { audit } = require('../utils/audit');

// Reconstruct a seating layout from seat documents. rows = distinct rows,
// cols = highest seat number, startingRow = lowest row letter.
const reconstructSections = (seats) => {
  const byName = new Map();
  const rows = new Map();
  for (const s of seats) {
    const cur = byName.get(s.section) || {
      name: s.section, categoryId: s.categoryId, categoryName: s.categoryName,
      tier: s.tier, price: s.price, cols: 0, startingRow: s.row,
    };
    cur.cols = Math.max(cur.cols, s.number);
    if (s.row < cur.startingRow) cur.startingRow = s.row;
    byName.set(s.section, cur);
    if (!rows.has(s.section)) rows.set(s.section, new Set());
    rows.get(s.section).add(s.row);
  }
  return [...byName.values()].map((s) => ({ ...s, rows: rows.get(s.name).size }));
};

const listEvents = asyncHandler(async (req, res) => {
  const {
    q, category, city, dateFrom, dateTo, priceMin, priceMax,
    sort = 'upcoming', page = 1, limit = 12,
  } = req.query;

  const filter = { status: 'published', approval: 'approved', endDate: { $gte: new Date() } };

  if (q) filter.$text = { $search: q };
  if (category) filter.category = category;
  if (city) filter['venue.city'] = new RegExp(city, 'i');
  if (dateFrom) filter.startDate = { ...(filter.startDate || {}), $gte: new Date(dateFrom) };
  if (dateTo) filter.startDate = { ...(filter.startDate || {}), $lte: new Date(dateTo) };
  if (priceMin || priceMax) {
    filter['ticketCategories.price'] = {};
    if (priceMin) filter['ticketCategories.price'].$gte = Number(priceMin);
    if (priceMax) filter['ticketCategories.price'].$lte = Number(priceMax);
  }

  const sortMap = {
    upcoming: { startDate: 1 },
    newest: { createdAt: -1 },
    'price-asc': { 'ticketCategories.price': 1 },
    'price-desc': { 'ticketCategories.price': -1 },
    popular: { salesCount: -1 },
  };

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.min(48, parseInt(limit, 10) || 12);

  const [events, total] = await Promise.all([
    Event.find(filter).sort(sortMap[sort] || sortMap.upcoming).skip((pageNum - 1) * pageSize).limit(pageSize),
    Event.countDocuments(filter),
  ]);

  const cities = await Event.distinct('venue.city', filter);

  ok(res, {
    events: events.map((e) => e.toPublicJSON()),
    total,
    page: pageNum,
    pages: Math.ceil(total / pageSize),
    cities,
  });
});

const getEvent = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const { session: sessionId } = req.query;
  const event = await Event.findOne({ slug });
  if (!event) throw ApiError.notFound('Event not found');

  const isOwn = req.user && String(event.owner) === String(req.user._id);
  const isAdmin = req.user && req.user.role === 'admin';
  if (!isOwn && !isAdmin && (event.status !== 'published' || event.approval !== 'approved'))
    throw ApiError.notFound('Event not found');

  await Event.updateOne({ _id: event._id }, { $inc: { views: 1 } });

  const organizer = await User.findById(event.owner).select('name organization organizerBio');
  let seats = null;
  if (event.reservedSeating) {
    const filter = { event: event._id, status: { $in: ['available', 'held', 'booked'] } };
    if (sessionId) filter.$or = [{ session: sessionId }, { session: null }];
    seats = await Seat.find(filter)
      .select('section row number status tier categoryName categoryId price accessibility session')
      .lean();
  }

  ok(res, { event: event.toPublicJSON(), organizer, seats });
});

const categories = asyncHandler(async (req, res) => {
  const counts = await Event.aggregate([
    { $match: { status: 'published', approval: 'approved' } },
    { $group: { _id: '$category', count: { $sum: 1 } } },
  ]);
  ok(res, { categories: counts.map((c) => ({ name: c._id, count: c.count })) });
});

// ---------------- Organizer ---------------- //

const myEvents = asyncHandler(async (req, res) => {
  const events = await Event.find({ owner: req.user._id }).sort({ createdAt: -1 });
  ok(res, { events: events.map((e) => e.toPublicJSON()) });
});

const getManageEvent = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const isAdmin = req.user && req.user.role === 'admin';
  const event = await Event.findOne({ _id: id, ...(isAdmin ? {} : { owner: req.user._id }) });
  if (!event) throw ApiError.notFound('Event not found or not yours');

  let sections = [];
  if (event.reservedSeating) {
    const seats = await Seat.find({ event: event._id }).select('section row number categoryId categoryName tier price').lean();
    sections = reconstructSections(seats);
  }

  ok(res, {
    event: {
      ...event.toObject(),
      sections,
      sessions: (event.sessions || []).map((s) => ({ id: s._id, date: s.date })),
      ticketCategories: event.ticketCategories.map((c) => ({
        id: c._id, name: c.name, tier: c.tier, price: c.price, qty: c.qty,
        earlyBirdPrice: c.earlyBirdPrice, earlyBirdEnd: c.earlyBirdEnd,
        maxPerOrder: c.maxPerOrder, description: c.description,
      })),
    },
  });
});

const createEvent = asyncHandler(async (req, res) => {
  const {
    title, description, category, image, venue, startDate, endDate,
    ticketCategories, reservedSeating, sections, accessibility, tags, promo,
  } = req.body;

  if (!title || !venue || !startDate) throw ApiError.badRequest('Title, venue and start date required');
  if (!ticketCategories || !ticketCategories.length)
    throw ApiError.badRequest('At least one ticket category required');
  if (reservedSeating && (!sections || !sections.length))
    throw ApiError.badRequest('Reserved seating requires a seating layout (sections)');

  const resolvedCats = ticketCategories.map((c) => ({
    name: c.name,
    tier: c.tier || 'standard',
    price: Number(c.price),
    qty: Number(c.qty),
    earlyBirdPrice: c.earlyBirdPrice ? Number(c.earlyBirdPrice) : undefined,
    earlyBirdEnd: c.earlyBirdEnd || undefined,
    bundleOffer: c.bundleOffer || undefined,
    description: c.description,
  }));
  const categoryIds = resolvedCats.map((c, i) => c.id || `cat_${i}`);

  const end = endDate || startDate;
  const sessions = Event.buildSessions(startDate, end, [], categoryIds);

  const event = await Event.create({
    owner: req.user._id,
    title,
    description,
    category,
    image,
    venue,
    startDate,
    endDate: end,
    sessions,
    ticketCategories: resolvedCats,
    reservedSeating: !!reservedSeating,
    status: 'draft',
    approval: 'pending',
    accessibility: accessibility || {},
    tags: tags || [],
    promo: promo || { enabled: false },
  });

  if (reservedSeating) {
    const resolved = sections.map((sec, idx) => {
      const byName = event.ticketCategories.find(
        (c) => c.name.trim().toLowerCase() === String(sec.name || '').trim().toLowerCase()
      );
      const category = byName || event.ticketCategories[idx];
      if (!category) throw ApiError.badRequest(`Section "${sec.name}" must map to a ticket category`);
      return { ...sec, categoryId: category._id };
    });
    await generateSeats(event._id, resolved, event.sessions);
  }

  await audit(req, { action: 'event.create', targetType: 'Event', targetId: event._id });
  chatbot.invalidateCache();
  ok(res, { event: event.toPublicJSON() }, 201);
});

const applyEventChanges = async (event, updates) => {
  const allowed = ['title', 'description', 'category', 'image', 'venue', 'startDate', 'endDate', 'ticketCategories', 'accessibility', 'tags', 'promo', 'reservedSeating', 'sections'];
  const clean = {};
  for (const key of allowed) if (key in updates) clean[key] = updates[key];

  if (clean.ticketCategories) {
    clean.ticketCategories = clean.ticketCategories.map((c) => ({
      ...(c.id && event.ticketCategories.some((x) => String(x._id) === String(c.id)) ? { _id: c.id } : {}),
      name: c.name,
      tier: c.tier || 'standard',
      price: Number(c.price),
      qty: Number(c.qty),
      earlyBirdPrice: c.earlyBirdPrice ? Number(c.earlyBirdPrice) : undefined,
      earlyBirdEnd: c.earlyBirdEnd || undefined,
      maxPerOrder: Number(c.maxPerOrder) || 8,
      description: c.description,
    }));
  }

  const startBefore = event.startDate;
  const endBefore = event.endDate;
  const wasReserved = event.reservedSeating;
  Object.assign(event, clean);

  const startChanged = clean.startDate && String(new Date(clean.startDate)) !== String(startBefore);
  const endChanged = clean.endDate && String(new Date(clean.endDate)) !== String(endBefore);
  const reservedChanged = 'reservedSeating' in clean && !!clean.reservedSeating !== wasReserved;

  // Ensure every category has a per-session availability entry on each date.
  const categoryIds = event.ticketCategories.map((c) => String(c._id));
  for (const session of event.sessions || []) {
    for (const cid of categoryIds) {
      if (!(session.availability || []).some((a) => String(a.categoryId) === String(cid))) {
        session.availability.push({ categoryId: cid, sold: 0, held: 0 });
      }
    }
  }

  if (startChanged || endChanged) {
    event.sessions = Event.buildSessions(event.startDate, event.endDate, event.sessions || [], categoryIds);
  }

  if (clean.sections && !clean.sections.length) throw ApiError.badRequest('Reserved seating requires at least one section');

  if (event.reservedSeating) {
    if (clean.sections) {
      const resolved = clean.sections.map((sec, idx) => {
        const byName = event.ticketCategories.find(
          (c) => String(c.name || '').trim().toLowerCase() === String(sec.name || '').trim().toLowerCase()
        );
        const category = byName || event.ticketCategories[idx];
        if (!category) throw ApiError.badRequest(`Section "${sec.name}" must map to a ticket category`);
        return { ...sec, categoryId: category._id, categoryName: category.name };
      });
      // Sync the seat inventory to the proposed layout WITHOUT ever deleting
      // seats that already have a booking (status "booked"). Price/tier/category
      // changes update seats in place; new sections add seats; removed sections
      // only remove seats that are still available.
      await syncReservedInventory(event, resolved);
    } else {
      // No layout change provided: only seed seats for sessions that don't
      // have any yet (e.g. newly extended dates). Existing seats untouched,
      // including booked ones.
      const seatDocs = await Seat.find({ event: event._id }).select('section row number categoryId categoryName tier price').lean();
      const sections = reconstructSections(seatDocs);
      for (const session of event.sessions) {
        const hasSeats = await Seat.exists({ event: event._id, session: session._id });
        if (!hasSeats && sections.length) {
          await seedSessionSeats(event._id, session._id, sections);
        }
      }
    }
  } else if (reservedChanged && wasReserved) {
    // Reserved seating switched OFF for a formerly reserved event. Keep booked
    // seats intact so existing ticket holders are not orphaned.
    await Seat.deleteMany({ event: event._id, status: { $in: ['available', 'held'] } });
  }

  return event;
};

// Reconcile the reserved seat set to match a proposed layout. Booked seats are
// sacred and are never deleted or re-created; available/held seats are updated
// or removed to reflect the new layout; missing seats (e.g. new sections or a
// date being extended) are inserted.
const syncReservedInventory = async (event, sections) => {
  const proposed = new Map();
  for (const section of sections) {
    let rowLetter = section.startingRow || 'A';
    for (let r = 0; r < (section.rows || 0); r++) {
      for (let n = 1; n <= (section.cols || 0); n++) {
        proposed.set(`${rowLetter}|${n}`, {
          section: section.name,
          tier: section.tier,
          price: section.price,
          categoryId: section.categoryId,
          categoryName: section.categoryName || section.name,
          row: rowLetter,
          number: n,
        });
      }
      rowLetter = String.fromCharCode(rowLetter.charCodeAt(0) + 1);
    }
  }

  const existing = await Seat.find({ event: event._id }).lean();
  const bySession = (s, sessionId) => String(s.session || '') === String(sessionId || '');

  // Per session, compare existing seats with the proposed layout.
  for (const session of event.sessions || []) {
    const sessionId = session._id;
    const sessionSeats = existing.filter((s) => bySession(s, sessionId));
    if (!sessionSeats.length) {
      // Fresh session (new date): create its full seat set.
      await seedSessionSeats(event._id, sessionId, sections);
      continue;
    }

    const seen = new Set();
    const updates = [];
    const delIds = [];
    for (const s of sessionSeats) {
      const key = `${s.row}|${s.number}`;
      const prop = proposed.get(key);
      if (!prop) {
        if (s.status !== 'booked') delIds.push(s._id);
        continue;
      }
      seen.add(key);
      if (s.price !== Number(prop.price) || s.tier !== prop.tier || String(s.categoryId) !== String(prop.categoryId) || s.categoryName !== prop.categoryName) {
        updates.push({ updateOne: { filter: { _id: s._id }, update: { $set: { price: Number(prop.price), tier: prop.tier, categoryId: prop.categoryId, categoryName: prop.categoryName } } } });
      }
    }

    if (delIds.length) await Seat.deleteMany({ _id: { $in: delIds } });
    if (updates.length) await Seat.bulkWrite(updates);

    // Insert seats that exist in the new layout but not on this session.
    const inserts = [];
    for (const [key, prop] of proposed) {
      if (seen.has(key)) continue;
      inserts.push({ event: event._id, session: sessionId, status: 'available', ...prop });
    }
    if (inserts.length) await Seat.insertMany(inserts, { ordered: false });
  }

  // Sessions that were removed (dates shrunk): free their unbooked seats.
  const keptSessionIds = (event.sessions || []).map((s) => String(s._id));
  await Seat.deleteMany({ event: event._id, session: { $nin: keptSessionIds }, status: { $in: ['available', 'held'] } });
};

const updateEvent = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const event = await Event.findOne({ _id: id, owner: req.user._id });
  if (!event) throw ApiError.notFound('Event not found or not yours');

  const allowed = ['title', 'description', 'category', 'image', 'venue', 'startDate', 'endDate', 'ticketCategories', 'reservedSeating', 'sections', 'accessibility', 'tags', 'promo'];
  const updates = {};
  for (const key of allowed) if (key in req.body) updates[key] = req.body[key];

  const isLive = event.status === 'published' && event.approval === 'approved';

  if (isLive && req.user.role !== 'admin') {
    // Stage the edit: the LIVE event keeps showing its current (old) details
    // until an admin approves. The proposal is stored on pendingEdit and the
    // event is added to the admin moderation queue via editReviewStatus.
    if (updates.reservedSeating && (!updates.sections || !updates.sections.length))
      throw ApiError.badRequest('Reserved seating requires a seating layout (sections)');
    event.set('pendingEdit', updates);
    event.set('editReviewStatus', 'pending');
    await event.save();
    await audit(req, { action: 'event.edit.proposed', targetType: 'Event', targetId: event._id });
    chatbot.invalidateCache();
    return ok(res, { event: event.toPublicJSON(), staged: true, message: 'Edit saved for admin review. The published listing keeps showing the current details until approved.' });
  }

  await applyEventChanges(event, updates);
  await event.save();
  await audit(req, { action: 'event.update', targetType: 'Event', targetId: event._id });
  chatbot.invalidateCache();
  ok(res, { event: event.toPublicJSON() });
});

const submitForApproval = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const event = await Event.findOne({ _id: id, owner: req.user._id });
  if (!event) throw ApiError.notFound('Event not found or not yours');

  if (event.pendingEdit) {
    // Resubmit a previously rejected edit (the live listing stays unchanged).
    event.set('editReviewStatus', 'pending');
    await event.save();
    await audit(req, { action: 'event.edit.resubmit', targetType: 'Event', targetId: event._id });
    chatbot.invalidateCache();
    return ok(res, { event: event.toPublicJSON(), message: 'Edit resubmitted for admin review.' });
  }

  event.status = 'published';
  event.approval = 'pending';
  await event.save();
  await audit(req, { action: 'event.submit', targetType: 'Event', targetId: event._id });
  chatbot.invalidateCache();
  ok(res, { event: event.toPublicJSON(), message: 'Submitted for review.' });
});

const cancelEvent = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const event = await Event.findOneAndUpdate(
    { _id: id, owner: req.user._id },
    { status: 'cancelled' },
    { new: true }
  );
  if (!event) throw ApiError.notFound('Event not found or not yours');
  await audit(req, { action: 'event.cancel', targetType: 'Event', targetId: event._id });
  chatbot.invalidateCache();
  ok(res, { event: event.toPublicJSON() });
});

module.exports = { listEvents, getEvent, categories, myEvents, getManageEvent, createEvent, updateEvent, submitForApproval, cancelEvent, applyEventChanges, reconstructSections };