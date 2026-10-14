const {
  api,
  createUser,
  tokenFor,
  seedLiveEvent,
  randomEmail,
  createConfirmedBooking,
} = require('./helpers');

describe('Tickets API', () => {
  let org;
  let orgToken;
  let owner;
  let ownerToken;
  let other;
  let otherToken;
  let event;

  beforeAll(async () => {
    org = await createUser({
      name: 'Ticket Org',
      email: randomEmail('torg'),
      role: 'organizer',
      isApproved: true,
    });
    orgToken = tokenFor(org);
    owner = await createUser({ name: 'Ticket Owner', email: randomEmail('town') });
    ownerToken = tokenFor(owner);
    other = await createUser({ name: 'Ticket Other', email: randomEmail('toth') });
    otherToken = tokenFor(other);
    event = await seedLiveEvent({ owner: org._id, title: 'Ticket Con', price: 55, qty: 40 });
  });

  test('lists tickets owned by the user', async () => {
    await createConfirmedBooking({ user: owner, event, qty: 1 });
    const res = await api.get('/api/tickets', ownerToken);
    expect(res.status).toBe(200);
    expect(res.body.data.tickets.length).toBeGreaterThanOrEqual(1);
  });

  test('ticket owner can view ticket details', async () => {
    const booking = await createConfirmedBooking({ user: owner, event, qty: 2 });
    const code = booking.tickets[0].code;
    const res = await api.get(`/api/tickets/${code}`, ownerToken);
    expect(res.status).toBe(200);
    expect(res.body.data.ticket.code).toBe(code);
  });

  test('another user cannot view the ticket detail', async () => {
    const booking = await createConfirmedBooking({ user: owner, event, qty: 1 });
    const code = booking.tickets[0].code;
    const res = await api.get(`/api/tickets/${code}`, otherToken);
    expect(res.status).toBe(403);
  });

  test('organizer validates an active ticket for their event', async () => {
    const booking = await createConfirmedBooking({ user: owner, event, qty: 1 });
    const code = booking.tickets[0].code;
    const res = await api
      .post('/api/tickets/validate', orgToken)
      .send({ code });
    expect(res.status).toBe(200);
    expect(res.body.data.valid).toBe(true);
    expect(res.body.data.entry).toBe(1);
  });

  test('validating the same ticket again reports already used', async () => {
    const booking = await createConfirmedBooking({ user: owner, event, qty: 1 });
    const code = booking.tickets[0].code;
    await api.post('/api/tickets/validate', orgToken).send({ code });
    const res = await api.post('/api/tickets/validate', orgToken).send({ code });
    expect(res.status).toBe(200);
    expect(res.body.data.valid).toBe(false);
    expect(res.body.data.reason).toBe('already_used');
  });
});