const {
  api,
  createUser,
  tokenFor,
  randomEmail,
  seedLiveEvent,
  models: { LoyaltyReward, Redemption, Voucher, VoucherRedemption },
} = require('./helpers');

describe('Loyalty Marketplace API', () => {
  let customer;
  let customerToken;
  let poorCustomer;
  let poorToken;
  let reward;
  let soldOutReward;

  beforeAll(async () => {
    customer = await createUser({
      name: 'Loyal Customer',
      email: randomEmail('loyal'),
      loyaltyPoints: 500,
    });
    customerToken = tokenFor(customer);
    poorCustomer = await createUser({ name: 'Poor Customer', email: randomEmail('poor') });
    poorToken = tokenFor(poorCustomer);

    reward = await LoyaltyReward.create({
      name: 'EventEase Tote Bag',
      description: 'A tote bag',
      pointsRequired: 100,
      stock: 5,
    });
    soldOutReward = await LoyaltyReward.create({
      name: 'Sold Out Mug',
      pointsRequired: 10,
      stock: 0,
    });
  });

  test('lists active rewards sorted by points', async () => {
    const res = await api.get('/api/marketplace/rewards', customerToken);
    expect(res.status).toBe(200);
    const names = res.body.data.rewards.map((r) => r.name);
    expect(names).toContain('EventEase Tote Bag');
  });

  test('redeems a reward when the user has enough points', async () => {
    const res = await api
      .post('/api/marketplace/redeem', customerToken)
      .send({ rewardId: reward._id.toString() });
    expect(res.status).toBe(201);
    expect(res.body.data.loyaltyPoints).toBe(400);
  });

  test('rejects redemption when points are insufficient', async () => {
    const res = await api
      .post('/api/marketplace/redeem', poorToken)
      .send({ rewardId: reward._id.toString() });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not enough loyalty points/i);
  });
});

describe('Loyalty gift cards', () => {
  let user;
  let token;
  let giftCard;
  let merch;

  beforeEach(async () => {
    user = await createUser({
      name: 'Gift Card Buyer',
      email: randomEmail('giftcard'),
      loyaltyPoints: 1000,
    });
    token = tokenFor(user);
    giftCard = await LoyaltyReward.create({
      name: '$10 Gift Card',
      description: '$10 off any booking on the platform.',
      pointsRequired: 300,
      value: 10,
      stock: 10,
      category: 'gift_card',
    });
    merch = await LoyaltyReward.create({
      name: 'Sticker Pack',
      pointsRequired: 50,
      stock: 10,
      category: 'merchandise',
    });
  });

  const redeemGiftCard = async (rid = giftCard._id.toString()) => {
    const res = await api.post('/api/marketplace/redeem', token).send({ rewardId: rid });
    expect(res.status).toBe(201);
    return res;
  };

  test('exposes the gift card value to the storefront', async () => {
    const res = await api.get('/api/marketplace/rewards', token);
    const card = res.body.data.rewards.find((r) => r.id === giftCard._id.toString());
    expect(card.isGiftCard).toBe(true);
    expect(card.value).toBe(10);
  });

  test('redeeming a gift card issues a platform-wide credit worth its value', async () => {
    const res = await redeemGiftCard();

    expect(res.body.data.loyaltyPoints).toBe(700);
    expect(res.body.data.giftCard).toMatchObject({ value: 10 });
    expect(res.body.data.giftCard.code).toMatch(/^GIFT-/);

    const voucher = await Voucher.findOne({ code: res.body.data.giftCard.code });
    expect(voucher.type).toBe('fixed');
    expect(voucher.value).toBe(10);
    // No event => the credit is not tied to one event.
    expect(voucher.event).toBeNull();
    expect(voucher.source).toBe('loyalty');

    const entitlement = await VoucherRedemption.findOne({ user: user._id, voucher: voucher._id });
    expect(entitlement).toBeTruthy();
    expect(entitlement.event).toBeNull();
    expect(entitlement.used).toBe(false);
  });

  test('records the issued gift card on the redemption history row', async () => {
    const res = await redeemGiftCard();
    const redemption = await Redemption.findById(res.body.data.redemption._id);
    expect(redemption.rewardCategory).toBe('gift_card');
    expect(redemption.giftCardValue).toBe(10);
    expect(redemption.giftCardCode).toBe(res.body.data.giftCard.code);
  });

  test('does not issue credit for a physical merchandise reward', async () => {
    const res = await api.post('/api/marketplace/redeem', token).send({ rewardId: merch._id.toString() });
    expect(res.status).toBe(201);
    expect(res.body.data.giftCard).toBeNull();
    expect(await VoucherRedemption.countDocuments({ user: user._id })).toBe(0);
  });

  test('applies the gift card automatically to a booking on any event', async () => {
    await redeemGiftCard();

    const organizer = await createUser({ name: 'Gift Org', email: randomEmail('giftorg'), role: 'organizer', isApproved: true });
    const event = await seedLiveEvent({ owner: organizer._id, price: 50, qty: 50 });

    const res = await api.post('/api/bookings', token).send({
      eventId: event._id.toString(),
      items: [{ categoryId: String(event.ticketCategories[0]._id), sessionId: String(event.sessions[0]._id), qty: 1 }],
    });

    expect(res.status).toBe(201);
    expect(res.body.data.booking.subtotal).toBe(50);
    expect(res.body.data.booking.discount).toBe(10);
    expect(res.body.data.booking.total).toBe(40);
  });

  test('caps the gift card at the booking subtotal on a cheap ticket', async () => {
    await redeemGiftCard();

    const organizer = await createUser({ name: 'Cheap Org', email: randomEmail('cheaporg'), role: 'organizer', isApproved: true });
    const event = await seedLiveEvent({ owner: organizer._id, price: 4, qty: 20 });

    const res = await api.post('/api/bookings', token).send({
      eventId: event._id.toString(),
      items: [{ categoryId: String(event.ticketCategories[0]._id), sessionId: String(event.sessions[0]._id), qty: 1 }],
    });

    expect(res.status).toBe(201);
    expect(res.body.data.booking.discount).toBe(4);
    expect(res.body.data.booking.total).toBe(0);
  });

  test('consumes the gift card once and releases it if the booking is cancelled', async () => {
    await redeemGiftCard();

    const organizer = await createUser({ name: 'Cancel Org', email: randomEmail('cancelorg'), role: 'organizer', isApproved: true });
    const event = await seedLiveEvent({ owner: organizer._id, price: 50, qty: 20 });
    const item = {
      categoryId: String(event.ticketCategories[0]._id),
      sessionId: String(event.sessions[0]._id),
      qty: 1,
    };

    const booked = await api.post('/api/bookings', token).send({ eventId: event._id.toString(), items: [item] });
    expect(booked.status).toBe(201);
    expect(booked.body.data.booking.discount).toBe(10);

    // The entitlement is locked to the booking as soon as the booking exists, so
    // a second booking cannot spend the same gift card while this one is unpaid.
    const locked = await VoucherRedemption.findOne({
      user: user._id,
      usedBooking: booked.body.data.booking._id,
    });
    expect(locked).toBeTruthy();
    expect(locked.used).toBe(true);

    const second = await api.post('/api/bookings', token).send({ eventId: event._id.toString(), items: [item] });
    expect(second.status).toBe(201);
    expect(second.body.data.booking.discount).toBe(0);

    const cancelled = await api.post(`/api/bookings/${booked.body.data.booking._id}/cancel`, token);
    expect(cancelled.status).toBe(200);

    const released = await VoucherRedemption.findById(locked._id);
    expect(released.used).toBe(false);
    expect(released.usedBooking).toBeFalsy();
  });

  test('an event-specific voucher is preferred over generic gift card credit', async () => {
    await redeemGiftCard();

    const organizer = await createUser({ name: 'Both Org', email: randomEmail('bothorg'), role: 'organizer', isApproved: true });
    const event = await seedLiveEvent({ owner: organizer._id, price: 100, qty: 20 });

    // A targeted 50% voucher for this event only.
    const targeted = await Voucher.create({
      code: 'TARGETED50',
      title: 'Targeted 50%',
      event: event._id,
      type: 'percent',
      value: 50,
      minSpend: 0,
      perUserLimit: 1,
      active: true,
    });
    await VoucherRedemption.create({ user: user._id, voucher: targeted._id, event: event._id });

    const res = await api.post('/api/bookings', token).send({
      eventId: event._id.toString(),
      items: [{ categoryId: String(event.ticketCategories[0]._id), sessionId: String(event.sessions[0]._id), qty: 1 }],
    });

    expect(res.status).toBe(201);
    // 50% of 100 = 50, not the gift card's 10.
    expect(res.body.data.booking.discount).toBe(50);
  });

  test('admin cannot create a gift card reward with no monetary value', async () => {
    const admin = await createUser({ name: 'Reward Admin', email: randomEmail('rwadmin'), role: 'admin' });
    const adminToken = tokenFor(admin);

    const res = await api.post('/api/marketplace/admin/rewards', adminToken).send({
      name: 'Mystery Credit',
      pointsRequired: 100,
      stock: 5,
      category: 'gift_card',
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/monetary value/i);
  });
});

describe('Stacking gift cards and vouchers at checkout', () => {
  let user;
  let token;
  let event;
  let smallCard;
  let bigCard;

  const book = (qty = 1) =>
    api.post('/api/bookings', token).send({
      eventId: event._id.toString(),
      items: [{ categoryId: String(event.ticketCategories[0]._id), sessionId: String(event.sessions[0]._id), qty }],
      entitlements: [],
    });

  const buyCard = async (name, value, points) => {
    const reward = await LoyaltyReward.create({
      name,
      pointsRequired: points,
      value,
      stock: 20,
      category: 'gift_card',
    });
    const res = await api.post('/api/marketplace/redeem', token).send({ rewardId: reward._id.toString() });
    expect(res.status).toBe(201);
    return res.body.data.giftCard.code;
  };

  beforeEach(async () => {
    user = await createUser({ name: 'Stacker', email: randomEmail('stack'), loyaltyPoints: 5000 });
    token = tokenFor(user);
    const organizer = await createUser({ name: 'Stack Org', email: randomEmail('stackorg'), role: 'organizer', isApproved: true });
    event = await seedLiveEvent({ owner: organizer._id, price: 50, qty: 100 });
  });

  test('a booking created with an empty selection starts with no discount', async () => {
    const smallCode = await buyCard('$5 Gift Card', 5, 100);
    const res = await book();
    expect(res.status).toBe(201);
    expect(res.body.data.booking.discount).toBe(0);
    expect(await VoucherRedemption.countDocuments({ user: user._id, used: false })).toBe(1);
    expect(smallCode).toMatch(/^GIFT-/);
  });

  test('lists every usable offer for the dropdown, gift cards marked as platform-wide', async () => {
    await buyCard('$5 Gift Card', 5, 100);
    await buyCard('$20 Gift Card', 20, 200);

    const booked = await book();
    const res = await api.get(`/api/vouchers/available?bookingId=${booked.body.data.booking._id}`, token);
    expect(res.status).toBe(200);

    const offers = res.body.data.entitlements;
    expect(offers).toHaveLength(2);
    // Best value first.
    expect(offers[0].discount).toBe(20);
    expect(offers.every((o) => o.isGiftCard)).toBe(true);
  });

  test('stacks two gift cards into a single combined discount', async () => {
    const smallCode = await buyCard('$5 Gift Card', 5, 100);
    const bigCode = await buyCard('$20 Gift Card', 20, 200);

    const booked = await book();
    const ids = await VoucherRedemption.find({ user: user._id }).distinct('_id');
    expect(ids).toHaveLength(2);

    const res = await api.post(`/api/bookings/${booked.body.data.booking._id}/entitlements`, token).send({
      entitlements: ids.map(String),
    });
    expect(res.status).toBe(200);
    expect(res.body.data.booking.subtotal).toBe(50);
    expect(res.body.data.booking.discount).toBe(25);
    expect(res.body.data.booking.total).toBe(25);
    expect(res.body.data.booking.discountName).toContain('$5 Gift Card');
    expect(res.body.data.booking.discountName).toContain('$20 Gift Card');

    // Both are locked to the booking, not just the first.
    const locked = await VoucherRedemption.find({ user: user._id, used: true });
    expect(locked).toHaveLength(2);
    expect(new Set(locked.map((l) => String(l.usedBooking)))).toEqual(new Set([booked.body.data.booking._id.toString()]));
    expect(smallCode).not.toBe(bigCode);
  });

  test('caps the stacked total at the subtotal and shares the cap across lines', async () => {
    await buyCard('$5 Gift Card', 5, 100);
    await buyCard('$20 Gift Card', 20, 200);

    const cheapOrg = await createUser({ name: 'Cheap Stack Org', email: randomEmail('cheapstack'), role: 'organizer', isApproved: true });
    const cheap = await seedLiveEvent({ owner: cheapOrg._id, price: 8, qty: 20 });

    const booked = await api.post('/api/bookings', token).send({
      eventId: cheap._id.toString(),
      items: [{ categoryId: String(cheap.ticketCategories[0]._id), sessionId: String(cheap.sessions[0]._id), qty: 1 }],
      entitlements: [],
    });
    expect(booked.status).toBe(201);

    const ids = await VoucherRedemption.find({ user: user._id }).distinct('_id');
    const res = await api.post(`/api/bookings/${booked.body.data.booking._id}/entitlements`, token).send({
      entitlements: ids.map(String),
    });

    expect(res.status).toBe(200);
    expect(res.body.data.booking.discount).toBe(8);
    expect(res.body.data.booking.total).toBe(0);
    // The per-line breakdown must still add up to the capped total.
    const lineSum = res.body.data.applied.reduce((s, a) => s + a.discount, 0);
    expect(Math.round(lineSum * 100) / 100).toBe(8);
  });

  test('switching the selection releases what was previously applied', async () => {
    await buyCard('$5 Gift Card', 5, 100);
    await buyCard('$20 Gift Card', 20, 200);

    const booked = await book();
    const [small, big] = await VoucherRedemption.find({ user: user._id }).sort({ 'voucher.value': 1 }).limit(2).then((r) => r.map((x) => x._id));

    const first = await api.post(`/api/bookings/${booked.body.data.booking._id}/entitlements`, token)
      .send({ entitlements: [String(small)] });
    expect(first.status).toBe(200);
    expect(first.body.data.booking.discount).toBe(5);

    const second = await api.post(`/api/bookings/${booked.body.data.booking._id}/entitlements`, token)
      .send({ entitlements: [String(big)] });
    expect(second.status).toBe(200);
    expect(second.body.data.booking.discount).toBe(20);
    expect(second.body.data.booking.total).toBe(30);

    // The dropped one is spendable again; the applied one is still locked.
    const released = await VoucherRedemption.findById(small);
    expect(released.used).toBe(false);
    expect(released.usedBooking).toBeFalsy();
    const stillLocked = await VoucherRedemption.findById(big);
    expect(stillLocked.used).toBe(true);
  });

  test('clearing the selection drops the discount entirely', async () => {
    await buyCard('$5 Gift Card', 5, 100);
    const booked = await book();
    const ids = await VoucherRedemption.find({ user: user._id }).distinct('_id');

    await api.post(`/api/bookings/${booked.body.data.booking._id}/entitlements`, token)
      .send({ entitlements: ids.map(String) });

    const cleared = await api.post(`/api/bookings/${booked.body.data.booking._id}/entitlements`, token)
      .send({ entitlements: [] });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.booking.discount).toBe(0);
    expect(cleared.body.data.booking.total).toBe(50);
    expect(cleared.body.data.booking.discountName).toBeFalsy();

    const back = await VoucherRedemption.findOne({ user: user._id });
    expect(back.used).toBe(false);
  });

  test('rejects an entitlement belonging to another customer', async () => {
    await buyCard('$5 Gift Card', 5, 100);
    const mine = await VoucherRedemption.findOne({ user: user._id });

    const other = await createUser({ name: 'Nosy', email: randomEmail('nosy') });
    const otherToken = tokenFor(other);

    const booked = await book();
    const res = await api.post(`/api/bookings/${booked.body.data.booking._id}/entitlements`, otherToken)
      .send({ entitlements: [String(mine._id)] });
    expect(res.status).toBe(404);
  });

  test('rejects an event-specific voucher on a different event', async () => {
    const otherOrg = await createUser({ name: 'Other Org', email: randomEmail('otherorg'), role: 'organizer', isApproved: true });
    const otherEvent = await seedLiveEvent({ owner: otherOrg._id, price: 40, qty: 20 });

    const voucher = await Voucher.create({
      code: 'ELSEWHERE15',
      title: 'Elsewhere 15%',
      event: otherEvent._id,
      type: 'percent',
      value: 15,
      minSpend: 0,
      perUserLimit: 1,
      active: true,
    });
    const ent = await VoucherRedemption.create({ user: user._id, voucher: voucher._id, event: otherEvent._id });

    const booked = await book();
    const res = await api.post(`/api/bookings/${booked.body.data.booking._id}/entitlements`, token)
      .send({ entitlements: [String(ent._id)] });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not valid for this event/i);
  });

  test('refuses to change discounts once the booking is paid', async () => {
    await buyCard('$5 Gift Card', 5, 100);
    const booked = await book();
    const ids = await VoucherRedemption.find({ user: user._id }).distinct('_id');

    const { finalizePayment } = require('../src/controllers/booking.controller');
    await finalizePayment({
      bookingId: booked.body.data.booking._id,
      provider: 'simulated',
      method: 'simulated',
      intentId: null,
      amount: booked.body.data.booking.total,
    });

    const res = await api.post(`/api/bookings/${booked.body.data.booking._id}/entitlements`, token)
      .send({ entitlements: ids.map(String) });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/before payment/i);
  });

  test('an explicit empty array opts out of auto-apply, an omitted field keeps it', async () => {
    await buyCard('$5 Gift Card', 5, 100);

    const auto = await api.post('/api/bookings', token).send({
      eventId: event._id.toString(),
      items: [{ categoryId: String(event.ticketCategories[0]._id), sessionId: String(event.sessions[0]._id), qty: 1 }],
    });
    expect(auto.status).toBe(201);
    expect(auto.body.data.booking.discount).toBe(5);
  });

  // Regression: applyBookingEntitlements loads the booking with .populate('event')
  // and passed that document in as `eventId`. resolveEntitlements compared
  // String(populatedDoc) against the redemption's raw event id, so every
  // event-scoped voucher was rejected with "is not valid for this event" even
  // though the dropdown had just offered it. Gift cards (event: null) skipped
  // that check, which hid the bug behind working gift cards.
  test('applies an event-scoped voucher that the dropdown just offered', async () => {
    const voucher = await Voucher.create({
      code: `SCOPED${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      title: 'Aurora Skylights special',
      event: event._id,
      type: 'percent',
      value: 20,
      maxDiscount: 30,
      minSpend: 50,
      usageLimit: 100,
      perUserLimit: 1,
      active: true,
    });
    await VoucherRedemption.create({ user: user._id, voucher: voucher._id, event: event._id });

    // Price is 50 in this fixture, so book two to clear the 50 minSpend.
    const booked = await book(2);
    expect(booked.status).toBe(201);
    const bookingId = booked.body.data.booking._id;

    const avail = await api.get(`/api/vouchers/available?bookingId=${bookingId}`, token);
    expect(avail.status).toBe(200);
    const offered = avail.body.data.entitlements.filter((e) => e.code === voucher.code);
    expect(offered).toHaveLength(1);

    const applied = await api.post(`/api/bookings/${bookingId}/entitlements`, token)
      .send({ entitlements: [offered[0].id] });

    expect(applied.status).toBe(200);
    // 20% of 100, under the 30 cap.
    expect(applied.body.data.booking.discount).toBe(20);
    expect(applied.body.data.booking.total).toBe(80);
    expect(applied.body.data.applied[0].code).toBe(voucher.code);
  });
});
