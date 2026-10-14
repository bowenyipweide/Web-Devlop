const {
  api,
  createUser,
  tokenFor,
  seedLiveEvent,
  randomEmail,
} = require('./helpers');

describe('Vouchers API', () => {
  let org;
  let orgToken;
  let admin;
  let adminToken;
  let customer;
  let customerToken;
  let event;

  beforeAll(async () => {
    org = await createUser({
      name: 'Voucher Org',
      email: randomEmail('vorg'),
      role: 'organizer',
      isApproved: true,
    });
    orgToken = tokenFor(org);
    admin = await createUser({ name: 'Voucher Admin', email: randomEmail('vadmin'), role: 'admin' });
    adminToken = tokenFor(admin);
    customer = await createUser({ name: 'Voucher Customer', email: randomEmail('vcust') });
    customerToken = tokenFor(customer);
    event = await seedLiveEvent({ owner: org._id, title: 'Voucher Fest', price: 25, qty: 50 });
  });

  test('an admin can create a voucher for a live event', async () => {
    const res = await api.post('/api/vouchers', adminToken).send({
      code: 'FRIEND20',
      title: 'Friend discount',
      eventId: event._id.toString(),
      type: 'percent',
      value: 20,
      minSpend: 10,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.voucher.code).toBe('FRIEND20');
  });

  test('a customer can redeem a voucher', async () => {
    const res = await api
      .post('/api/vouchers/redeem', customerToken)
      .send({ code: 'FRIEND20' });
    expect(res.status).toBe(201);
    expect(res.body.data.voucher.code).toBe('FRIEND20');
  });

  test('redeeming an unknown voucher code returns 404', async () => {
    const res = await api
      .post('/api/vouchers/redeem', customerToken)
      .send({ code: 'DOESNOTEXIST' });
    expect(res.status).toBe(404);
  });

  test('lists the customer redemption history', async () => {
    const res = await api.get('/api/vouchers/mine', customerToken);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.redemptions)).toBe(true);
  });
});