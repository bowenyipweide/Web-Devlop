const {
  api,
  createUser,
  tokenFor,
  randomEmail,
  seedLiveEvent,
} = require('./helpers');

describe('User account API', () => {
  let org;
  let orgToken;
  let user;
  let token;
  let event;

  beforeAll(async () => {
    org = await createUser({
      name: 'User Org',
      email: randomEmail('uorg'),
      role: 'organizer',
      isApproved: true,
    });
    orgToken = tokenFor(org);
    user = await createUser({ name: 'Profile User', email: randomEmail('uuser') });
    token = tokenFor(user);
    event = await seedLiveEvent({ owner: org._id, title: 'User Event' });
  });

  test('update own profile', async () => {
    const res = await api
      .patch('/api/users/profile', token)
      .send({ name: 'Renamed User', notifications: { email: false } });
    expect(res.status).toBe(200);
    expect(res.body.data.user.name).toBe('Renamed User');
  });

  test('apply to become an organizer', async () => {
    const res = await api
      .post('/api/users/apply-organizer', token)
      .send({ organization: 'Cool Co Pte Ltd', organizerBio: 'We host shows.' });
    expect(res.status).toBe(200);
    expect(res.body.data.user.pendingOrganizer).toBe(true);
    expect(res.body.data.user.role).toBe('customer');
  });

  test('toggle a favourite event', async () => {
    const res = await api.post(`/api/users/favorites/${event._id}`, token);
    expect(res.status).toBe(200);
    expect(
      res.body.data.favorites.map((f) => String(f)).includes(String(event._id))
    ).toBe(true);
  });
});