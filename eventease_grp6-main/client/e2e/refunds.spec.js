import { test, expect } from '@playwright/test';

const login = async (request, email, password) => {
  const r = await request.post('/api/auth/login', { data: { email, password } });
  expect(r.status()).toBe(200);
  return (await r.json()).data.token;
};

test('admin refund queue flags a resale-listed ticket and blocks approval', async ({ page, request }) => {
  const adminToken = await login(request, 'admin@eventease.app', 'AdminPass123!');
  const demoToken = await login(request, 'demo@eventease.app', 'DemoPass123!');

  await page.goto('/login');
  await page.evaluate((t) => localStorage.setItem('eventease_token', t), demoToken);

  // Book, pay, request a refund, then list a ticket for resale.
  const setup = await page.evaluate(async ([d]) => {
    const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${d}` };
    const ev = await fetch('/api/events?q=Comedy&limit=12').then((r) => r.json());
    const evt = ev.data.events.find((e) => !e.seating?.enabled);
    const cat = evt.ticketCategories[0];
    const b = await fetch('/api/bookings', { method: 'POST', headers: auth, body: JSON.stringify({
      eventId: evt.id, items: [{ categoryId: cat.id, sessionId: evt.sessions[0].id, qty: 1 }], entitlements: [] }) });
    const id = JSON.parse(await b.text()).data.booking._id;
    await fetch('/api/payments/pay', { method: 'POST', headers: auth, body: JSON.stringify({ bookingId: id, provider: 'simulated' }) });
    await fetch(`/api/bookings/${id}/cancel`, { method: 'POST', headers: auth });

    const mine = await fetch('/api/tickets', { headers: auth }).then((r) => r.json());
    const ticket = mine.data.tickets.find((t) => String(t.booking) === id);
    const listed = await fetch('/api/tickets/resale/list', { method: 'POST', headers: auth, body: JSON.stringify({ code: ticket.code, price: 10 }) });
    return { bookingId: id, listed: listed.status };
  }, [demoToken]);

  expect(setup.listed).toBe(201);

  // Admin sees it in the queue, flagged, with Approve disabled.
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@eventease.app');
  await page.getByLabel('Password').fill('AdminPass123!');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.getByRole('button', { name: 'Refunds', exact: true }).click();

  const queue = page.locator('.card.row-card').filter({ hasText: 'refund_pending' });
  await expect(queue.first()).toBeVisible();
  const flagged = queue.filter({ hasText: 'Cannot be refunded' });
  await expect(flagged.first()).toBeVisible();
  await expect(flagged.first()).toContainText('listed for resale');
  await expect(flagged.first().getByRole('button', { name: 'Approve' })).toBeDisabled();
  // Rejecting stays available: the customer still deserves an answer.
  await expect(flagged.first().getByRole('button', { name: 'Reject' })).toBeEnabled();

  // And the API refuses even if the request is sent directly.
  const forced = await request.patch(`/api/admin/refunds/${setup.bookingId}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { decision: 'approved' },
  });
  expect(forced.status()).toBe(400);
  expect((await forced.json()).message).toMatch(/cannot be refunded/i);
});
