const Stripe = require('stripe');

// Every Stripe call sits inside a user-facing request, so the SDK defaults are
// too patient: 80s per attempt and one automatic retry means a stalled request
// can pin a browser spinner (and a Node socket) for over two minutes before
// anything is surfaced. Keep the retry — it covers transient network blips —
// but cap the whole thing so the browser gets a 500 it can render instead of a
// spinner that never resolves.
const STRIPE_TIMEOUT_MS = Number(process.env.STRIPE_TIMEOUT_MS) || 10000;
const STRIPE_MAX_RETRIES = Number(process.env.STRIPE_MAX_RETRIES) || 2;

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, {
      timeout: STRIPE_TIMEOUT_MS,
      maxNetworkRetries: STRIPE_MAX_RETRIES,
    })
  : null;

if (stripe) {
  console.log(
    `[stripe] client ready (timeout ${STRIPE_TIMEOUT_MS}ms, maxNetworkRetries ${STRIPE_MAX_RETRIES}, webhook ${process.env.STRIPE_WEBHOOK_SECRET ? 'configured' : 'NOT configured'})`
  );
} else {
  console.warn('[stripe] STRIPE_SECRET_KEY not set — card payments are disabled');
}

module.exports = stripe;