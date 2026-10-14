const Event = require('../models/Event');
const Seat = require('../models/Seat');
const ApiError = require('../utils/ApiError');
const { nanoid } = require('nanoid');

const SEAT_HOLD_MINUTES = Number(process.env.SEAT_HOLD_MINUTES) || 10;

const buildSeatDocs = (eventId, sessionId, sections) => {
  const docs = [];
  for (const section of sections) {
    let rowLetter = section.startingRow || 'A';
    for (let r = 0; r < (section.rows || 0); r++) {
      const cols = section.cols || 20;
      for (let n = 1; n <= cols; n++) {
        docs.push({
          event: eventId,
          session: sessionId || undefined,
          categoryId: section.categoryId,
          categoryName: section.categoryName || section.name,
          tier: section.tier,
          price: section.price,
          section: section.name,
          row: rowLetter,
          number: n,
          accessibility: { wheelchair: section.accessibility === 'wheelchair' },
        });
      }
      rowLetter = String.fromCharCode(rowLetter.charCodeAt(0) + 1);
    }
  }
  return docs;
};

// Generate seats for an event's reservedSeating layout.
// When sessions is provided and has more than one entry, a full seat
// set is created for every session (each date has its own inventory).
// When sessions is omitted or empty, seats are generated once with
// session=null (backward-compatible with single-day events).
const generateSeats = async (eventId, sections, sessions = []) => {
  const event = await Event.findById(eventId);
  if (!event) throw ApiError.notFound('Event not found');

  const sessionIds = sessions.map((s) => String(s._id));

  // Delete all seats for the event, then regenerate a full seat set per
  // session. Only safe for brand-new events or a full reseed: existing
  // bookings referencing old seat _ids would become dangling. Live layout
  // edits must go through syncReservedInventory, which preserves booked seats.
  await Seat.deleteMany({ event: eventId });

  const seats = [];
  const sessionList = sessionIds.length ? sessionIds : [null];
  for (const sessionId of sessionList) {
    seats.push(...buildSeatDocs(eventId, sessionId, sections));
  }
  await Seat.insertMany(seats, { ordered: false });
  return seats.length;
};

// Seed seats for a single session without touching seats on other dates.
// Used when an organizer extends event dates after creation.
const seedSessionSeats = async (eventId, sessionId, sections) => {
  const docs = buildSeatDocs(eventId, sessionId, sections);
  if (!docs.length) return 0;
  await Seat.insertMany(docs, { ordered: false });
  return docs.length;
};

const releaseExpiredHolds = async () => {
  const now = new Date();
  const res = await Seat.updateMany(
    { status: 'held', heldUntil: { $lte: now } },
    { $set: { status: 'available' }, $unset: { heldBy: 1, heldUntil: 1, holdToken: 1, bookingId: 1 } }
  );
  if (res.modifiedCount) console.log(`[inventory] released ${res.modifiedCount} expired holds`);
  return res.modifiedCount;
};

// Reserve general-admission quantity atomically for a specific session.
// Updates the per-session availability counter on the event document
// instead of the legacy top-level category.sold/held.
const reserveGa = async (eventId, sessionId, categoryId, qty) => {
  const event = await Event.findById(eventId);
  if (!event) throw ApiError.notFound('Event not found');

  let session = null;
  try { session = event.sessions.id(sessionId); } catch (e) { /* invalid id */ }

  if (!session && (!sessionId || sessionId === 'legacy')) {
    // Legacy event with no sessions: fall back to top-level category counters.
    const cat = event.ticketCategories.find((c) => String(c._id) === String(categoryId));
    if (!cat) throw ApiError.notFound('Ticket category not found');
    if ((cat.sold || 0) + (cat.held || 0) + Number(qty) > Number(cat.qty)) {
      throw ApiError.conflict('Not enough inventory left for this event');
    }
    await Event.updateOne(
      { _id: eventId, 'ticketCategories._id': categoryId },
      { $inc: { 'ticketCategories.$.held': Number(qty) } }
    );
    return;
  }

  if (!session) throw ApiError.notFound('Session not found');

  const cat = event.ticketCategories.find((c) => String(c._id) === String(categoryId));
  if (!cat) throw ApiError.notFound('Ticket category not found');

  let avail = (session.availability || []).find((a) => String(a.categoryId) === String(categoryId));
  if (!avail) {
    // Lazy-init for legacy events without session availability yet.
    session.availability.push({ categoryId: String(categoryId), sold: 0, held: 0 });
    avail = session.availability[session.availability.length - 1];
    await event.save();
  }

  if ((avail.sold || 0) + (avail.held || 0) + Number(qty) > Number(cat.qty)) {
    throw ApiError.conflict('Not enough inventory left for this session');
  }

  await Event.findOneAndUpdate(
    { _id: eventId, 'sessions._id': sessionId },
    { $inc: { [`sessions.$.availability.$[a].held`]: Number(qty) } },
    {
      arrayFilters: [{ 'a.categoryId': String(categoryId) }],
      new: true,
    }
  );
};

const releaseGa = async (eventId, sessionId, categoryId, qty) => {
  const event = await Event.findById(eventId);
  let session = null;
  try { session = event && event.sessions.id(sessionId); } catch (e) { /* invalid id */ }
  if (!session && (!sessionId || sessionId === 'legacy')) {
    await Event.updateOne(
      { _id: eventId, 'ticketCategories._id': categoryId },
      { $inc: { 'ticketCategories.$.held': -Math.max(0, Number(qty)) } }
    );
    return;
  }
  await Event.findOneAndUpdate(
    { _id: eventId, 'sessions._id': sessionId },
    { $inc: { [`sessions.$.availability.$[a].held`]: -Math.max(0, Number(qty)) } },
    { arrayFilters: [{ 'a.categoryId': String(categoryId) }] }
  );
};

// Hold a subset of available seats for a specific session.
// Seats matching the requested session (or legacy seats with session=null)
// are eligible for holding.
const holdSpecificSeats = async ({ eventId, userId, seatIds, sessionId }) => {
  const event = await Event.findById(eventId);
  if (!event) throw ApiError.notFound('Event not found');
  if (!event.reservedSeating) throw ApiError.badRequest('Event is general admission');

  const heldUntil = new Date(Date.now() + SEAT_HOLD_MINUTES * 60 * 1000);
  const token = nanoid(16);
  const held = [];

  for (const id of seatIds) {
    // session filter: if sessionId provided, only hold seats belonging to
    // that session or legacy (null) seats that haven't been booked to
    // another session yet.
    const match = { _id: id, event: eventId, status: 'available' };
    if (sessionId) match.$or = [{ session: sessionId }, { session: null }];

    const seat = await Seat.findOneAndUpdate(
      match,
      {
        $set: { status: 'held', heldBy: userId, heldUntil, holdToken: token, session: sessionId || undefined },
        $unset: { bookingId: 1 },
      },
      { new: true }
    );
    if (!seat) {
      console.error('[booking] seat already taken', id);
      break;
    }
    held.push(seat);
  }

  if (held.length !== seatIds.length) {
    await Seat.updateMany(
      { _id: { $in: seatIds }, status: 'held', heldBy: userId, holdToken: token },
      {
        $set: { status: 'available' },
        $unset: { heldBy: 1, heldUntil: 1, holdToken: 1, bookingId: 1 },
      }
    );
    throw ApiError.conflict('One or more selected seats were just taken by another customer. Refresh to see updated availability.');
  }

  return { seats: held, token, heldUntil };
};

// Confirm holds -> booked once payment succeeds. Accepts one or more hold tokens.
// Also matches by bookingId as a fallback: holds are stamped with the booking on
// creation, so even if a hold token was lost the correct seats still get locked.
const bookSeats = async ({ bookingId, seatIds, tokens = [] }) => {
  const now = new Date();
  await Seat.updateMany(
    { _id: { $in: seatIds }, status: 'held', $or: [{ holdToken: { $in: tokens } }, { bookingId }] },
    { $set: { status: 'booked', bookingId, heldUntil: now }, $unset: { holdToken: 1 } }
  );
};

// Roll back holds (cancel / failed payment / expiry).
const rollbackSeatHolds = async ({ seatIds, tokens = [] }) => {
  await Seat.updateMany(
    { _id: { $in: seatIds }, status: 'held', holdToken: { $in: tokens } },
    { $set: { status: 'available' }, $unset: { heldBy: 1, heldUntil: 1, holdToken: 1, bookingId: 1 } }
  );
};

const listSeats = async (eventId, sessionId) => {
  const filter = { event: eventId };
  if (sessionId) {
    // Show seats for the requested session AND any legacy (null) seats.
    filter.$or = [{ session: sessionId }, { session: null }];
  }
  return Seat.find(filter).lean();
};

module.exports = {
  generateSeats,
  seedSessionSeats,
  releaseExpiredHolds,
  reserveGa,
  releaseGa,
  holdSpecificSeats,
  bookSeats,
  rollbackSeatHolds,
  listSeats,
  SEAT_HOLD_MINUTES,
};
