const {
  api,
  createUser,
  tokenFor,
  randomEmail,
  seedLiveEvent,
  models: { Event },
} = require('./helpers');

describe('Admin API', () => {
  let admin;
  let adminToken;
  let customer;
  let customerToken;
  let org;
  let orgToken;

  beforeAll(async () => {
    admin = await createUser({ name: 'The Admin', email: randomEmail('admin'), role: 'admin' });
    adminToken = tokenFor(admin);
    customer = await createUser({ name: 'Plain Customer', email: randomEmail('acust') });
    customerToken = tokenFor(customer);
    org = await createUser({
      name: 'Pending Org',
      email: randomEmail('aorg'),
      role: 'organizer',
      isApproved: true,
    });
    orgToken = tokenFor(org);
  });

  test('admin can fetch platform stats', async () => {
    await seedLiveEvent({ owner: org._id, title: 'Stat Event' });
    const res = await api.get('/api/admin/stats', adminToken);
    expect(res.status).toBe(200);
    expect(typeof res.body.data.users).toBe('number');
    expect(typeof res.body.data.events).toBe('number');
  });

  test('a customer is forbidden from platform stats', async () => {
    const res = await api.get('/api/admin/stats', customerToken);
    expect(res.status).toBe(403);
  });

  test('admin approves a pending event', async () => {
    // Organizer submits a draft for approval.
    const created = await api.post('/api/events', orgToken).send({
      title: 'To Approve',
      description: 'Will be approved',
      category: 'sports',
      venue: { name: 'Stadium', city: 'Singapore' },
      startDate: new Date(Date.now() + 20 * 24 * 3600e3).toISOString(),
      ticketCategories: [{ name: 'Main', price: 10, qty: 10 }],
    });

    const res = await api
      .post(`/api/admin/events/${created.body.data.event.id}/review`, adminToken)
      .send({ decision: 'approved', note: 'Looks good' });
    expect(res.status).toBe(200);
    expect(res.body.data.event.status).toBe('published');
  });

  test('admin cannot modify their own account', async () => {
    const res = await api
      .patch(`/api/admin/users/${admin._id}`, adminToken)
      .send({ ban: true });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/cannot modify your own account/i);
  });
});