// Stripe is mocked at the module boundary so the session-lifecycle rules can be
// asserted without a real account: one active session per checkout attempt,
// session TTL, and the mapping of "session not active" failures to actionable
// 400s instead of 500s (the buyer-visible hang the report describes).
jest.mock('../src/config/stripe', () => ({
  checkout: {
    sessions: {
      create: jest.fn(),
      expire: jest.fn(),
      retrieve: jest.fn(),
    },
  },
}));

const {
  api,
  createUser,
  tokenFor,
  seedLiveEvent,
  randomEmail,
  models: { Booking },
} = require('./helpers');
const Payment = require('../src/models/Payment');
const stripe = require('../src/config/stripe');

describe('Stripe checkout session lifecycle', () => {
  let org;
  let customer;
  let customerToken;
  let event;

  const createPendingBooking = async () => {
    const created = await api.post('/api/bookings', customerToken).send({
      eventId: event._id.toString(),
      items: [
        {
          categoryId: String(event.ticketCategories[0]._id),
          sessionId: String(event.sessions[0]._id),
          qty: 1,
        },
      ],
    });
    return created.body.data.booking;
  };

  const payWithStripe = (bookingId) =>
    api.post('/api/payments/pay', customerToken).send({ bookingId, provider: 'stripe' });

  const confirmSession = (sessionId) =>
    api.post('/api/payments/confirm-session', customerToken).send({ sessionId });

  beforeAll(async () => {
    org = await createUser({
      name: 'Stripe Org',
      email: randomEmail('sorg'),
      role: 'organizer',
      isApproved: true,
    });
    customer = await createUser({ name: 'Stripe Customer', email: randomEmail('scust') });
    customerToken = tokenFor(customer);
    event = await seedLiveEvent({ owner: org._id, title: 'Stripe Test Gig', price: 40, qty: 30 });
  });

  beforeEach(() => {
    stripe.checkout.sessions.create.mockReset();
    stripe.checkout.sessions.expire.mockReset();
    stripe.checkout.sessions.retrieve.mockReset();
    stripe.checkout.sessions.create.mockResolvedValue({
      id: 'cs_test_1',
      url: 'https://checkout.stripe.com/c/pay/cs_test_1',
    });
    stripe.checkout.sessions.expire.mockResolvedValue({ id: 'cs_old', status: 'expired' });
  });

  test('a still-open previous session is reused instead of creating a duplicate', async () => {
    const booking = await createPendingBooking();
    stripe.checkout.sessions.create.mockResolvedValueOnce({
      id: 'cs_open',
      url: 'https://checkout.stripe.com/c/pay/cs_open',
    });

    const first = await payWithStripe(booking._id);
    expect(first.status).toBe(200);
    expect(first.body.data.sessionId).toBe('cs_open');

    // TTL is clamped to Stripe's [30min, 24h] window — no 24h zombie sessions.
    const createArgs = stripe.checkout.sessions.create.mock.calls[0][0];
    const nowSec = Math.floor(Date.now() / 1000);
    expect(createArgs.expires_at).toBeGreaterThanOrEqual(nowSec + 30 * 60 - 5);
    expect(createArgs.expires_at).toBeLessThanOrEqual(nowSec + 24 * 60 * 60 + 5);

    stripe.checkout.sessions.retrieve.mockResolvedValue({
      id: 'cs_open',
      status: 'open',
      url: 'https://checkout.stripe.com/c/pay/cs_open',
      expires_at: nowSec + 1800,
    });

    const second = await payWithStripe(booking._id);
    expect(second.status).toBe(200);
    expect(second.body.data.redirectUrl).toContain('cs_open');
    expect(stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
    expect(stripe.checkout.sessions.expire).not.toHaveBeenCalled();
  });

  test('a nearly-expired session is retired and replaced, leaving one pending payment', async () => {
    const booking = await createPendingBooking();
    stripe.checkout.sessions.create
      .mockResolvedValueOnce({ id: 'cs_old', url: 'https://checkout.stripe.com/c/pay/cs_old' })
      .mockResolvedValueOnce({ id: 'cs_new', url: 'https://checkout.stripe.com/c/pay/cs_new' });

    const first = await payWithStripe(booking._id);
    expect(first.body.data.sessionId).toBe('cs_old');

    // Open, but inside the 2-minute reuse cutoff — refresh it instead.
    stripe.checkout.sessions.retrieve.mockResolvedValue({
      id: 'cs_old',
      status: 'open',
      url: 'https://checkout.stripe.com/c/pay/cs_old',
      expires_at: Math.floor(Date.now() / 1000) + 60,
    });

    const second = await payWithStripe(booking._id);
    expect(second.status).toBe(200);
    expect(second.body.data.sessionId).toBe('cs_new');
    expect(stripe.checkout.sessions.expire).toHaveBeenCalledWith('cs_old');

    const oldRow = await Payment.findOne({ booking: booking._id, intentId: 'cs_old' });
    const newRow = await Payment.findOne({ booking: booking._id, intentId: 'cs_new' });
    expect(oldRow.status).toBe('failed');
    expect(newRow.status).toBe('pending');

    const fresh = await Booking.findById(booking._id);
    expect(fresh.payment.intentId).toBe('cs_new');
    expect(fresh.status).toBe('pending');
  });

  test('an already-complete previous session is left alone (expire failure is swallowed)', async () => {
    const booking = await createPendingBooking();
    stripe.checkout.sessions.create
      .mockResolvedValueOnce({ id: 'cs_done', url: 'https://checkout.stripe.com/c/pay/cs_done' })
      .mockResolvedValueOnce({ id: 'cs_retry', url: 'https://checkout.stripe.com/c/pay/cs_retry' });

    const first = await payWithStripe(booking._id);
    expect(first.body.data.sessionId).toBe('cs_done');

    // Paid in another tab; the webhook may still be in flight.
    stripe.checkout.sessions.retrieve.mockResolvedValue({
      id: 'cs_done',
      status: 'complete',
      url: 'https://checkout.stripe.com/c/pay/cs_done',
    });
    stripe.checkout.sessions.expire.mockRejectedValueOnce(
      Object.assign(new Error('This session is already complete'), { code: 'resource_missing' })
    );

    const res = await payWithStripe(booking._id);
    expect(res.status).toBe(200);
    expect(stripe.checkout.sessions.expire).toHaveBeenCalledWith('cs_done');

    // The paid row must stay pending — the webhook is still allowed to confirm it.
    const doneRow = await Payment.findOne({ booking: booking._id, intentId: 'cs_done' });
    expect(doneRow.status).toBe('pending');
  });

  test('confirm-session maps a missing/inactive session to a 400, not a 500', async () => {
    stripe.checkout.sessions.retrieve.mockRejectedValue(
      Object.assign(new Error('No such checkout.session: cs_dead'), { code: 'resource_missing' })
    );

    const res = await confirmSession('cs_dead');
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no longer active/i);
  });

  test('confirm-session on an expired session returns 400 and fails the pending payment', async () => {
    const booking = await createPendingBooking();
    stripe.checkout.sessions.create.mockResolvedValue({
      id: 'cs_expire_me',
      url: 'https://checkout.stripe.com/c/pay/cs_expire_me',
    });
    const paid = await payWithStripe(booking._id);
    expect(paid.status).toBe(200);

    stripe.checkout.sessions.retrieve.mockResolvedValue({
      id: 'cs_expire_me',
      status: 'expired',
      payment_status: 'unpaid',
      client_reference_id: String(booking._id),
      metadata: { bookingId: String(booking._id) },
    });

    const res = await confirmSession('cs_expire_me');
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/expired/i);

    const row = await Payment.findOne({ booking: booking._id, intentId: 'cs_expire_me' });
    expect(row.status).toBe('failed');
  });
});
