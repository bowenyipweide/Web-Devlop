const { api, createUser, tokenFor, randomEmail, seedLiveEvent } = require('./helpers');

describe('Organizer analytics API', () => {
  let org;
  let orgToken;
  let customer;
  let customerToken;

  beforeAll(async () => {
    org = await createUser({
      name: 'Analytics Org',
      email: randomEmail('aorg2'),
      role: 'organizer',
      isApproved: true,
    });
    orgToken = tokenFor(org);
    customer = await createUser({ name: 'Analytics Customer', email: randomEmail('acust2') });
    customerToken = tokenFor(customer);
    await seedLiveEvent({ owner: org._id, title: 'Analytics Gig' });
  });

  test('organizer can view the dashboard summary', async () => {
    const res = await api.get('/api/organizer/dashboard', orgToken);
    expect(res.status).toBe(200);
    expect(res.body.data.summary.events).toBeGreaterThanOrEqual(1);
  });

  test('a customer cannot view the dashboard', async () => {
    const res = await api.get('/api/organizer/dashboard', customerToken);
    expect(res.status).toBe(403);
  });
});