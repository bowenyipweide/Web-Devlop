const {
  api,
  createUser,
  tokenFor,
  seedLiveEvent,
  randomEmail,
  models: { Seat },
} = require('./helpers');

describe('Bookings API', () => {
  let org;
  let orgToken;
  let customer;
  let customerToken;
  let gaEvent;
  let reservedEvent;

  beforeAll(async () => {
    org = await createUser({
      name: 'Booking Org',
      email: randomEmail('borg'),
      role: 'organizer',
      isApproved: true,
    });
    orgToken = tokenFor(org);
    customer = await createUser({ name: 'Booking Customer', email: randomEmail('bcust') });
    customerToken = tokenFor(customer);

    gaEvent = await seedLiveEvent({ owner: org._id, title: 'GA Music Night', price: 60, qty: 20 });
    reservedEvent = await seedLiveEvent({
      owner: org._id,
      title: 'Reserved Theatre',
      price: 80,
      qty: 20,
      reservedSeating: true,
    });
  });

  const gaItem = (qty = 1, overrides = {}) => ({
    categoryId: String(gaEvent.ticketCategories[0]._id),
    sessionId: String(gaEvent.sessions[0]._id),
    qty,
    ...overrides,
  });

  const reservedItem = (qty = 1, seatIds = []) => ({
    categoryId: String(reservedEvent.ticketCategories[0]._id),
    sessionId: String(reservedEvent.sessions[0]._id),
    qty,
    seatIds,
  });

  test('creates a general-admission booking (pending)', async () => {
    const res = await api
      .post('/api/bookings', customerToken)
      .send({ eventId: gaEvent._id.toString(), items: [gaItem(2)] });
    expect(res.status).toBe(201);
    expect(res.body.data.booking.status).toBe('pending');
    expect(res.body.data.booking.total).toBe(120);
  });

  test('rejects booking creation without authentication', async () => {
    const res = await api
      .post('/api/bookings')
      .send({ eventId: gaEvent._id.toString(), items: [gaItem(1)] });
    expect(res.status).toBe(401);
  });

  test('rejects an unknown ticket category', async () => {
    const res = await api
      .post('/api/bookings', customerToken)
      .send({
        eventId: gaEvent._id.toString(),
        items: [{ categoryId: 'not-a-category', sessionId: String(gaEvent.sessions[0]._id), qty: 1 }],
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/category/i);
  });

  test('creates a reserved-seating booking when seats are provided', async () => {
    const seats = await Seat.find({ event: reservedEvent._id, status: 'available' }).limit(2);
    const seatIds = seats.map((s) => String(s._id));
    const res = await api
      .post('/api/bookings', customerToken)
      .send({ eventId: reservedEvent._id.toString(), items: [reservedItem(2, seatIds)] });
    expect(res.status).toBe(201);
    expect(res.body.data.booking.status).toBe('pending');
    expect(res.body.data.seatsHeld.length).toBe(2);
  });

  test('rejects a reserved-seating booking without seat ids', async () => {
    const res = await api
      .post('/api/bookings', customerToken)
      .send({ eventId: reservedEvent._id.toString(), items: [reservedItem(1)] });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/seat selection/i);
  });

  test('rejects a quantity above maxPerOrder', async () => {
    const res = await api
      .post('/api/bookings', customerToken)
      .send({ eventId: gaEvent._id.toString(), items: [gaItem(9)] });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/maximum/i);
  });

  test('cancels a pending booking', async () => {
    const created = await api
      .post('/api/bookings', customerToken)
      .send({ eventId: gaEvent._id.toString(), items: [gaItem(1)] });
    const bookingId = created.body.data.booking._id;

    const res = await api.post(`/api/bookings/${bookingId}/cancel`, customerToken);
    expect(res.status).toBe(200);
    expect(res.body.data.booking.status).toBe('cancelled');
  });
});
