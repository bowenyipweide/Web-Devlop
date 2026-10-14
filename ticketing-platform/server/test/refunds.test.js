const {
  api,
  createUser,
  tokenFor,
  randomEmail,
  seedLiveEvent,
} = require('./helpers');

const {
  Booking,
  Voucher,
  VoucherRedemption,
} = require('./helpers').models;

describe('Refunds give rewards and loyalty points back', () => {
  let org;
  let admin;
  let adminToken;
  let customer;
  let customerToken;
  let event;

  beforeEach(async () => {
    org = await createUser({
      name: 'Refund Org',
      email: randomEmail('rorg'),
      role: 'organizer',
      isApproved: true,
    });
    admin = await createUser({
      name: 'Refund Admin',
      email: randomEmail('radmin'),
      role: 'admin',
    });
    adminToken = tokenFor(admin);
    customer = await createUser({ name: 'Refund Customer', email: randomEmail('rcust'), loyaltyPoints: 0 });
    customerToken = tokenFor(customer);
    event = await seedLiveEvent({ owner: org._id, title: 'Refund Night', price: 30, qty: 40 });
  });

  // Book 2 × $30 with a 50% voucher ($30 off), pay, and grant the loyalty points
  // the same way finalizePayment does. Returns the redemption id.
  const payWithVoucher = async () => {
    const created = await api.post('/api/vouchers', adminToken).send({
      code: `RF${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      title: 'Refund voucher',
      eventId: String(event._id),
      type: 'percent',
      value: 50,
      maxDiscount: 30,
      minSpend: 0,
    });
    expect(created.status).toBe(201);
    const code = created.body.data.voucher.code;

    const redeemed = await api.post('/api/vouchers/redeem', customerToken).send({ code });
    expect(redeemed.status).toBe(201);
    const redemptionId = String(redeemed.body.data.redemption._id);

    const booked = await api.post('/api/bookings', customerToken).send({
      eventId: String(event._id),
      items: [{
        categoryId: String(event.ticketCategories[0]._id),
        sessionId: String(event.sessions[0]._id),
        qty: 2,
      }],
      entitlements: [redemptionId],
    });
    expect(booked.status).toBe(201);
    const booking = booked.body.data.booking;
    expect(booking.subtotal).toBe(60);
    expect(booking.discount).toBe(30);
    expect(booking.total).toBe(30);

    const paid = await api.post('/api/payments/pay', customerToken).send({
      bookingId: booking._id,
      provider: 'simulated',
    });
    expect(paid.status).toBe(200);

    // finalizePayment credits floor(total) points.
    const afterPay = await require('../src/models/User').findById(customer._id);
    expect(afterPay.loyaltyPoints).toBe(30);

    return { bookingId: String(booking._id), redemptionId };
  };

  const requestAndApproveRefund = async (bookingId) => {
    const requested = await api.post(`/api/bookings/${bookingId}/cancel`, customerToken).send({});
    expect(requested.status).toBe(200);
    const approved = await api.patch(`/api/admin/refunds/${bookingId}`, adminToken)
      .send({ decision: 'approved' });
    expect(approved.status).toBe(200);
  };

  test('an approved refund returns the voucher to the customer', async () => {
    const { bookingId, redemptionId } = await payWithVoucher();

    const spent = await VoucherRedemption.findById(redemptionId);
    expect(spent.used).toBe(true);

    await requestAndApproveRefund(bookingId);

    const restored = await VoucherRedemption.findById(redemptionId);
    // The money came back off the card, so the discount must not stay burnt.
    expect(restored.used).toBe(false);
    expect(restored.usedAt).toBeFalsy();
    expect(restored.usedBooking).toBeFalsy();

    // And it is usable again on a new booking.
    const voucher = await Voucher.findOne({ title: 'Refund voucher' });
    expect(voucher.usedCount).toBe(0);
  });

  test('an approved refund claws the loyalty points back', async () => {
    const { bookingId } = await payWithVoucher();
    await requestAndApproveRefund(bookingId);

    const User = require('../src/models/User');
    const after = await User.findById(customer._id);
    expect(after.loyaltyPoints).toBe(0);

    const booking = await Booking.findById(bookingId);
    expect(booking.status).toBe('refunded');
    expect(booking.audit.some((a) => a.action === 'refund.loyalty_reversed')).toBe(true);
  });

  test('replaying the refund does not claw the points back twice', async () => {
    const { bookingId } = await payWithVoucher();
    await requestAndApproveRefund(bookingId);

    const { cancelAndRelease } = require('../src/controllers/booking.controller');
    const booking = await Booking.findById(bookingId);
    // Simulates an admin action being retried against an already-refunded booking.
    await cancelAndRelease(booking, 'refunded', admin._id);

    const User = require('../src/models/User');
    const after = await User.findById(customer._id);
    expect(after.loyaltyPoints).toBe(0);
  });

  // ---- Refund blockers ----

  // Pays, requests a refund, then puts a ticket into `state`. Returns the ids.
  const refundBlockedBy = async (mutate) => {
    const { bookingId, redemptionId } = await payWithVoucher();
    const booking = await Booking.findById(bookingId);
    const tickets = await require('../src/models/Ticket').find({ booking: booking._id });
    await mutate(tickets, booking, customerToken);

    const requested = await api.post(`/api/bookings/${bookingId}/cancel`, customerToken).send({});
    expect(requested.status).toBe(200);

    const approved = await api.patch(`/api/admin/refunds/${bookingId}`, adminToken)
      .send({ decision: 'approved' });

    return { booking, tickets, approved, redemptionId, bookingId };
  };

  test('an admin cannot refund a ticket that is listed for resale', async () => {
    const { booking, approved, redemptionId } = await refundBlockedBy(async (tickets) => {
      tickets[0].status = 'resale_listed';
      await tickets[0].save();
    });

    expect(approved.status).toBe(400);
    expect(approved.body.message).toMatch(/cannot be refunded/i);
    expect(approved.body.message).toMatch(/resale/i);

    // Refused before anything moved: booking and reward untouched.
    const after = await Booking.findById(booking._id);
    expect(after.status).toBe('refund_pending');
    expect((await require('../src/models/VoucherRedemption').findById(redemptionId)).used).toBe(true);
    const User = require('../src/models/User');
    expect((await User.findById(customer._id)).loyaltyPoints).toBe(30);
  });

  test('an admin cannot refund a ticket that was already used for entry', async () => {
    const { approved } = await refundBlockedBy(async (tickets) => {
      tickets[0].status = 'used';
      tickets[0].entryCount = 1;
      await tickets[0].save();
    });

    expect(approved.status).toBe(400);
    expect(approved.body.message).toMatch(/already used/i);
  });

  test('an admin cannot refund a partly scanned ticket', async () => {
    // Still 'active', but it has already been through the gate once.
    const { approved } = await refundBlockedBy(async (tickets) => {
      tickets[0].status = 'active';
      tickets[0].entryCount = 1;
      await tickets[0].save();
    });

    expect(approved.status).toBe(400);
    expect(approved.body.message).toMatch(/already used/i);
  });

  test('an admin cannot refund a ticket that was transferred', async () => {
    const { approved } = await refundBlockedBy(async (tickets) => {
      tickets[0].status = 'transferred';
      await tickets[0].save();
    });

    expect(approved.status).toBe(400);
    expect(approved.body.message).toMatch(/transferred/i);
  });

  test('the error names every distinct reason across the booking', async () => {
    const { approved } = await refundBlockedBy(async (tickets) => {
      tickets[0].status = 'resale_listed';
      await tickets[0].save();
      tickets[1].status = 'used';
      tickets[1].entryCount = 1;
      await tickets[1].save();
    });

    expect(approved.status).toBe(400);
    expect(approved.body.message).toMatch(/2 of its tickets/);
    expect(approved.body.message).toMatch(/resale/);
    expect(approved.body.message).toMatch(/already used/);
  });

  test('an untouched booking still refunds normally', async () => {
    const { bookingId, redemptionId } = await payWithVoucher();
    const requested = await api.post(`/api/bookings/${bookingId}/cancel`, customerToken).send({});
    expect(requested.status).toBe(200);
    const approved = await api.patch(`/api/admin/refunds/${bookingId}`, adminToken)
      .send({ decision: 'approved' });
    expect(approved.status).toBe(200);
    expect((await require('../src/models/VoucherRedemption').findById(redemptionId)).used).toBe(false);
  });

  test('a rejected refund decision is unaffected by ticket state', async () => {
    const { booking, tickets } = await refundBlockedBy(async (t) => {
      t[0].status = 'resale_listed';
      await t[0].save();
    });
    // Put it back in the queue so the decision path can be exercised.
    await Booking.updateOne({ _id: booking._id }, { $set: { status: 'refund_pending' } });

    const rejected = await api.patch(`/api/admin/refunds/${booking._id}`, adminToken)
      .send({ decision: 'rejected' });
    expect(rejected.status).toBe(200);
    expect((await Booking.findById(booking._id)).status).toBe('confirmed');
  });

  test('a cancelled unpaid booking still returns the voucher, and grants no points', async () => {
    const created = await api.post('/api/vouchers', adminToken).send({
      code: `RC${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      title: 'Cancel voucher',
      eventId: String(event._id),
      type: 'percent',
      value: 50,
      maxDiscount: 30,
      minSpend: 0,
    });
    const redeemed = await api.post('/api/vouchers/redeem', customerToken)
      .send({ code: created.body.data.voucher.code });
    const redemptionId = String(redeemed.body.data.redemption._id);

    const booked = await api.post('/api/bookings', customerToken).send({
      eventId: String(event._id),
      items: [{
        categoryId: String(event.ticketCategories[0]._id),
        sessionId: String(event.sessions[0]._id),
        qty: 2,
      }],
      entitlements: [redemptionId],
    });
    const bookingId = String(booked.body.data.booking._id);

    const cancelled = await api.post(`/api/bookings/${bookingId}/cancel`, customerToken).send({});
    expect(cancelled.status).toBe(200);

    const restored = await VoucherRedemption.findById(redemptionId);
    expect(restored.used).toBe(false);

    const User = require('../src/models/User');
    const after = await User.findById(customer._id);
    expect(after.loyaltyPoints).toBe(0);
  });
});
