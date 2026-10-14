const {
  api,
  createUser,
  tokenFor,
  randomEmail,
  seedLiveEvent,
  models: { Booking, Voucher, VoucherRedemption },
} = require('./helpers');

describe('Chat API', () => {
  test('rejects a chat message that is missing', async () => {
    const res = await api.post('/api/chat').send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/message is required/i);
  });
});

describe('Chat reward picker', () => {
  let org;
  let adminToken;
  let customer;
  let customerToken;
  let event;

  const chat = (token, sessionId, body) =>
    api.post('/api/chat', token).send({ sessionId, ...body });

  // Walks the booking flow up to the order summary: pick event, quantity, ticket
  // type. Returns the summary response so callers can inspect the reward picker.
  const reachSummary = async (token, sessionId, qty = 2) => {
    await chat(token, sessionId, { message: 'I want to book tickets' });
    await chat(token, sessionId, {
      message: 'that one',
      action: { type: 'choose', context: 'event', id: String(event._id) },
    });
    await chat(token, sessionId, { message: String(qty) });
    return chat(token, sessionId, {
      message: 'standard',
      action: {
        type: 'choose',
        context: 'category',
        id: String(event.ticketCategories[0]._id),
      },
    });
  };

  const pickerOf = (res) => {
    expect(res.body.bubble).toBeTruthy();
    expect(res.body.bubble.type).toBe('group');
    return res.body.bubble.children.find((c) => c.type === 'discounts');
  };

  beforeAll(async () => {
    org = await createUser({
      name: 'Chat Org',
      email: randomEmail('chatorg'),
      role: 'organizer',
      isApproved: true,
    });
    adminToken = tokenFor(await createUser({
      name: 'Chat Admin',
      email: randomEmail('chatadmin'),
      role: 'admin',
    }));
    customer = await createUser({ name: 'Chat Customer', email: randomEmail('chatcust') });
    customerToken = tokenFor(customer);
    event = await seedLiveEvent({ owner: org._id, title: 'Chat Night', price: 40, qty: 50 });
  });

  beforeEach(async () => {
    await VoucherRedemption.deleteMany({ user: customer._id });
    await Booking.deleteMany({ user: customer._id });
  });

  const seedRewards = async () => {
    // Event-scoped voucher (10% of an 80 subtotal = 8) plus a platform-wide
    // gift card (15 fixed) so there is a genuine choice to offer.
    const scoped = await Voucher.create({
      code: `CHATV${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      title: 'Chat Event Voucher',
      event: event._id,
      type: 'percent',
      value: 10,
      createdBy: org._id,
    });
    const card = await Voucher.create({
      code: `CHATG${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      title: 'Chat Gift Card',
      event: null,
      type: 'fixed',
      value: 15,
      createdBy: org._id,
    });
    await VoucherRedemption.create({ user: customer._id, voucher: scoped._id });
    await VoucherRedemption.create({ user: customer._id, voucher: card._id });
    return { scoped, card };
  };

  test('offers every available reward in the summary picker, best first', async () => {
    await seedRewards();
    const res = await reachSummary(customerToken, 'session-picker-list');

    const picker = pickerOf(res);
    expect(picker).toBeTruthy();
    expect(picker.offers).toHaveLength(2);
    // listAvailableEntitlements sorts best value first: 15 gift card beats 8 voucher.
    expect(picker.offers[0].discount).toBe(15);
    expect(picker.offers[1].discount).toBe(8);
    // Nothing is pre-ticked and the quote is full price: rewards are opt-in.
    expect(picker.selected).toEqual([]);
    expect(res.body.reply).not.toMatch(/Voucher discount/);
  });

  test('the picker is offered even when there is only one reward', async () => {
    const card = await Voucher.create({
      code: `CHATS${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      title: 'Solo Gift Card',
      event: null,
      type: 'fixed',
      value: 15,
      createdBy: org._id,
    });
    await VoucherRedemption.create({ user: customer._id, voucher: card._id });

    const res = await reachSummary(customerToken, 'session-picker-solo');
    const picker = pickerOf(res);
    expect(picker).toBeTruthy();
    expect(picker.offers).toHaveLength(1);
    expect(picker.selected).toEqual([]);
  });

  test('stacks the rewards the customer selects and books them all', async () => {
    await seedRewards();
    const sessionId = 'session-picker-stack';
    const first = await reachSummary(customerToken, sessionId);
    const picker = pickerOf(first);

    // Select both instead of the pre-selected single one.
    const both = picker.offers.map((o) => o.id);
    const requoted = await chat(customerToken, sessionId, {
      message: 'use both',
      action: { type: 'discounts', selected: both },
    });
    expect(requoted.body.reply).toMatch(/Voucher discount \(.+ \+ .+\)/);
    expect(requoted.body.reply).toMatch(/-\$23/);
    // No second picker: the one in the previous message stays put and updates
    // itself, so the list does not appear to reset on every tick.
    expect(requoted.body.bubble.type).toBe('choices');
    expect(requoted.body.bubble.context).toBe('confirm');

    const booked = await chat(customerToken, sessionId, {
      message: 'yes',
      action: { type: 'choose', context: 'confirm', id: 'yes' },
    });

    expect(booked.body.bubble.type).toBe('payment');
    const booking = await Booking.findById(booked.body.bubble.bookingId);
    expect(booking.subtotal).toBe(80);
    expect(booking.discount).toBe(23);
    expect(booking.total).toBe(57);
    expect(booking.voucherRedemptions).toHaveLength(2);

    // Both rewards are actually consumed, so the account reflects the booking.
    const used = await VoucherRedemption.find({ user: customer._id, used: true });
    expect(used).toHaveLength(2);
  });

  test('dropping every reward books at full price', async () => {
    await seedRewards();
    const sessionId = 'session-picker-none';
    const first = await reachSummary(customerToken, sessionId);

    const none = await chat(customerToken, sessionId, {
      message: 'no rewards',
      action: { type: 'discounts', selected: [] },
    });
    expect(none.body.reply).not.toMatch(/Voucher discount/);

    const booked = await chat(customerToken, sessionId, {
      message: 'yes',
      action: { type: 'choose', context: 'confirm', id: 'yes' },
    });
    const booking = await Booking.findById(booked.body.bubble.bookingId);
    expect(booking.discount).toBe(0);
    expect(booking.total).toBe(80);
    expect(await VoucherRedemption.countDocuments({ user: customer._id, used: true })).toBe(0);
    expect(pickerOf(first)).toBeTruthy();
  });

  test('a reward spent after the quote is not silently swapped for another', async () => {
    const { scoped, card } = await seedRewards();
    const sessionId = 'session-picker-stale';
    const first = await reachSummary(customerToken, sessionId);
    const picker = pickerOf(first);
    const giftCardId = picker.offers.find((o) => o.isGiftCard).id;
    expect(picker.selected).toEqual([]);

    // The customer quotes the gift card, then spends it elsewhere.
    const quoted = await chat(customerToken, sessionId, {
      message: 'just the gift card',
      action: { type: 'discounts', selected: [giftCardId] },
    });
    expect(quoted.body.reply).toMatch(/-\$15/);

    await VoucherRedemption.updateOne(
      { _id: giftCardId },
      { $set: { used: true, usedAt: new Date() } }
    );

    // Confirming must not quietly apply the remaining voucher the chat never
    // quoted, so it re-quotes at full price instead of booking a different deal.
    const requoted = await chat(customerToken, sessionId, {
      message: 'yes',
      action: { type: 'choose', context: 'confirm', id: 'yes' },
    });
    expect(requoted.body.reply).toMatch(/no longer available/i);
    expect(requoted.body.reply).not.toMatch(/Voucher discount/);
    // Still selectable — the remaining voucher was never ticked either.
    expect(pickerOf(requoted).selected).toEqual([]);

    // Nothing was consumed, and the customer can still book once they agree.
    expect(await VoucherRedemption.countDocuments({ user: customer._id, used: true })).toBe(1);
    const booked = await chat(customerToken, sessionId, {
      message: 'yes now',
      action: { type: 'choose', context: 'confirm', id: 'yes' },
    });
    const booking = await Booking.findById(booked.body.bubble.bookingId);
    expect(booking.discount).toBe(0);
    expect(booking.total).toBe(80);
    expect(scoped).toBeTruthy();
    expect(card).toBeTruthy();
  });
});
