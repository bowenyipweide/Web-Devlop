require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('./config/db');
const User = require('./models/User');
const Event = require('./models/Event');
const Ticket = require('./models/Ticket');
const Booking = require('./models/Booking');
const Seat = require('./models/Seat');
const LoyaltyReward = require('./models/LoyaltyReward');
const Redemption = require('./models/Redemption');
const Voucher = require('./models/Voucher');
const VoucherRedemption = require('./models/VoucherRedemption');
const ResaleListing = require('./models/ResaleListing');
const { generateSeats } = require('./services/inventory.service');

const DAY = 24 * 60 * 60 * 1000;

// Attach one session per calendar day (with per-category availability) and
// persist it, so seat generation and dashboards can reference session ids.
const withSessions = async (event) => {
  const categoryIds = event.ticketCategories.map((c) => String(c._id));
  event.sessions = Event.buildSessions(event.startDate, event.endDate, [], categoryIds);
  await event.save();
  return event;
};

// Increment the sold counter on a session's category availability entry.
const bumpSessionSold = async (eventId, sessionId, categoryId, qty) => {
  await Event.updateOne(
    { _id: eventId, 'sessions._id': sessionId },
    { $inc: { 'sessions.$.availability.$[a].sold': qty } },
    { arrayFilters: [{ 'a.categoryId': String(categoryId) }] }
  );
};

const seed = async () => {
  await connectDB();
  console.log('[seed] clearing collections...');
  await Promise.all([
    User.deleteMany({}),
    Event.deleteMany({}),
    Ticket.deleteMany({}),
    Booking.deleteMany({}),
    Seat.deleteMany({}),
    LoyaltyReward.deleteMany({}),
    Redemption.deleteMany({}),
    Voucher.deleteMany({}),
    VoucherRedemption.deleteMany({}),
    ResaleListing.deleteMany({}),
  ]);

  // ---- Users ----
  const admin = await User.create({ name: 'Platform Admin', email: 'admin@eventease.app', password: 'AdminPass123!', role: 'admin', referralCode: 'ADMIN1' });
  const org1 = await User.create({ name: 'Marina Promotions', email: 'org1@eventease.app', password: 'OrgPass123!', role: 'organizer', organization: 'Marina Promotions Pte Ltd', isApproved: true });
  const org2 = await User.create({ name: 'Esplanade Theatre Co', email: 'org2@eventease.app', password: 'OrgPass123!', role: 'organizer', organization: 'Esplanade Theatre Co', isApproved: true });
  const org3 = await User.create({ name: 'SportSG Events', email: 'org3@eventease.app', password: 'OrgPass123!', role: 'organizer', organization: 'SportSG Events', isApproved: true });

  // Pending organizer: surfaces the approval queue in the admin Users tab.
  await User.create({ name: 'Starlight Events', email: 'org4@eventease.app', password: 'OrgPass123!', role: 'organizer', organization: 'Starlight Events Pte Ltd', isApproved: false });

  const customer = await User.create({ name: 'Demo Customer', email: 'demo@eventease.app', password: 'DemoPass123!', role: 'customer', referralCode: 'DEMO01' });

  console.log('[seed] users ready:', { admin: admin.email, org: org1.email, demo: customer.email });

  // Give the demo customer some loyalty points to spend in the marketplace.
  await User.updateOne({ _id: customer._id }, { $inc: { loyaltyPoints: 250 } });

  // ---- Loyalty marketplace rewards ----
  await LoyaltyReward.create([
    { name: 'EventEase Tote Bag', description: 'Canvas tote with the EventEase mark. Eco-friendly and roomy.', image: 'https://images.unsplash.com/photo-1594223274512-ad4803739b7c?w=400&q=60', pointsRequired: 120, stock: 50, category: 'merchandise' },
    { name: 'EventEase Beach Towel', description: 'Lightweight, quick-dry towel for festival season.', image: 'https://images.unsplash.com/photo-1570506020289-4f0d6cd3ef31?w=400&q=60', pointsRequired: 200, stock: 30, category: 'merchandise' },
    { name: '$10 Gift Card', description: '$10 off any booking on the platform.', image: 'https://images.unsplash.com/photo-1587588062326-147f6542f5e2?w=400&q=60', pointsRequired: 300, value: 10, stock: 100, category: 'gift_card' },
    { name: '$25 Gift Card', description: '$25 off any booking on the platform.', image: 'https://images.unsplash.com/photo-1574269909862-7e1d70bb8078?w=400&q=60', pointsRequired: 650, value: 25, stock: 60, category: 'gift_card' },
    { name: 'VIP Lounge Upgrade', description: 'Upgrade one booking to the VIP lounge at a participating event.', image: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=400&q=60', pointsRequired: 500, stock: 20, category: 'upgrade' },
  ]);

  const live = { status: 'published', approval: 'approved' };
  const upcoming = (days) => {
    const startDate = new Date(Date.now() + days * DAY);
    startDate.setHours(18, 0, 0, 0); // 6pm local, so +3h stays within one day
    return { startDate, endDate: new Date(+startDate + 3 * 3600e3) };
  };

  // ---- Concert: reserved seating ----
  const concert = await Event.create({
    ...upcoming(14),
    ...live,
    owner: org1._id,
    title: 'Aurora Skylights: Live in Concert',
    description: 'A stunning live concert blending cinematic orchestral arrangements with electronic soundscapes. Featuring special guest pianist Mei Tan.',
    category: 'concert',
    image: 'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=1200&q=80',
    venue: { name: 'The Star Theatre', address: '1 Vista Exchange Green', city: 'Singapore' },
    ticketCategories: [
      { name: 'VIP Premium', tier: 'vip', price: 168, qty: 60, earlyBirdPrice: 138, earlyBirdEnd: new Date(Date.now() + 5 * DAY) },
      { name: 'Standard', tier: 'standard', price: 88, qty: 240, earlyBirdPrice: 72, earlyBirdEnd: new Date(Date.now() + 5 * DAY) },
      { name: 'Concession', tier: 'concession', price: 48, qty: 100 },
    ],
    reservedSeating: true,
    promo: { enabled: true, message: 'Early bird ends in 5 days!', bannerColor: '#f59e0b' },
    accessibility: { wheelchair: true, hearingLoop: true },
    tags: ['Live Music', 'Pop', 'Singapore'],
  });
  await withSessions(concert);
  const concertSession = concert.sessions[0];
  await generateSeats(concert._id, [
    { categoryId: concert.ticketCategories[0]._id, name: 'VIP Premium', tier: 'vip', price: 168, rows: 4, cols: 10, startingRow: 'A' },
    { categoryId: concert.ticketCategories[1]._id, name: 'Standard', tier: 'standard', price: 88, rows: 12, cols: 20, startingRow: 'E' },
    { categoryId: concert.ticketCategories[2]._id, name: 'Concession', tier: 'concession', price: 48, rows: 4, cols: 16, startingRow: 'Q', accessibility: 'wheelchair' },
  ], concert.sessions);

  // Sales counters are driven only by the real bookings further down. Only the
  // view counter is cosmetic, so it alone is inflated here.
  const stdCat = concert.ticketCategories[1];
  await Event.updateOne({ _id: concert._id }, { $inc: { views: 4210 } });

  // ---- Theatre ----
  const theatre = await Event.create({
    ...upcoming(21),
    ...live,
    owner: org2._id,
    title: 'Shakespeare in the Dark',
    description: 'An immersive re-imagining of Macbeth performed in near-darkness with binaural sound design. Best experienced in our accessible hearing-loop booths.',
    category: 'theatre',
    image: 'https://images.unsplash.com/photo-1507925921958-8a62f3d1a50d?w=1200&q=80',
    venue: { name: 'Esplanade Theatre Studio', address: '1 Esplanade Drive', city: 'Singapore' },
    ticketCategories: [
      { name: 'Front Circle', tier: 'vip', price: 120, qty: 80 },
      { name: 'Dress Circle', tier: 'standard', price: 75, qty: 160, bundleOffer: { qty: 4, price: 260 } },
      { name: 'Student/Concession', tier: 'concession', price: 40, qty: 90 },
    ],
    reservedSeating: true,
    accessibility: { wheelchair: true, hearingLoop: true, sensory: true },
    promo: { enabled: true, message: 'Family bundle: buy 4 Dress Circle, pay $260', bannerColor: '#6366f1' },
    tags: ['Theatre', 'Immersive', 'Shakespeare'],
  });
  await withSessions(theatre);
  const theatreSession = theatre.sessions[0];
  await generateSeats(theatre._id, [
    { categoryId: theatre.ticketCategories[0]._id, name: 'Front Circle', tier: 'vip', price: 120, rows: 4, cols: 20, startingRow: 'A' },
    { categoryId: theatre.ticketCategories[1]._id, name: 'Dress Circle', tier: 'standard', price: 75, rows: 8, cols: 20, startingRow: 'E' },
    { categoryId: theatre.ticketCategories[2]._id, name: 'Concession', tier: 'concession', price: 40, rows: 4, cols: 18, startingRow: 'N', accessibility: 'hearingLoop' },
  ], theatre.sessions);

  // Demo confirmed theatre booking with REAL booked seat docs, so the account
  // view and the seat map stay consistent.
  const fcCat = theatre.ticketCategories[0];
  const fcPrice = Number(fcCat.price);
  const stageSeats = await Seat.find({ event: theatre._id, session: theatreSession._id, categoryId: fcCat._id, status: 'available' }).sort({ row: 1, number: 1 }).limit(2);
  const stageBooking = await Booking.create({
    user: customer._id,
    event: theatre._id,
    reference: 'EE-SEED02',
    items: [{
      sessionId: theatreSession._id,
      sessionDate: theatreSession.date,
      categoryId: fcCat._id,
      categoryName: fcCat.name,
      tier: fcCat.tier,
      unitPrice: fcPrice,
      qty: 2,
      seats: stageSeats.map((s) => ({ seatId: s._id, section: s.section, row: s.row, number: s.number, label: `${s.section} ${s.row}${s.number}` })),
      lineTotal: fcPrice * 2,
    }],
    subtotal: fcPrice * 2,
    discount: 0,
    total: fcPrice * 2,
    status: 'confirmed',
    payment: { provider: 'simulated', status: 'succeeded' },
  });
  await Seat.updateMany(
    { _id: { $in: stageSeats.map((s) => s._id) } },
    { $set: { status: 'booked', bookingId: stageBooking._id } }
  );
  await bumpSessionSold(theatre._id, theatreSession._id, fcCat._id, 2);
  const stageTickets = await Promise.all(stageSeats.map((s) => Ticket.create({
    user: customer._id,
    event: theatre._id,
    booking: stageBooking._id,
    sessionId: theatreSession._id,
    sessionDate: theatreSession.date,
    categoryName: fcCat.name,
    tier: fcCat.tier,
    section: s.section,
    row: s.row,
    number: s.number,
    seatLabel: `${s.section} ${s.row}${s.number}`,
    price: fcPrice,
  })));
  stageBooking.tickets = stageTickets.map((t) => t._id);
  await stageBooking.save();

  await Event.updateOne({ _id: theatre._id }, { $inc: { salesCount: 1, revenue: stageBooking.total, views: 3400 } });

  // ---- Sports: GA ----
  const sports = await Event.create({
    ...upcoming(7),
    ...live,
    owner: org3._id,
    title: 'SG Premier League: Finals Weekend',
    description: 'The title decider! Come and cheer on your team at the national stadium. General admission with standing sections and family zones.',
    category: 'sports',
    image: 'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?w=1200&q=80',
    venue: { name: 'National Stadium', address: '1 Stadium Drive', city: 'Singapore' },
    ticketCategories: [
      { name: 'Category 1', tier: 'vip', price: 60, qty: 2500 },
      { name: 'General Admission', tier: 'standard', price: 25, qty: 8000 },
      { name: 'Family Zone Concession', tier: 'concession', price: 15, qty: 1000, maxPerOrder: 10 },
    ],
    reservedSeating: false,
    accessibility: { wheelchair: true, sensory: true },
    tags: ['Football', 'Finals', 'Stadium'],
  });
  await withSessions(sports);
  await Event.updateOne({ _id: sports._id }, { $inc: { views: 18300 } });

  // ---- Cultural / Festival ----
  const festival = await Event.create({
    ...upcoming(30),
    ...live,
    owner: org1._id,
    title: 'Singapore Cultural Fiesta 2026',
    description: 'Three days of heritage arts, dance, music and food across Marina Bay. Day passes and 3-day passes available.',
    category: 'festival',
    image: 'https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=1200&q=80',
    venue: { name: 'Marina Bay Floating Platform', address: 'Marina Boulevard', city: 'Singapore' },
    ticketCategories: [
      { name: '3-Day Pass', tier: 'vip', price: 120, qty: 1200 },
      { name: 'Day Pass', tier: 'standard', price: 40, qty: 6000 },
      { name: 'Senior & Student', tier: 'concession', price: 25, qty: 2000 },
    ],
    reservedSeating: false,
    accessibility: { wheelchair: true, hearingLoop: true, sensory: true },
    promo: { enabled: true, message: 'Use FESTIVAL75 for 25% off day passes', bannerColor: '#ec4899' },
    tags: ['Festival', 'Culture', 'Food'],
  });
  await withSessions(festival);

  // ---- Dependent listings for other categories (theatre + sports + cultural) ----
  const culturalTalk = await Event.create({
    ...upcoming(11),
    ...live,
    owner: org2._id,
    title: 'Peranakan Stories: Heritage Talk',
    description: 'An evening of storytelling and artefacts celebrating Peranakan heritage in Singapore.',
    category: 'cultural',
    image: 'https://images.unsplash.com/photo-1511578314322-379afb476865?w=1200&q=80',
    venue: { name: 'Asian Civilisations Museum', address: '1 Empress Pl', city: 'Singapore' },
    ticketCategories: [{ name: 'Standard', tier: 'standard', price: 20, qty: 200 }, { name: 'Concession', tier: 'concession', price: 10, qty: 100 }],
    reservedSeating: false,
    accessibility: { wheelchair: true },
    tags: ['Heritage', 'Talk', 'Museum'],
  });
  await withSessions(culturalTalk);

  const standup = await Event.create({
    ...upcoming(5),
    ...live,
    owner: org2._id,
    title: 'Comedy Night: Laugh Riot',
    description: 'Five rising comedians, one night of laughs. 18+ show.',
    category: 'theatre',
    image: 'https://images.unsplash.com/photo-1527224857830-43a7acc85260?w=1200&q=80',
    venue: { name: 'The Projector', address: '6001 Beach Rd', city: 'Singapore' },
    ticketCategories: [{ name: 'General', tier: 'standard', price: 35, qty: 300 }, { name: 'VIP Booth', tier: 'vip', price: 55, qty: 20 }],
    reservedSeating: false,
    accessibility: { hearingLoop: true },
    promo: { enabled: true, message: 'Groups of 4+ save with FREE5 off $25 orders', bannerColor: '#14b8a6' },
    tags: ['Comedy', '18+'],
  });
  await withSessions(standup);

  // ---- Sample reserved-seating booking + tickets for demo customer (concert) ----
  const sampleSeats = await Seat.find({ event: concert._id, session: concertSession._id, categoryId: stdCat._id, status: 'available' })
    .sort({ row: 1, number: 1 })
    .limit(2);
  const sampleBooking = await Booking.create({
    user: customer._id,
    event: concert._id,
    reference: 'EE-SEED01',
    items: [{
      sessionId: concertSession._id,
      sessionDate: concertSession.date,
      categoryId: stdCat._id,
      categoryName: 'Standard',
      tier: 'standard',
      unitPrice: 88,
      qty: 2,
      seats: sampleSeats.map((s) => ({ seatId: s._id, section: s.section, row: s.row, number: s.number, label: `${s.section} ${s.row}${s.number}` })),
      lineTotal: 176,
    }],
    subtotal: 176,
    discount: 0,
    total: 176,
    status: 'confirmed',
    payment: { provider: 'simulated', status: 'succeeded' },
  });
  await Seat.updateMany(
    { _id: { $in: sampleSeats.map((s) => s._id) } },
    { $set: { status: 'booked', bookingId: sampleBooking._id } }
  );
  await bumpSessionSold(concert._id, concertSession._id, stdCat._id, 2);
  const t1 = await Ticket.create({ user: customer._id, event: concert._id, booking: sampleBooking._id, sessionId: concertSession._id, sessionDate: concertSession.date, categoryName: 'Standard', tier: 'standard', section: sampleSeats[0].section, row: sampleSeats[0].row, number: sampleSeats[0].number, seatLabel: `${sampleSeats[0].section} ${sampleSeats[0].row}${sampleSeats[0].number}`, price: 88, qrData: 'EVENTEASE:v1:seed:t1' });
  const t2 = await Ticket.create({ user: customer._id, event: concert._id, booking: sampleBooking._id, sessionId: concertSession._id, sessionDate: concertSession.date, categoryName: 'Standard', tier: 'standard', section: sampleSeats[1].section, row: sampleSeats[1].row, number: sampleSeats[1].number, seatLabel: `${sampleSeats[1].section} ${sampleSeats[1].row}${sampleSeats[1].number}`, price: 88, qrData: 'EVENTEASE:v1:seed:t2' });
  sampleBooking.tickets = [t1._id, t2._id];
  await sampleBooking.save();
  await Event.updateOne({ _id: concert._id }, { $inc: { salesCount: 1, revenue: sampleBooking.total } });

  // ---- Demo voucher redemption code (admin-created, for the concert) ----
  const demoVoucher = await Voucher.create({
    code: 'AUROVA20',
    title: 'Aurora Skylights special',
    description: '20% off Aurora Skylights tickets redeemed before the show.',
    event: concert._id,
    type: 'percent',
    value: 20,
    maxDiscount: 30,
    minSpend: 50,
    usageLimit: 100,
    perUserLimit: 1,
    expiresAt: new Date(concert.startDate.getTime() - 24 * 3600e3),
    active: true,
    createdBy: admin._id,
  });
  console.log('[seed] demo voucher: AUROVA20 →', concert.title);

  // ---- Sample flagged-customer history for the fraud monitor ----
  // Give the demo customer enough cancellations/expirations in the last 7
  // days to appear on the admin fraud tab, with explicit timestamps.
  const cancelEvents = [concert, theatre, sports, festival, standup];
  const cancelTitles = ['Venue upgrade cancelled by organiser', 'Purchase or drag error', 'Found a better session', 'No longer attending'];
  for (let i = 0; i < 6; i += 1) {
    const ev = cancelEvents[i % cancelEvents.length];
    const cat = ev.ticketCategories[0];
    const price = Number(cat.price);
    const at = new Date(Date.now() - (i * 26 + 9) * 3600e3);
    const booking = await Booking.create({
      user: customer._id,
      event: ev._id,
      reference: `EE-CANC${String(i + 1).padStart(2, '0')}`,
      items: [{
        sessionId: ev.sessions[0]?._id,
        sessionDate: ev.sessions[0]?.date,
        categoryId: cat._id,
        categoryName: cat.name,
        tier: cat.tier,
        unitPrice: price,
        qty: 1,
        seats: [],
        lineTotal: price,
      }],
      subtotal: price,
      discount: 0,
      total: price,
      status: i === 5 ? 'expired' : 'cancelled',
      payment: { provider: 'simulated', status: 'pending' },
      cancelReason: cancelTitles[i % cancelTitles.length],
    });
    await Booking.collection.updateOne(
      { _id: booking._id },
      { $set: { createdAt: at, updatedAt: at } }
    );
  }
  console.log('[seed] sample flagged-customer history → 5 cancelled + 1 expired in last 7 days');

  console.log('[seed] sample events:');
  console.log('  concert:', concert.slug);
  console.log('  theatre:', theatre.slug);
  console.log('  sports:', sports.slug);
  console.log('  festival:', festival.slug);
  console.log('  cultural:', culturalTalk.slug);
  console.log('  comedy:', standup.slug);
  console.log('[seed] demo bookings for customer:');
  console.log('  ', sampleBooking.reference, '· Aurora Skylights (2 Standard seats)');
  console.log('  ', stageBooking.reference, `· Shakespeare in the Dark (${stageSeats.map((s) => `${s.section} ${s.row}${s.number}`).join(', ')})`);
  console.log('[seed] demo accounts:');
  console.log('  admin:   admin@eventease.app / AdminPass123!');
  console.log('  org:     org1@eventease.app / OrgPass123!');
  console.log('  customer:demo@eventease.app / DemoPass123!');

  await mongoose.disconnect();
  console.log('[seed] done.');
};

seed().catch((e) => {
  console.error('[seed] error:', e);
  process.exit(1);
});