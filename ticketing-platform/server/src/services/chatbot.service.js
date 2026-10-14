const Event = require('../models/Event');
const Seat = require('../models/Seat');
const inventoryService = require('./inventory.service');
const { createBookingForUser, lineTotals } = require('../controllers/booking.controller');
const { listAvailableEntitlements, resolveEntitlements } = require('../controllers/voucher.controller');

// ---------------------------------------------------------------------------
// Lightweight NLP: tokenisation, stopwords, light stemming, TF-IDF + cosine.
// No external deps. Indexes both static site docs and LIVE event data.
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  'a','an','and','or','but','if','then','else','for','of','on','in','at','to','is','are','was','were','be','been',
  'being','do','does','did','can','could','will','would','should','shall','may','might','must','has','have','had',
  'how','what','when','where','which','who','whom','this','that','these','those','i','you','he','she','it','we',
  'they','me','him','her','us','them','my','your','our','their','from','by','with','about','into','over','under',
  'again','once','here','there','all','any','both','each','few','more','most','other','some','such','no','nor',
  'not','only','own','same','so','than','too','very','just','don','now','please','am','arent','cant','don','lets',
  'im','ive','theres','whats','thats','wont','etc','want','like','need','know','tell','show','find','looking','looking','can','what','need','would','does','give'
]);

const CATEGORY_LABELS = { concert: 'concert', theatre: 'theatre', sports: 'sports', cultural: 'cultural', festival: 'festival', other: 'other' };

const lightStem = (w) => {
  if (w.length < 4) return w;
  if (w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.endsWith('ing')) return w.slice(0, -3);
  if (w.endsWith('ed')) return w.slice(0, -2);
  if (w.endsWith('es')) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
};

const tokenize = (text) => {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map(lightStem)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
};

// ---------------------------- Static website knowledge base ----------------------------

const STATIC_DOCS = [
  {
    id: 'greeting',
    keywords: ['hello', 'hi', 'hey', 'yo', 'morning'],
    text: 'Greetings. I am Ease, the EventEase assistant. I can answer questions about the site, events, tickets, payments and policies. Ask me about concerts in Singapore, how booking works, refunds, or transfers.',
    answer: 'Hi! I am Ease, the EventEase assistant. Ask me about events, booking, payment, refunds, transfers, resale or account help — I answer from the live site data.',
  },
  {
    id: 'booking',
    keywords: ['book', 'booking', 'how to', 'checkout', 'buy ticket', 'purchase', 'order', 'buying'],
    text: 'Booking tickets EventEase. Browse events homepage pick ticket category seats reserved seating complete payment at checkout get e-ticket with QR code instantly. Seats held ten minutes while paying.',
    answer: 'To book: find an event, choose a ticket category (and seats for reserved seating), then click "Continue to checkout" and complete payment. Your e-ticket with QR code is issued instantly after payment succeeds.',
  },
  {
    id: 'payment',
    keywords: ['pay', 'payment', 'paynow', 'stripe', 'card', 'credit', 'debit', 'money', 'payby', 'checkout pay'],
    text: 'Payments EventEase supports simulated payment demo PayNow Stripe test cards. Payment taken at checkout booking confirmed when payment succeeds. Cash not accepted.',
    answer: 'EventEase supports simulated payments (demo), PayNow, and Stripe test cards. Payment is taken at checkout and the booking is confirmed the moment it succeeds.',
  },
  {
    id: 'ticket',
    keywords: ['ticket', 'eticket', 'e ticket', 'qr', 'qrcode', 'barcode', 'scann', 'digital', 'entry'],
    text: 'E-tickets EventEase QR code account tickets show qr venue scans once at entry validation counted. Present QR at the venue gates. Each ticket licensed for one admission.',
    answer: 'After payment you get an e-ticket with a QR code. Go to Account → Tickets → "Show QR" to display it. The venue scans it once at entry. Each admission is counted.',
  },
  {
    id: 'refund',
    keywords: ['refund', 'cancel', 'cancellation', 'return', 'money back', 'reschedule', 'refund policy'],
    text: 'Refunds cancellations EventEase. Pending unpaid bookings cancelled instantly released no charge. Confirmed bookings request refund submitted admin approval review case by case. Event cancelled organizer refund policy.',
    answer: 'Unpaid (pending) bookings can be cancelled instantly. Paid bookings can be submitted for a refund, which goes to admin review and approval. If an event is cancelled by the organiser, eligible bookings are refunded per the organizer\'s policy.',
  },
  {
    id: 'resale',
    keywords: ['resale', 'resell', 'sell', 'marketplace', 'second hand', 'listing', 'list ticket'],
    text: 'Resale market EventEase list active ticket resell from account tickets resell button. Other customers buy directly. Tickets also transferred privately free.',
    answer: 'You can list an active ticket on the resale market from Account → Tickets → "Resell". Other customers can buy it directly, and private transfers are also free.',
  },
  {
    id: 'transfer',
    keywords: ['transfer', 'give', 'share', 'send', 'friend', 'another person', 'someone'],
    text: 'Ticket transfer EventEase account tickets transfer creates transfer code share code recipient claims at transfer page logged in. Previous owner notified.',
    answer: 'To send a ticket: Account → Tickets → "Transfer" to create a transfer code. Share the code with the recipient, who claims it at /transfer/:code while logged in.',
  },
  {
    id: 'account',
    keywords: ['account', 'login', 'log in', 'sign in', 'password', 'register', 'sign up', 'profile', 'demo'],
    text: 'Accounts login registration EventEase customer organizer admin roles. Sign up button register demo accounts listed on login page. Account shows bookings tickets vouchers loyalty marketplace notifications profile accessibility.',
    answer: 'Create an account with "Sign up", then log in with "Log in". You can be a customer or an organizer. Demo accounts are shown on the login page. Your account holds bookings, tickets, vouchers, loyalty rewards and notification settings.',
  },
  {
    id: 'organizer',
    keywords: ['organizer', 'organiser', 'venue', 'host', 'create event', 'sell event', 'become organizer', 'list event'],
    text: 'Organizers EventEase become organizer apply account organization admin approves role. Organizer dashboard create event review admin then published. Analytics forecast.',
    answer: 'Organizers can apply from their account ("Become an organizer"), then create events from the Organizer Dashboard. Events are reviewed by an admin before going live, and the dashboard shows sales analytics.',
  },
  {
    id: 'discounts',
    keywords: ['coupon', 'promo', 'discount', 'voucher', 'gift', 'credit', 'code'],
    text: 'Discounts vouchers gift cards EventEase account rewards apply automatically at checkout stack.',
    answer: 'Discounts come from vouchers and loyalty gift cards — redeem either under Account, then tick the ones you want at checkout. They stack and apply automatically. A referral code instead earns loyalty points for both you and the person you refer.',
  },
  {
    id: 'seats',
    keywords: ['seat', 'seating', 'reserved', 'hold', 'sit', 'row', 'section', 'stage'],
    text: 'Reserved seating seat map EventEase pick seats seat map checkout held 10 minutes while pay then released if not completed. General admission no seat.',
    answer: 'Reserved-seating events let you pick seats on the seat map. Seats are held for 10 minutes while you pay, then released if you don\'t complete. General admission has no assigned seats.',
  },
  {
    id: 'validate',
    keywords: ['validate', 'scanner', 'scan qr', 'organizer tool', 'admission', 'check in'],
    text: 'Ticket validation EventEase organizer dashboard validate ticket enter code scan QR result valid invalid entry count tracked.',
    answer: 'Organizers can validate tickets from the Organizer Dashboard → QR validation tool. Enter the ticket code or scan the QR to check validity and count entries.',
  },
  {
    id: 'terms',
    keywords: ['terms', 'condition', 'policy', 'legal', 'privacy', 'governing', 'rule'],
    text: 'Terms of Use and Terms Conditions EventEase explain refunds cancellations resale entry conduct governing law Singapore. See footer links.',
    answer: 'Our Terms of Use and Terms & Conditions cover refunds, cancellations, resale, entry rules and governing law (Singapore). See the Legal links in the footer.',
  },
  {
    id: 'contact',
    keywords: ['contact', 'support', 'help desk', 'email us', 'feedback', 'human', 'agent'],
    text: 'Contact support EventEase team reachable email support channel footer. The chatbot covers common questions contact team otherwise.',
    answer: 'For anything the assistant can\'t answer, contact the EventEase team via the support channels in the footer.',
  },
  {
    id: 'accessibility',
    keywords: ['accessibility', 'wheelchair', 'hearing', 'sensory', 'disabled', 'a11y', 'contrast', 'larger text'],
    text: 'Accessibility EventEase venues events flag wheelchair access hearing loop sensory friendly. Site high contrast larger text reduced motion in A11y menu. Each event shows its accessibility flags.',
    answer: 'Each event page shows its accessibility flags (wheelchair access, hearing loop, sensory-friendly). The site has a ♿ A11y menu for high contrast, larger text, and reduced motion.',
  },
  {
    id: 'loyalty',
    keywords: ['loyalty', 'points', 'referral', 'reward', 'vip'],
    text: 'Loyalty points referral EventEase account shows loyalty points referral code earn rewards booking resale marketplace rewards.',
    answer: 'You earn loyalty points from bookings, ticket resales, and referrals — see your balance in Account, and spend points on rewards under Account → Loyalty Marketplace.',
  },
];

// ---------------------------- TF-IDF index ----------------------------

let cachedIndex = null;
let cachedAt = 0;
const CACHE_TTL = 60 * 1000;

const buildIndex = async (force = false) => {
  const now = Date.now();
  if (cachedIndex && !force && now - cachedAt < CACHE_TTL) return cachedIndex;

  const events = await Event.find({
    approval: 'approved',
    status: { $ne: 'cancelled' },
    endDate: { $gte: new Date() },
  })
    .select('title slug description category venue startDate endDate ticketCategories tags accessibility')
    .lean()
    .exec();

  const docs = STATIC_DOCS.map((d) => ({ kind: 'static', id: d.id, keywords: d.keywords, text: d.text, answer: d.answer, link: d.link }));
  for (const ev of events) {
    const cats = ev.ticketCategories || [];
    const minPrice = cats.length ? Math.min(...cats.map((c) => c.price || 0)) : 0;
    const catLabel = CATEGORY_LABELS[ev.category] || ev.category;
    const text = [
      ev.title,
      ev.description,
      catLabel,
      ev.venue && ev.venue.name,
      ev.venue && ev.venue.city,
      cats.map((c) => `${c.name} ticket ${c.price || ''}`).join(' '),
      (ev.tags || []).join(' '),
      ev.accessibility && ev.accessibility.wheelchair ? 'wheelchair access' : '',
      ev.accessibility && ev.accessibility.hearingLoop ? 'hearing loop' : '',
      ev.accessibility && ev.accessibility.sensory ? 'sensory friendly' : '',
    ].join(' ');
    docs.push({
      kind: 'event',
      id: ev._id.toString(),
      keywords: [ev.title, catLabel, ev.venue && ev.venue.city, ev.venue && ev.venue.name],
      text,
      answer: null,
      link: `/events/${ev.slug}`,
      event: {
        id: ev._id.toString(),
        title: ev.title,
        slug: ev.slug,
        category: ev.category,
        city: ev.venue && ev.venue.city,
        venue: ev.venue && ev.venue.name,
        startDate: ev.startDate,
        endDate: ev.endDate,
        minPrice,
        accessibility: ev.accessibility,
      },
    });
  }

  const docTokens = docs.map((d) => tokenize(d.text));
  const df = new Map();
  docTokens.forEach((tokens) => {
    new Set(tokens).forEach((t) => df.set(t, (df.get(t) || 0) + 1));
  });
  const N = docTokens.length;

  const vectors = docTokens.map((tokens) => {
    const counts = new Map();
    tokens.forEach((t) => counts.set(t, (counts.get(t) || 0) + 1));
    const vec = {};
    counts.forEach((cnt, t) => {
      const tf = 1 + Math.log(cnt);
      const idf = Math.log(N / ((df.get(t) || 1)));
      vec[t] = tf * idf;
    });
    return vec;
  });

  cachedIndex = { docs, vectors, N, df };
  cachedAt = now;
  console.log(`[chatbot] index built with ${N} documents (${events.length} events)`);
  return cachedIndex;
};

const cosine = (a, b) => {
  let dot = 0, ma = 0, mb = 0;
  for (const t in b) if (a[t]) dot += a[t] * b[t];
  for (const t in a) ma += a[t] * a[t];
  for (const t in b) mb += b[t] * b[t];
  if (ma === 0 || mb === 0) return 0;
  return dot / (Math.sqrt(ma) * Math.sqrt(mb));
};

const score = (queryTokens, doc, docVec) => {
  const cos = cosine(queryVec(queryTokens), docVec);
  const qset = new Set(queryTokens);
  const kset = new Set((doc.keywords || []).map((k) => tokenize(k).join(' ')).filter(Boolean));
  let keywordOverlap = 0;
  qset.forEach((t) => {
    const tstr = t;
    kset.forEach((k) => {
      if (k === tstr || k.includes(tstr) || tstr.includes(k)) keywordOverlap += 1;
    });
  });
  return cos * 0.7 + Math.min(0.3, keywordOverlap * 0.15);
};

const queryVec = (queryTokens) => {
  const vec = {};
  queryTokens.forEach((t) => { vec[t] = (vec[t] || 0) + 1; });
  return vec;
};

// ---------------------------- Answer construction ----------------------------

const CATEGORIES = ['concert', 'theatre', 'sports', 'cultural', 'festival'];
const CATEGORY_SYNONYMS = {
  concert: ['concert', 'gig', 'music', 'live', 'band', 'dj', 'show'],
  theatre: ['theatre', 'theater', 'play', 'musical', 'drama', 'stage'],
  sports: ['sports', 'match', 'game', 'football', 'soccer', 'basketball', 'race', 'tennis'],
  cultural: ['cultural', 'museum', 'art', 'heritage', 'exhibition'],
  festival: ['festival', 'fiesta', 'fete', 'carnival'],
};
const CITY_KEYWORDS = ['singapore', 'sg'];
const CITY_NAMES = { singapore: 'Singapore', sg: 'Singapore' };

const containsAny = (tokens, list) => tokens.some((t) => list.includes(t));

const formatMoney = (n) => (n ? `$${n}` : 'Free');

const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const formatDateRange = (start, end) => {
  if (!start) return 'Date to be announced';
  const s = new Date(start);
  const e = end ? new Date(end) : null;
  const sDay = s.getDate();
  const sMonth = SHORT_MONTHS[s.getMonth()];
  const sYear = s.getFullYear();
  if (!e) return `${sDay} ${sMonth} ${sYear}`;
  const sameDay = sDay === e.getDate() && s.getMonth() === e.getMonth() && sYear === e.getFullYear();
  if (sameDay) return `${sDay} ${sMonth} ${sYear}`;
  const sameMonth = s.getMonth() === e.getMonth() && sYear === e.getFullYear();
  if (sameMonth) return `${sDay}–${e.getDate()} ${sMonth} ${sYear}`;
  const eDay = e.getDate();
  const eMonth = SHORT_MONTHS[e.getMonth()];
  const eYear = e.getFullYear();
  if (sYear === eYear) return `${sDay} ${sMonth} – ${eDay} ${eMonth} ${sYear}`;
  return `${sDay} ${sMonth} ${sYear} – ${eDay} ${eMonth} ${eYear}`;
};

const formatTime = (d) => {
  if (!d) return '';
  return new Date(d).toLocaleTimeString('en-SG', { hour: 'numeric', minute: '2-digit' });
};

const formatDateTime = (start) => {
  if (!start) return 'Date to be announced';
  const t = formatTime(start);
  return t ? `${formatDateRange(start, null)} · ${t}` : formatDateRange(start, null);
};

const buildEventReply = (evs) => {
  if (evs.length === 1) {
    const e = evs[0];
    const parts = [
      `**${e.title}**`,
      `📅 ${formatDateRange(e.startDate, e.endDate)}, ${formatTime(e.startDate)} · 📍 ${e.venue || ''}, ${e.city || ''}`,
      `🎟 from ${formatMoney(e.minPrice)}`,
      `Link: /events/${e.slug}`,
    ];
    return { reply: parts.join('\n'), link: `/events/${e.slug}` };
  }
  const lines = evs.slice(0, 3).map(
    (e, i) => `${i + 1}. **${e.title}** — ${formatDateTime(e.startDate)} · ${e.city || ''} · from ${formatMoney(e.minPrice)} (${e.venue || ''})`
  );
  return { reply: `Here are ${Math.min(3, evs.length)} event${evs.length > 1 ? 's' : ''} I found:\n${lines.join('\n')}\n\nReply with the number to book one!`, link: null };
};

// ---------------------------- Intent / query handling ----------------------------

const tryEventQuery = async (queryTokens) => {
  const isAboutEvents =
    containsAny(queryTokens, ['event', 'events', 'tickets', 'buy', 'concert', 'gig', 'show', 'whats', 'what', 'available', 'upcoming', 'happen']);

  // Category filter
  let category = null;
  for (const c of CATEGORIES) if (containsAny(queryTokens, CATEGORY_SYNONYMS[c])) { category = c; break; }
  let city = null;
  for (const k of CITY_KEYWORDS) if (queryTokens.includes(k)) city = CITY_NAMES[k];

  if (!isAboutEvents && !category && !city) return null;

  const idx = await buildIndex();
  const allPairs = idx.docs.map((d, i) => ({ d, vec: idx.vectors[i] }));
  const eventPairs = allPairs.filter((p) => p.d.kind === 'event');

  const scored = eventPairs.map((p) => ({ d: p.d, s: score(queryTokens, p.d, p.vec) }));
  let matches = scored.filter((x) => x.s > 0.12).sort((a, b) => b.s - a.s).map((x) => x.d);

  if (city) {
    const cityFiltered = matches.filter((d) => tokenize(`${d.event.city}`).some((t) => tokenize(city).includes(t)));
    if (cityFiltered.length) matches = cityFiltered;
  }
  if (category) {
    const catFiltered = matches.filter((d) => { const tok = tokenize(d.event.category); return tok.includes(category) || CATEGORY_SYNONYMS[category].some((s) => tokenize(s).includes(category)); });
    if (catFiltered.length) matches = catFiltered;
  }

  if (!matches.length) {
    const anyEvents = scored.filter((x) => x.s > 0.08).sort((a, b) => b.s - a.s).slice(0, 3);
    if (!anyEvents.length) {
      return category
        ? { reply: `I couldn't find ${category} events right now. Try browsing the homepage or the Resale market.`, link: null }
        : { reply: "I couldn't find events matching that. Try browsing the homepage, or ask about a specific city, category or date.", link: null };
    }
    return buildEventReply(anyEvents.map((x) => x.d.event));
  }
  return buildEventReply(matches.slice(0, 3).map((d) => d.event));
};

// ---------------------------- Booking assistant ----------------------------
//
// Ease can walk a user through a full booking: find a show -> pick a date ->
// how many people -> seat selection (reserved) / ticket type (GA) -> price
// summary -> create a held booking -> inline payment. State is kept per
// chat session (in-memory) and the front-end renders interactive bubbles
// (choice buttons, a mini seat map, and a payment card). Fits natively with
// the existing TF-IDF Q&A: unrelated questions are answered normally and the
// booking can be resumed afterwards.
// -------------------------------------------------------------------------

const BOOKING_SESSION_TTL = 40 * 60 * 1000;
const bookingSessions = new Map();

const getBookingSession = (sessionId) => {
  if (!sessionId) return null;
  let s = bookingSessions.get(sessionId);
  if (!s) {
    s = { stage: 'idle', touchedAt: Date.now() };
    bookingSessions.set(sessionId, s);
  }
  s.touchedAt = Date.now();
  return s;
};

const bookingSessionSweep = setInterval(() => {
  const now = Date.now();
  for (const [id, s] of bookingSessions) {
    if (now - s.touchedAt > BOOKING_SESSION_TTL) bookingSessions.delete(id);
  }
}, 5 * 60 * 1000);
if (bookingSessionSweep.unref) bookingSessionSweep.unref();

const resetBooking = (session) => {
  for (const k of Object.keys(session)) delete session[k];
  session.stage = 'idle';
  session.touchedAt = Date.now();
};

const COUNT_WORDS = { one: 1, single: 1, two: 2, pair: 2, couple: 2, three: 3, few: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

const parseCount = (raw) => {
  const text = String(raw || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (/(none|zero|nobody|no one)/.test(text)) return null;
  if (/(just me|myself|alone|by myself|only me|single person|one person)/.test(text)) return 1;
  const num = text.match(/(\d+)/);
  if (num) return Math.max(1, Math.min(12, parseInt(num[1], 10)));
  if (/\ba couple\b|\ba pair\b|two persons|two of us|2/.test(text)) return 2;
  if (/\ba few\b|three of us/.test(text)) return 3;
  for (const w of Object.keys(COUNT_WORDS)) {
    if (text.split(' ').includes(w)) return COUNT_WORDS[w];
  }
  return null;
};

const ORDINALS = { '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5, '6th': 6, '7th': 7, '8th': 8, '9th': 9, '10th': 10, first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };

const pickIndex = (tokens, clean) => {
  const ordinal = clean.match(/\b(1st|2nd|3rd|4th|5th|6th|7th|8th|9th|10th|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|the last|last one)\b/);
  if (ordinal) {
    if (ordinal[1] === 'the last' || ordinal[1] === 'last one') return -1;
    return ORDINALS[ordinal[1]] || null;
  }
  const num = clean.match(/(\d+)/);
  return num ? parseInt(num[1], 10) : null;
};

const effectivePrice = (cat, now = new Date()) =>
  cat.earlyBirdPrice != null && cat.earlyBirdEnd && now <= new Date(cat.earlyBirdEnd) ? cat.earlyBirdPrice : cat.price;

const formatSessionDate = (d) => {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
};

const loadEventById = async (id) => {
  if (!id) return null;
  return Event.findById(id);
};

const searchEventsForBooking = async (tokens) => {
  const idx = await buildIndex();
  const pairs = idx.docs.map((d, i) => ({ d, vec: idx.vectors[i] })).filter((p) => p.d.kind === 'event');
  const scored = pairs
    .map((p) => ({ d: p.d, s: score(tokens, p.d, p.vec) }))
    .filter((x) => x.s > 0.05)
    .sort((a, b) => b.s - a.s);
  return scored.slice(0, 6).map((x) => x.d);
};

const searchEventsByCategory = async (tokens, category) => {
  const results = await searchEventsForBooking(tokens);
  if (!category) return results;
  const catFiltered = results.filter((d) => d.event.category === category);
  return catFiltered.length ? catFiltered : results;
};

const loadSeatsFor = async (eventId, sessionId) => {
  const filter = { event: eventId, status: { $in: ['available', 'held', 'booked'] } };
  if (sessionId) filter.$or = [{ session: sessionId }, { session: null }];
  return Seat.find(filter)
    .select('_id session section row number status price categoryId categoryName tier')
    .lean();
};

const sessionAvailOf = (event, sessionId, catId) => {
  const s = sessionId && (event.sessions || []).find((x) => String(x._id) === String(sessionId));
  const a = s && (s.availability || []).find((x) => String(x.categoryId) === String(catId));
  return a || null;
};

const categoryAvail = (event, cat, sessionId) => {
  if (sessionId && (event.sessions || []).length) {
    const a = sessionAvailOf(event, sessionId, cat._id);
    return a ? Math.max(0, Number(cat.qty) - (a.sold || 0) - (a.held || 0)) : 0;
  }
  return Math.max(0, Number(cat.qty) - (cat.sold || 0) - (cat.held || 0));
};

const looksLikeBookingIntent = (tokens, clean) => {
  const c = String(clean || '').toLowerCase();
  // "how do I book..." is a question about the process, not a request to book.
  if (/\bhow\b/.test(c) && /\bbook|\bticket|\bbooking/.test(c)) return false;
  if (/^(what|which|where|is there|are there|is it|do you)/.test(c)) return false;
  const bookingWords = ['book', 'booking', 'buy', 'buying', 'purchase', 'purchas', 'reserve', 'reserv', 'reservation', 'ticket', 'tickets', 'attend', 'going', 'seat', 'seats'];
  if (tokens.some((t) => bookingWords.includes(t))) return true;
  if (/want to go|would like to (see|go|attend|book|watch)|interested in|wanna|want to see|take me to|help me (book|buy|get)|going to (see|watch|attend)|(i|we) (want|need|would like).*(ticket|seat|in|for)|sign me up|book us/.test(c)) return true;
  return false;
};

const eventChoicesReply = (results) => ({
  reply: 'Sure thing! I found a few shows — which one would you like to book?',
  bubble: {
    type: 'choices',
    context: 'event',
    header: 'Choose a show',
    options: results.slice(0, 5).map((d) => ({
      id: d.event.id,
      label: d.event.title,
      sub: `${formatDateRange(d.event.startDate, d.event.endDate)}, ${formatTime(d.event.startDate)} · ${d.event.city} · from ${formatMoney(d.event.minPrice)}`,
    })),
  },
});

const browseCategory = async (session, category) => {
  if (!CATEGORIES.includes(category)) {
    return { reply: 'Sorry, I don\'t recognise that category. Try picking one below. 👇', bubble: browseCategoriesReply().bubble };
  }
  const idx = await buildIndex();
  const docs = idx.docs
    .filter((d) => d.kind === 'event' && d.event.category === category)
    .slice(0, 5);
  if (!docs.length) {
    return {
      reply: `We don't have any upcoming **${CATEGORY_LABELS[category] || category}** events right now. Want to try another category?`,
      bubble: browseCategoriesReply().bubble,
    };
  }
  session.candidates = docs;
  session.stage = 'event';
  session.categoryFilter = category;
  return eventChoicesReply(docs);
};

const askCountReply = (event) => ({
  reply: event.reservedSeating
    ? `Great pick! 🙌 **${event.title}** at ${event.venue && event.venue.name}. That one's reserved seating — how many people should I look for seats for?`
    : `Great pick! 🙌 **${event.title}** — how many tickets would you like?`,
  bubble: null,
});

const sessionChoicesReply = (event) => ({
  reply: `**${event.title}** runs on a few dates — which one works best for you?`,
  bubble: {
    type: 'choices',
    context: 'session',
    header: 'Pick a date',
    options: (event.sessions || []).map((s) => ({ id: String(s._id), label: formatSessionDate(s.date), sub: formatTime(s.date) })),
  },
});

const categoryChoicesReply = (session, event) => {
  const opts = (event.ticketCategories || []).map((c) => {
    const avail = categoryAvail(event, c, session.sessionId);
    const price = effectivePrice(c);
    const disabled = avail < session.qty;
    return {
      id: String(c._id),
      label: `${c.name} — $${price}`,
      sub: disabled ? `Only ${avail} left on that date` : `${avail} left · max ${c.maxPerOrder || 8} per order`,
      disabled,
    };
  });
  return {
    reply: `Nice — for **${session.qty}** ticket${session.qty > 1 ? 's' : ''}, which of these would you like?`,
    bubble: { type: 'choices', context: 'category', header: 'Choose a ticket type', options: opts },
  };
};

const seatMapReply = async (session, event) => {
  const seats = await loadSeatsFor(session.eventId, session.sessionId);
  session.stage = 'seats';
  session.currentSeats = seats;
  session.seatDocs = [];
  const pickText = session.qty === 1 ? 'pick one seat' : `pick ${session.qty} seats`;
  return {
    reply: `Here's the live seat map for **${event.title}** — just ${pickText} and hit confirm. 💺`,
    bubble: {
      type: 'seats',
      eventId: session.eventId,
      sessionId: session.sessionId || null,
      qty: session.qty,
      seats,
    },
  };
};

const selectEvent = async (session, evId) => {
  const event = await loadEventById(evId);
  if (!event) return { reply: "Hmm, I couldn't find that event any more. Let's try again — which show?", bubble: null };
  session.eventId = String(event._id);
  session.event = event;
  session.seatDocs = [];
  session.categoryId = null;
  const sess = event.sessions || [];
  if (sess.length > 1) {
    session.stage = 'session';
    return sessionChoicesReply(event);
  }
  if (sess.length === 1) session.sessionId = String(sess[0]._id);
  session.stage = 'count';
  return askCountReply(event);
};

const handleCount = async (session, n) => {
  const event = session.event;
  if (!event) return { reply: "I've lost track of the event — want to tell me which show again?", bubble: null };
  session.qty = n;
  if (event.reservedSeating) {
    session.stage = 'seats';
    return seatMapReply(session, event);
  }
  session.stage = 'category';
  return categoryChoicesReply(session, event);
};

const selectCategory = async (session, catId) => {
  const event = session.event;
  const cat = event.ticketCategories.find((c) => String(c._id) === String(catId));
  if (!cat) return { reply: 'That ticket type is not available. Try another one?', bubble: null };
  session.categoryId = String(cat._id);
  session.categoryName = cat.name;
  return confirmSummaryReply(session);
};

const buildFlowItems = (session) => {
  const event = session.event;
  if (event.reservedSeating) {
    const groups = new Map();
    (session.seatDocs || []).forEach((s) => {
      const k = String(s.categoryId);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(s);
    });
    return [...groups.values()].map((g) => ({
      categoryId: String(g[0].categoryId),
      qty: g.length,
      sessionId: session.sessionId || undefined,
      seatIds: g.map((s) => String(s._id)),
    }));
  }
  return [{ categoryId: session.categoryId, qty: session.qty, sessionId: session.sessionId || undefined }];
};

// Works out what discount the chat should quote for the current selection.
// Until the customer picks something, this falls back to the single best
// entitlement so the chat keeps behaving as it did before the dropdown existed.
// Once `selectedEntitlementIds` is set, exactly that set is stacked; ids that are
// no longer spendable (already used, wrong event, subtotal too small) are dropped
// and the summary is re-quoted so the customer confirms the new total.
const resolveChatSelection = async ({ session, userId, eventId, subtotal, offers }) => {
  const validIds = new Set((offers || []).map((o) => String(o.id)));

  // No choice made yet: quote full price. Rewards are opt-in everywhere, so the
  // chat never applies one the customer did not tick.
  if (!Array.isArray(session.selectedEntitlementIds)) {
    session.selectedEntitlementIds = [];
    return { discount: 0, discountName: null, entitlementId: null, selectedIds: [] };
  }

  const ids = session.selectedEntitlementIds.map(String).filter((id) => validIds.has(id));
  if (!ids.length) {
    session.selectedEntitlementIds = [];
    return { discount: 0, discountName: null, entitlementId: null, selectedIds: [] };
  }
  session.selectedEntitlementIds = ids;

  const resolved = await resolveEntitlements({ userId, eventId, subtotal, entitlementIds: ids });
  return {
    discount: resolved.discount,
    discountName: resolved.labels.join(' + '),
    entitlementId: ids[0],
    selectedIds: ids,
  };
};

const confirmSummaryReply = async (session, { includePicker = true } = {}) => {
  const event = session.event;
  const items = buildFlowItems(session);
  let subtotal;
  let summary;
  // Declared out here so the picker bubble below can still read them when the
  // quote throws and falls through to the recovery reply.
  let discountAmount = 0;
  let offers = [];
  try {
    const computed = lineTotals(event, items);
    subtotal = computed.reduce((s, c) => s + c.lineTotal, 0);

    // Everything this customer could spend on this booking, so the chat can offer
    // the same multi-select the checkout page does. Defaults to the best single
    // entitlement (the previous behaviour) until they pick something else.
    let discountName = null;
    const sessionUser = session.user;
    if (sessionUser) {
      try {
        offers = await listAvailableEntitlements({
          userId: String(sessionUser._id),
          eventId: String(event._id),
          subtotal,
        });

        const picked = await resolveChatSelection({ session, userId: String(sessionUser._id), eventId: String(event._id), subtotal, offers });
        discountAmount = picked.discount;
        discountName = picked.discountName;
        session.voucherDiscount = picked.discount > 0
          ? { amount: picked.discount, name: picked.discountName, entitlementId: picked.entitlementId }
          : null;
      } catch (_) {
        session.voucherDiscount = null;
        offers = [];
      }
    }

    const total = Math.max(0, subtotal - discountAmount);

    if (event.reservedSeating) {
      const seatList = (session.seatDocs || []).map((s) => `${s.section} ${s.row}${s.number}`).join(', ');
      summary = `🎫 **${event.title}**\n💺 **${seatList}**\n👥 ${session.qty} ticket${session.qty > 1 ? 's' : ''}\n💰 Subtotal: ${formatMoney(subtotal)}`;
    } else {
      summary = `🎫 **${event.title}**\n🎟 ${session.categoryName} × ${session.qty}\n💰 Subtotal: ${formatMoney(subtotal)}`;
    }
    if (discountAmount > 0) {
      summary += `\n🎟 Voucher discount (${discountName}): **-${formatMoney(discountAmount)}**`;
      summary += `\n💰 **Total: ${formatMoney(total)}**`;
    } else {
      summary += `\n💰 **${formatMoney(subtotal)}**`;
    }
    subtotal = total;
  } catch (e) {
    if (event.reservedSeating) return seatMapReply(session, event);
    return { reply: `That combination isn't allowed (${e.message}). Pick a different ticket type?`, bubble: categoryChoicesReply(session, event).bubble };
  }
  session.subtotal = subtotal;
  session.summaryText = summary;
  session.stage = 'confirm';
  // Offered whenever there is anything to spend. Rewards are opt-in now, so even a
  // single voucher needs the picker to be applied at all.
  // Skipped when re-quoting after a picker change: the picker the customer is
  // already using stays in place and updates itself, so appending another one on
  // every tick just made the list appear to reset.
  const selectable = offers.filter((o) => Number(o.discount) > 0);
  const picker = includePicker && selectable.length >= 1
    ? [{
        type: 'discounts',
        header: selectable.length > 1 ? 'Apply rewards' : 'Apply reward',
        offers: selectable.map((o) => ({
          id: String(o.id),
          title: o.title || o.code,
          code: o.code,
          type: o.type,
          discount: o.discount,
          isGiftCard: o.isGiftCard,
          event: o.event ? { title: o.event.title } : null,
        })),
        // Nothing is pre-ticked: the customer opts in. Auto-selecting here was
        // the reason a voucher appeared to be stuck on, since clearing it needed
        // a second tap before the choice looked honoured.
        selected: Array.isArray(session.selectedEntitlementIds)
          ? session.selectedEntitlementIds.map(String)
          : [],
        total: subtotal,
      }]
    : [];
  const confirm = {
    type: 'choices',
    context: 'confirm',
    header: 'Looks good?',
    options: [
      { id: 'yes', label: '✔ Yes, book it' },
      { id: 'no', label: '✖ Change something' },
    ],
  };
  return {
    reply: `Here's your order summary:\n\n${summary}\n\nShall I book this for you?`,
    bubble: picker.length ? { type: 'group', children: [...picker, confirm] } : confirm,
  };
};

const bookingCreatedReply = (session, result) => {
  const booking = result.booking;
  const detail = session.event.reservedSeating
    ? (session.seatDocs || []).map((s) => `${s.section} ${s.row}${s.number}`).join(', ')
    : `${session.qty} × ${session.categoryName}`;
  let totalLine = `Total: **${formatMoney(booking.total)}**`;
  if (booking.discount > 0) {
    totalLine = `Subtotal: ${formatMoney(booking.subtotal)}\n🎟 Voucher discount (${booking.discountName || 'voucher'}): **-${formatMoney(booking.discount)}**\nTotal: **${formatMoney(booking.total)}**`;
  }
  return {
    reply: `All sorted! 🎉 Booking **${booking.reference}** is reserved for you.\n\n${totalLine}\n\nSeats are held for ${(inventoryService.SEAT_HOLD_MINUTES) || 10} minutes while we sort out payment.`,
    bubble: {
      type: 'payment',
      bookingId: String(booking._id),
      reference: booking.reference,
      eventTitle: session.event.title,
      detail,
      total: booking.total,
    },
  };
};

// A reward can be spent on another booking while the chat sits on the summary.
// Returns true when that happened, having dropped the dead ids so the summary can
// be re-quoted. Re-quoting beats both failure (dead end) and booking anyway
// (silently charging a different price than the one that was agreed).
const pruneStaleSelection = async (session, user) => {
  const selected = Array.isArray(session.selectedEntitlementIds) ? session.selectedEntitlementIds : [];
  if (!selected.length) return false;

  let subtotal;
  try {
    subtotal = lineTotals(session.event, buildFlowItems(session)).reduce((s, c) => s + c.lineTotal, 0);
  } catch (_) {
    return false;
  }

  const fresh = await listAvailableEntitlements({
    userId: String(user._id),
    eventId: String(session.eventId),
    subtotal,
  });
  const valid = new Set(fresh.map((o) => String(o.id)));
  const next = selected.map(String).filter((id) => valid.has(id));
  if (next.length === selected.length) return false;

  session.selectedEntitlementIds = next;
  return true;
};

const confirmBooking = async (session, user, yes, action) => {
  if (yes) {
    if (!user) {
      return {
        reply: "You'll need to log in before I can reserve seats for you. Tap below to sign in, and we'll pick up right here. 🔑",
        bubble: { type: 'choices', context: 'login', header: 'One quick step', options: [{ id: 'login', label: 'Log in / Sign up' }] },
      };
    }
    const items = buildFlowItems(session);
    try {
      // Apply exactly the entitlement quoted in the summary. Leaving `entitlements`
      // unset makes the booking re-derive the best voucher at this moment, so the
      // price the user agreed to could differ from the price charged: a discount
      // was silently applied when the summary ran while logged out and the user
      // then logged in via the prompt below, or a voucher quoted earlier had since
      // been spent and a different one was substituted. Passing the quoted id (or
      // an explicit empty list when nothing was quoted) keeps chat and booking in
      // agreement, and makes a stale voucher fail loudly instead of quietly.
      if (await pruneStaleSelection(session, user)) {
        const requoted = await confirmSummaryReply(session);
        return {
          ...requoted,
          reply: "Heads up — one of those rewards is no longer available, so I've updated the total. "
            + requoted.reply.replace(/^Here's your order summary:\n\n/, ''),
        };
      }

      const selected = Array.isArray(session.selectedEntitlementIds)
        ? session.selectedEntitlementIds
        : (session.voucherDiscount?.entitlementId ? [session.voucherDiscount.entitlementId] : []);
      const result = await createBookingForUser({
        user,
        eventId: session.eventId,
        items,
        entitlements: selected,
      });
      session.bookingId = String(result.booking._id);
      session.stage = 'paid';
      return bookingCreatedReply(session, result);
    } catch (e) {
      if (session.event.reservedSeating && /seat|hold|taken|inventory|availability/i.test(e.message)) {
        const fresh = await loadEventById(session.eventId);
        session.event = fresh;
        return seatMapReply(session, fresh);
      }
      return { reply: `I couldn't complete that booking: ${e.message}.`, bubble: null };
    }
  }
  const adjustOptions = [
    ...(session.event.reservedSeating ? [{ id: 'seats', label: '💺 Pick different seats' }] : []),
    { id: 'count', label: '👥 Change the number of people' },
    { id: 'event', label: '🎪 Choose a different show' },
    { id: 'cancel', label: '✖ Cancel the booking' },
  ];
  return {
    reply: 'No worries at all — what would you like to adjust?',
    bubble: { type: 'choices', context: 'adjust', header: 'Let me fix that', options: adjustOptions },
  };
};

const handleChoose = async (session, action, user) => {
  const id = String(action.id || '');
  const needsEvent = ['session', 'category', 'seats', 'confirm', 'adjust'].includes(action.context);
  if (needsEvent && !session.eventId) {
    resetBooking(session);
    return { reply: "I think we got out of sync — let's start over. Which show would you like to book?", bubble: null };
  }
  try {
    switch (action.context) {
      case 'event':
        return selectEvent(session, id);
      case 'browse':
        return browseCategory(session, id);
      case 'session':
        return selectSession(session, id);
      case 'category':
        return selectCategory(session, id);
      case 'confirm':
        return confirmBooking(session, user, id === 'yes', action);
      case 'adjust': {
        if (id === 'seats' && session.event.reservedSeating) {
          session.stage = 'seats';
          return seatMapReply(session, session.event);
        }
        if (id === 'count') {
          session.stage = 'count';
          return askCountReply(session.event);
        }
        if (id === 'event') {
          session.stage = 'event';
          return { reply: 'Of course — which show shall I look up?', bubble: null };
        }
        if (id === 'cancel') {
          resetBooking(session);
          return { reply: 'No problem — I\'ve cancelled that. Anything else I can help with? 😊', bubble: null };
        }
        return confirmBooking(session, user, false, action);
      }
      case 'login':
        return { reply: 'Head to the login page and come right back — your seats are still waiting. 🔑', bubble: null };
      default:
        return null;
    }
  } catch (e) {
    console.error('[chatbot] handleChoose error:', e.message);
    return { reply: "Something glitched on my end — could you try that again?", bubble: null };
  }
};

const selectSession = async (session, sid) => {
  if (!session.event) {
    const ev = await loadEventById(session.eventId);
    if (!ev) return { reply: 'Which show would you like to book? Let\'s pick it first.', bubble: null };
    session.event = ev;
  }
  session.sessionId = sid;
  session.stage = 'count';
  session.seatDocs = [];
  return askCountReply(session.event);
};

const parseSeatLabels = (raw, seats) => {
  const re = /\b([A-Za-z])\s*(\d{1,2})\b/g;
  const want = [];
  let m;
  while ((m = re.exec(String(raw || '')))) want.push({ row: m[1].toUpperCase(), number: parseInt(m[2], 10) });
  if (!want.length) return null;
  const found = [];
  for (const w of want) {
    const s = (seats || []).find((x) => x.status === 'available' && String(x.row).toUpperCase() === w.row && Number(x.number) === w.number);
    if (!s) return null;
    found.push(String(s._id));
  }
  return found;
};

const handleSeatsSubmit = async (session, action) => {
  const seatIds = (action.seatIds || []).map(String);
  const event = await loadEventById(session.eventId);
  if (!event) return { reply: "I lost that event — let's start over. Which show?", bubble: null };
  session.event = event;

  if (session.qty && seatIds.length !== session.qty) {
    return { reply: `That's ${seatIds.length} — I just need exactly ${session.qty}. Tap a seat to add it or remove one.`, bubble: null };
  }
  const seats = await Seat.find({ _id: { $in: seatIds } }).lean();
  if (seats.length !== seatIds.length) {
    return seatMapReply(session, event);
  }
  const taken = seats.filter((s) => s.status !== 'available');
  if (taken.length) {
    return {
      reply: `Oops — ${taken.map((s) => `${s.section} ${s.row}${s.number}`).join(', ')} just got snapped up. Here's the live map again:`,
      bubble: { type: 'seats', eventId: session.eventId, sessionId: session.sessionId || null, qty: session.qty, seats: await loadSeatsFor(session.eventId, session.sessionId) },
    };
  }
  session.seatDocs = seats;
  return confirmSummaryReply(session);
};

const handleTextInEventStage = async (session, tokens, clean) => {
  const num = pickIndex(tokens, clean);
  if (num != null && session.candidates && session.candidates[num - 1]) {
    return selectEvent(session, session.candidates[num - 1].event.id);
  }
  const category = CATEGORIES.find((c) => containsAny(tokens, CATEGORY_SYNONYMS[c]));
  if (category) return browseCategory(session, category);
  const results = await searchEventsForBooking(tokens);
  if (results.length === 1) return selectEvent(session, results[0].event.id);
  if (results.length > 1) {
    session.candidates = results;
    return eventChoicesReply(results);
  }
  return browseCategoriesReply("I couldn't find that show — let's try browsing by category instead. Pick one and I'll pull up the dates! 👇");
};

const tryStageText = async (session, tokens, clean, user) => {
  switch (session.stage) {
    case 'event':
      return handleTextInEventStage(session, tokens, clean);
    case 'session': {
      if (clean === 'today') {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const match = (session.event.sessions || []).find((s) => { const d = new Date(s.date); d.setHours(0, 0, 0, 0); return d - today < 24 * 3600e3; });
        if (match) return selectSession(session, String(match._id));
      }
      const n = pickIndex(tokens, clean);
      const list = session.event.sessions || [];
      if (n === -1 && list.length) return selectSession(session, String(list[list.length - 1]._id));
      if (n != null && list[n - 1]) return selectSession(session, String(list[n - 1]._id));
      return { reply: 'Just tell me the date — pick one above, or reply with its number.', bubble: sessionChoicesReply(session.event).bubble };
    }
    case 'count': {
      const c = parseCount(clean);
      if (c == null) return { reply: 'How many tickets shall I set aside? A number works great — like "2" or "just me". 😊', bubble: null };
      return handleCount(session, c);
    }
    case 'category': {
      const c = parseCount(clean);
      if (c != null && c !== session.qty) {
        session.qty = c;
        return categoryChoicesReply(session, session.event);
      }
      const n = pickIndex(tokens, clean);
      if (n != null && session.event.ticketCategories[n - 1]) return selectCategory(session, String(session.event.ticketCategories[n - 1]._id));
      return { reply: 'Pick one of the ticket types above — tap it, or reply with its number.', bubble: categoryChoicesReply(session, session.event).bubble };
    }
    case 'seats': {
      const picked = parseSeatLabels(clean, session.currentSeats || []);
      if (picked && picked.length === session.qty) return handleSeatsSubmit(session, { seatIds: picked });
      return {
        reply: `You can tap seats right on the map below (I need exactly ${session.qty}), or type them like "${session.qty > 1 ? 'A5, E7' : 'A5'}".`,
        bubble: null,
      };
    }
    case 'confirm': {
      if (/(^| )(yes|sure|yep|yeah|go ahead|book it|confirm|do it|ok|okay|proceed|sounds good|sounds great)($| )/.test(clean)) return confirmBooking(session, user, true);
      if (/(no|nah|nope|not yet|change|wait|hold on|what does it cost|too .*)/.test(clean)) return confirmBooking(session, user, false);
      return { reply: 'Just let me know — say "yes" to book these, or tell me what to change.', bubble: null };
    }
    default:
      return null;
  }
};

const CATEGORY_CHIP_OPTIONS = CATEGORIES.map((c) => ({ id: c, label: CATEGORY_LABELS[c] || c, sub: '' }));

const browseCategoriesReply = (note) => ({
  reply: note || 'Sure — what kind of event are you interested in?',
  bubble: { type: 'choices', context: 'browse', header: 'Browse by category', options: CATEGORY_CHIP_OPTIONS },
});

const startBooking = async (session, tokens, clean) => {
  const results = await searchEventsForBooking(tokens);
  if (!results.length) {
    session.stage = 'idle';
    return browseCategoriesReply("I couldn't find a specific show — but let's browse by category! Pick one below. 👇");
  }
  session.candidates = results;
  if (results.length === 1) {
    const next = await selectEvent(session, results[0].event.id);
    const n = parseCount(clean);
    if (n != null && session.stage === 'count') return handleCount(session, n);
    return next;
  }
  return eventChoicesReply(results);
};

const resumeNote = (session) => {
  if (session.stage !== 'idle' && session.event) {
    const s = session.event.reservedSeating && session.stage === 'seats' ? ' (you were picking seats)' : '';
    return `\n\nBy the way, we were mid-way through booking **${session.event.title}**${s} — just keep typing and we'll continue!`;
  }
  return '';
};

const answer = async (message, opts = {}) => {
  const { sessionId, user, action } = opts || {};
  const clean = String(message || '').trim();
  const session = getBookingSession(sessionId);
  if (user) session.user = user;

  // Structured UI actions (buttons / seat map) take priority.
  if (action && typeof action === 'object') {
    if (action.type === 'choose') {
      const r = await handleChoose(session, action, user);
      if (r) return r;
    } else if (action.type === 'discounts') {
      if (session.stage === 'confirm') {
        session.selectedEntitlementIds = (action.selected || []).map(String).filter(Boolean);
        return confirmSummaryReply(session, { includePicker: false });
      }
    } else if (action.type === 'seats') {
      return handleSeatsSubmit(session, action);
    }
  }

  if (!clean) {
    return { reply: 'Please type a question — for example "what concerts are on in Singapore?".' };
  }

  const queryTokens = tokenize(clean);

  // Greetings (also offer to resume a booking in progress)
  if (containsAny(queryTokens, ['hello', 'hi', 'hey', 'yo', 'morning', 'afternoon'])) {
    return { reply: 'Hi! I am Ease, the EventEase assistant. Ask me what concerts are coming up, how booking works, or about refunds.' + resumeNote(session), bubble: null };
  }

  // Thanks
  if (containsAny(queryTokens, ['thank', 'thanks', 'ty', 'appreciate'])) {
    return { reply: "You're welcome! Let me know if you need anything else." + resumeNote(session), bubble: null };
  }

  // Call it off mid-booking
  if (session.stage !== 'idle' && /cancel|never mind|nevermind|forget it|stop|abort|scratch that|that's all/.test(clean)) {
    resetBooking(session);
    return { reply: "Of course — I've cancelled that booking. Is there anything else I can help with? 😊", bubble: null };
  }

  // Mid-booking: interpret the reply against the current step (this runs even
  // for bare numbers like "2" that have no text tokens).
  if (session.stage !== 'idle') {
    const handled = await tryStageText(session, queryTokens, clean, user);
    if (handled) return handled;
  }

  if (!queryTokens.length) {
    return { reply: 'I did not catch that. Try asking about events, booking, payments, refunds or transfers.' };
  }

  // Kicking off a booking ("book tickets for X", "I want to go to...")
  if (looksLikeBookingIntent(queryTokens, clean)) {
    return startBooking(session, queryTokens, clean);
  }

  // Try to answer from live event data first when the query looks like an event search.
  const eventResult = await tryEventQuery(queryTokens);
  if (eventResult) {
    return { ...eventResult, reply: session.stage === 'idle' ? eventResult.reply : eventResult.reply + resumeNote(session), bubble: eventResult.bubble || null };
  }

  // Otherwise run against the full static + event index.
  const idx = await buildIndex();
  const scored = idx.docs.map((d, i) => ({ d, s: score(queryTokens, d, idx.vectors[i]) }))
    .sort((a, b) => b.s - a.s);

  const top = scored[0];
  if (top && top.s > 0.18) {
    if (top.d.kind === 'event') {
      const r = buildEventReply([top.d.event]);
      return { ...r, reply: session.stage === 'idle' ? r.reply : r.reply + resumeNote(session), bubble: r.bubble || null };
    }
    return { reply: session.stage === 'idle' ? top.d.answer : top.d.answer + resumeNote(session), link: top.d.link || null, bubble: null };
  }

  return {
    reply: "I couldn't find a confident answer for that. Try asking about events (e.g. \"concerts in Singapore\"), booking, payment, refunds, resale, transfers or accessibility." + resumeNote(session),
    link: null,
    bubble: null,
  };
};

const invalidateCache = () => { cachedIndex = null; cachedAt = 0; };

module.exports = { answer, invalidateCache, buildIndex };