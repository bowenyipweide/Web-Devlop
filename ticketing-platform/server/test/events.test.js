const { api, createUser, tokenFor, seedLiveEvent, seedDraftEvent, randomEmail } = require('./helpers');

describe('Events API', () => {
  let org;
  let orgToken;

  beforeAll(async () => {
    org = await createUser({
      name: 'Org One',
      email: randomEmail('org'),
      role: 'organizer',
      isApproved: true,
    });
    orgToken = tokenFor(org);
    await seedLiveEvent({ owner: org._id, title: 'Concert A', city: 'Singapore' });
    await seedLiveEvent({ owner: org._id, title: 'Gala B', city: 'Jakarta' });
  });

  test('lists published events', async () => {
    const res = await api.get('/api/events');
    expect(res.status).toBe(200);
    expect(res.body.data.events.length).toBeGreaterThanOrEqual(2);
  });

  test('returns an event by slug', async () => {
    const list = await api.get('/api/events');
    const slug = list.body.data.events[0].slug;
    const res = await api.get(`/api/events/${slug}`);
    expect(res.status).toBe(200);
    expect(res.body.data.event.slug).toBe(slug);
  });

  test('draft events are hidden (404) from guests', async () => {
    const ev = await seedDraftEvent({ owner: org._id });
    const res = await api.get(`/api/events/${ev.slug}`);
    expect(res.status).toBe(404);
  });

  test('categories endpoint aggregates public events', async () => {
    const res = await api.get('/api/events/categories');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.categories)).toBe(true);
  });

  test('organizer can create an event', async () => {
    const res = await api.post('/api/events', orgToken).send({
      title: 'New Festival',
      description: 'A new festival',
      category: 'festival',
      venue: { name: 'Gardens by the Bay', city: 'Singapore' },
      startDate: new Date(Date.now() + 10 * 24 * 3600e3).toISOString(),
      ticketCategories: [{ name: 'General', price: 20, qty: 200 }],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.event.status).toBe('draft');
    expect(res.body.data.event.approval).toBe('pending');
  });

  test('a customer cannot create an event (403)', async () => {
    const customer = await createUser({ name: 'Customer', email: randomEmail('cust') });
    const res = await api.post('/api/events', tokenFor(customer)).send({
      title: 'Nope',
      description: 'x',
      venue: { name: 'V', city: 'Singapore' },
      startDate: new Date().toISOString(),
      ticketCategories: [{ name: 'G', price: 1, qty: 1 }],
    });
    expect(res.status).toBe(403);
  });

  test('creating an event without ticket categories is rejected', async () => {
    const res = await api.post('/api/events', orgToken).send({
      title: 'No Tickets',
      description: 'x',
      venue: { name: 'V', city: 'Singapore' },
      startDate: new Date().toISOString(),
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/ticket category/i);
  });
});