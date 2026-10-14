const stripe = require('../config/stripe');
const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const Event = require('../models/Event');
const ApiError = require('../utils/ApiError');
const { asyncHandler, ok } = require('../utils/asyncHandler');
const { finalizePayment } = require('./booking.controller');
const { audit } = require('../utils/audit');

// Stripe floors session TTL at 30 minutes and caps it at 24 hours. Tying the
// session to the seat hold when the hold allows it means a checkout URL can
// never outlive the booking it pays for; otherwise use the shortest TTL Stripe
// accepts instead of the 24h default that produced stale-session hangs.
const stripeSessionExpiry = (booking) => {
  const nowSec = Math.floor(Date.now() / 1000);
  const holdSec = booking.holdExpiresAt ? Math.floor(booking.holdExpiresAt.getTime() / 1000) : 0;
  return Math.min(nowSec + 24 * 60 * 60, Math.max(nowSec + 30 * 60, holdSec));
};

// Create a payment session (Stripe Checkout) or simulate instantly.
const pay = asyncHandler(async (req, res) => {
  const { bookingId, provider = 'simulated', paymentMethodId } = req.body;

  const booking = await Booking.findOne({ _id: bookingId, user: req.user._id }).populate('event');
  if (!booking) throw ApiError.notFound('Booking not found');
  if (booking.status !== 'pending') throw ApiError.conflict('Booking not awaiting payment');
  if (booking.holdExpiresAt && booking.holdExpiresAt < new Date())
    throw ApiError.badRequest('Seat hold expired. Please create a new booking.');
  if (!stripe && provider === 'stripe') throw ApiError.badRequest('Stripe is not configured');

  if (provider === 'stripe') {
    // A booking can reach /pay more than once (cancel-and-retry, second tab).
    // Reuse the existing session when Stripe still reports it open — one read
    // instead of expire+create — and only retire it once it can no longer be
    // paid. This keeps a single active session and stops duplicate checkouts.
    const previousId = booking.payment?.provider === 'stripe' ? booking.payment?.intentId : null;
    if (/^cs_/.test(previousId || '')) {
      let existing = null;
      try {
        existing = await stripe.checkout.sessions.retrieve(previousId);
      } catch {
        existing = null;
      }
      const nowSec = Math.floor(Date.now() / 1000);
      if (existing?.status === 'open' && existing.url && (existing.expires_at || 0) > nowSec + 120) {
        return ok(res, { provider: 'stripe', redirectUrl: existing.url, sessionId: existing.id });
      }

      // Not reusable (completed, expired, or about to lapse): retire it so no
      // stale URL can later hang. Retiring only succeeds while it is still
      // `open` (i.e. unpaid), so its pending payment row can be closed too.
      try {
        await stripe.checkout.sessions.expire(previousId);
        await Payment.updateOne({ booking: booking._id, status: 'pending' }, { $set: { status: 'failed', method: 'card' } });
      } catch {
        // Already complete or expired — nothing to retire.
      }
    }

    let session;
    try {
      session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: buildStripeLineItems(booking, req.body),
        customer_email: req.user.email,
        client_reference_id: String(booking._id),
        metadata: { bookingId: String(booking._id) },
        expires_at: stripeSessionExpiry(booking),
        // `booking` is not decoration: the success page uses it to resolve the
        // booking without trusting `GET /api/bookings` ordering.
        success_url: `${process.env.CLIENT_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}&booking=${encodeURIComponent(booking.reference)}`,
        cancel_url: `${process.env.CLIENT_URL}/payment/cancel?booking=${booking.reference}`,
      });
    } catch (err) {
      // Without a session there is nothing to pay against, so no Payment row is
      // written — otherwise every failed redirect leaves an orphan "pending".
      throw ApiError.badRequest(`Could not start Stripe checkout: ${err.message}`);
    }

    await Payment.create({
      booking: booking._id,
      user: req.user._id,
      amount: booking.total,
      provider,
      status: 'pending',
      intentId: session.id,
    });

    booking.payment = { provider: 'stripe', intentId: session.id, status: 'pending' };
    await booking.save();
    return ok(res, { provider: 'stripe', redirectUrl: session.url, sessionId: session.id });
  }

  // Simulated / PayNow / Cash: succeed immediately for demo purposes.
  await Payment.create({
    booking: booking._id,
    user: req.user._id,
    amount: booking.total,
    provider,
    status: 'pending',
  });

  const paymentProvider = provider === 'paynow' ? 'paynow' : provider === 'cash' ? 'cash' : 'simulated';
  await finalizePayment({
    bookingId: booking._id,
    provider: paymentProvider,
    method: paymentProvider === 'paynow' ? 'paynow_qr' : paymentProvider,
    intentId: null,
    amount: booking.total,
  });

  await Payment.updateOne(
    { booking: booking._id, status: 'pending' },
    { $set: { status: 'succeeded', paidAt: new Date(), method: paymentMethodId || 'simulated' } }
  );

  await audit(req, { action: 'payment.success', targetType: 'Booking', targetId: booking._id, note: provider });
  ok(res, { provider: paymentProvider, status: 'succeeded', booking });
});

const buildStripeLineItems = (booking) => {
  const eventName = booking.event?.title || 'EventEase booking';
  return [
    {
      price_data: {
        currency: 'sgd',
        product_data: { name: `${eventName} · ${booking.reference}` },
        unit_amount: Math.round(booking.total * 100),
      },
      quantity: 1,
    },
  ];
};

// One fast read only. Stripe webhooks are the primary confirmation path; the
// browser return path must never sleep/poll Stripe in a request. If Stripe has
// not updated yet, return `pending` and let the verified webhook finalise it.
const retrievePaidSession = (sessionId) => stripe.checkout.sessions.retrieve(sessionId);

// Confirm a Stripe checkout session (called from success page).
const confirmSession = asyncHandler(async (req, res) => {
  const { sessionId, bookingRef } = req.body;
  if (!stripe || !sessionId) throw ApiError.badRequest('Missing session id');

  // Fast path that never touches Stripe: the webhook (or an earlier call)
  // already confirmed this booking. This is what makes a refresh of the success
  // page — or a buyer who closed the tab — resolve instantly. The row is kept
  // so the Stripe path below can reuse it instead of reading it again.
  let known = null;
  if (bookingRef) {
    known = await Booking.findOne({ reference: bookingRef, user: req.user._id });
    if (known && known.status === 'confirmed') {
      await markPaymentSucceeded(known._id, known.payment?.intentId || sessionId);
      return ok(res, { status: 'confirmed', booking: known });
    }
  }

  let session;
  try {
    session = await retrievePaidSession(sessionId);
  } catch (err) {
    // The `checkout_not_active_session` class of failure: the session was
    // completed, cancelled or aged out, so Stripe refuses to report on it.
    // Surface it as an actionable 400 — the client renders a recovery screen —
    // instead of a 500 the buyer cannot act on.
    if (err?.code === 'resource_missing' || /not active|no such checkout/i.test(err?.message || '')) {
      throw ApiError.badRequest('This Stripe checkout session is no longer active.');
    }
    throw err;
  }
  const bookingId = session.client_reference_id || session.metadata?.bookingId;
  if (!bookingId) throw ApiError.badRequest('Stripe session is not linked to a booking');

  // Reuse the fast-path row when it is the same booking — one read, not two.
  const booking = known && String(known._id) === String(bookingId)
    ? known
    : await Booking.findById(bookingId);
  if (!booking) throw ApiError.notFound('Booking not found');
  if (booking.user.toString() !== req.user._id.toString() && req.user.role !== 'admin')
    throw ApiError.forbidden();

  if (session.status === 'expired') {
    await markPaymentFailed(bookingId, sessionId);
    throw ApiError.badRequest('This Stripe checkout session has expired.');
  }

  // Stripe can call the webhook and the browser success page at nearly the
  // same time. If the webhook already confirmed the booking, just return it.
  if (booking.status === 'confirmed') {
    await markPaymentSucceeded(bookingId, session.payment_intent || session.id);
    return ok(res, { status: 'confirmed', booking });
  }

  // Not paid yet — a 200 with an explicit pending status. The browser makes no
  // further calls; the verified webhook finalises the booking when Stripe
  // reports the charge, and /account picks up the result on its next load.
  if (session.payment_status !== 'paid') {
    return ok(res, { status: 'pending', paymentStatus: session.payment_status || 'unpaid' });
  }

  // Payment confirmed by Stripe but not finalised yet. Never make the browser
  // wait for fulfilment here: finalising issues tickets, updates inventory and
  // sends the QR email, which can push past the browser's confirm timeout and
  // surface as an error on the success page. The verified webhook (or this
  // background job) finalises the booking; the page ack is instant and /account
  // picks up the result on its next load. finalizePayment's atomic claim makes
  // the concurrent finalises safe.
  fulfilPaidBooking(booking, session).catch((err) => {
    console.error('[stripe] confirm-session fulfilment failed:', err.message);
  });
  ok(res, { status: 'pending', paymentStatus: session.payment_status || 'unpaid' });
});

// Shared with the webhook: finalise a booking whose charge has been confirmed,
// then mark its payment row succeeded. Idempotent and safe to run concurrently
// (the pending→confirmed transition is an atomic findOneAndUpdate).
const fulfilPaidBooking = async (booking, session) => {
  if (booking.status === 'pending') {
    await finalizePayment({
      bookingId: booking._id,
      provider: 'stripe',
      method: 'card',
      intentId: session.payment_intent || session.id,
      amount: booking.total,
    });
  }
  await markPaymentSucceeded(booking._id, session.payment_intent || session.id);
};

// Idempotent: only the row still in 'pending' is touched, so the webhook, the
// return-path confirm and a retry racing each other converge on one succeeded
// payment.
const markPayment = async (bookingId, status, intentId, extra = {}) => {
  const $set = { status, method: 'card', ...extra };
  if (intentId) $set.intentId = intentId;
  return Payment.updateOne({ booking: bookingId, status: 'pending' }, { $set });
};

const markPaymentSucceeded = (bookingId, intentId) =>
  markPayment(bookingId, 'succeeded', intentId, { paidAt: new Date() });

const markPaymentFailed = (bookingId, intentId) => markPayment(bookingId, 'failed', intentId);

const createPaymentIntent = asyncHandler(async (req, res) => {
  const { bookingId } = req.body;
  const booking = await Booking.findOne({ _id: bookingId, user: req.user._id });
  if (!booking) throw ApiError.notFound('Booking not found');
  if (!stripe) throw ApiError.badRequest('Stripe is not configured');

  const intent = await stripe.paymentIntents.create({
    amount: Math.round(booking.total * 100),
    currency: 'sgd',
    metadata: { bookingId: String(bookingId) },
  });
  await Payment.create({ booking: booking._id, user: req.user._id, amount: booking.total, provider: 'stripe', intentId: intent.id, status: 'pending' });
  ok(res, {
    paymentIntentId: intent.id,
    clientSecret: intent.client_secret,
    amount: booking.total,
    currency: 'sgd',
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
  });
});

// Stripe's authoritative confirmation path. Without STRIPE_WEBHOOK_SECRET this is
// a no-op and every confirmation depends on the buyer's browser coming back —
// which is exactly how a paid booking ends up stuck unpaid. Set it (locally:
// `stripe listen --forward-to localhost:4000/api/payments/webhook`).
const webhook = asyncHandler(async (req, res) => {
  const sig = req.headers['stripe-signature'];

  // A leftover or misconfigured Dashboard endpoint must never hang the buyer.
  // Stripe's hosted Checkout holds its page until THIS request returns 2xx,
  // while a 4xx counts as delivery failure and is retried — from the customer's
  // side that is just "spinner forever after paying". If we cannot verify a
  // legitimately signed event (no secret configured), acknowledge the 2xx and
  // ignore the payload: nothing is forged-trusted, and fulfilment falls back to
  // the success-page confirm-session path that has always covered this case.
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET || !sig) {
    return res.json({ received: true, note: 'webhook not configured — no action taken' });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    // A signature that fails while a secret IS configured is a real
    // misconfiguration and must not be silently swallowed — the operator has to
    // see the retries to fix it. (A 2xx here would mask a wrong whsec_ value.)
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Webhook ack must beat everything else. When a webhook endpoint is connected,
  // Stripe's hosted Checkout holds the customer on its page until THIS request
  // returns 2xx. Fulfilment (QR tickets, inventory, SMTP email) is heavy and can
  // take seconds, so run it after the ack instead of making Stripe redirect wait
  // for it. finalizePayment's atomic pending→confirmed claim makes concurrent
  // fulfilment safe, and the success-page confirm-session path is the fallback.
  res.json({ received: true });

  fulfilWebhookEvent(event).catch((err) => {
    console.error(`[stripe] webhook fulfilment failed (${event.type}):`, err.message);
  });
});

// Fulfilment for a verified webhook event. Kept out of the request path on
// purpose — Stripe redirects the buyer as soon as the webhook is acknowledged.
const fulfilWebhookEvent = async (event) => {
  const session = event.data?.object;

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const bookingId = session.client_reference_id || session.metadata?.bookingId;
    const booking = bookingId ? await Booking.findById(bookingId) : null;
    if (booking && session.payment_status === 'paid') {
      await fulfilPaidBooking(booking, session);
    } else if (bookingId && (session.payment_status === 'paid' || booking?.status === 'confirmed')) {
      await markPaymentSucceeded(bookingId, session.payment_intent);
    }
  } else if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') {
    const bookingId = session.client_reference_id || session.metadata?.bookingId;
    if (bookingId) await markPaymentFailed(bookingId, session.payment_intent);
  }
};

module.exports = { pay, confirmSession, createPaymentIntent, webhook };