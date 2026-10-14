const {
  api,
  createUser,
  tokenFor,
  seedLiveEvent,
  randomEmail,
  models: { Booking },
} = require('./helpers');

describe('Payments API', () => {
  let org;
  let customer;
  let customerToken;
  let otherCustomer;
  let otherToken;
  let event;

  const createPendingBooking = async (user, token, qty = 1) => {
    const created = await api.post('/api/bookings', token).send({
      eventId: event._id.toString(),
      items: [
        {
          categoryId: String(event.ticketCategories[0]._id),
          sessionId: String(event.sessions[0]._id),
          qty,
        },
      ],
    });
    return created.body.data.booking;
  };

  beforeAll(async () => {
    org = await createUser({
      name: 'Pay Org',
      email: randomEmail('porg'),
      role: 'organizer',
      isApproved: true,
    });
    customer = await createUser({ name: 'Pay Customer', email: randomEmail('pcust') });
    customerToken = tokenFor(customer);
    otherCustomer = await createUser({ name: 'Other Customer', email: randomEmail('ocust') });
    otherToken = tokenFor(otherCustomer);
    event = await seedLiveEvent({ owner: org._id, title: 'Pay Test Gig', price: 40, qty: 30 });
  });

  test('a simulated payment confirms a pending booking', async () => {
    const booking = await createPendingBooking(customer, customerToken, 1);
    const res = await api
      .post('/api/payments/pay', customerToken)
      .send({ bookingId: booking._id, provider: 'simulated' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('succeeded');

    const fresh = await Booking.findById(booking._id);
    expect(fresh.status).toBe('confirmed');
    expect(fresh.payment.provider).toBe('simulated');
  });

  test('paying an already confirmed booking returns 409', async () => {
    const booking = await createPendingBooking(customer, customerToken, 1);
    await api.post('/api/payments/pay', customerToken).send({ bookingId: booking._id });

    const res = await api
      .post('/api/payments/pay', customerToken)
      .send({ bookingId: booking._id });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/not awaiting payment/i);
  });

  test("a user cannot pay someone else's booking", async () => {
    const booking = await createPendingBooking(customer, customerToken, 1);
    const res = await api
      .post('/api/payments/pay', otherToken)
      .send({ bookingId: booking._id });
    expect(res.status).toBe(404);
  });

  test('requesting a Stripe payment when Stripe is not configured returns 400', async () => {
    const booking = await createPendingBooking(customer, customerToken, 1);
    const res = await api
      .post('/api/payments/pay', customerToken)
      .send({ bookingId: booking._id, provider: 'stripe' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/stripe is not configured/i);
  });
});