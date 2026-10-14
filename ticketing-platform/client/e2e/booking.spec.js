import { test, expect } from '@playwright/test';

test.describe('Event detail', () => {
  test('opens an event from the grid with details', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.event-card').first()).toBeVisible();
    const title = await page.locator('.event-card').first().locator('h3').innerText();
    await page.locator('.event-card').first().click();
    await expect(page).toHaveURL(/\/events\/.+/);
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await expect(page.getByRole('button', { name: /Continue to checkout/ })).toBeVisible();
  });
});

test.describe('Booking flow (customer)', () => {
  test('books and pays for a ticket via the simulated gateway', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('demo@eventease.app');
    await page.getByLabel('Password').fill('DemoPass123!');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/account/, { timeout: 15000 });

    await page.getByPlaceholder('Search concerts, theatre, sports…').fill('Comedy');
    await page.getByPlaceholder('Search concerts, theatre, sports…').press('Enter');
    await expect(page.getByRole('heading', { name: 'Comedy Night: Laugh Riot' })).toBeVisible();
    await page.getByRole('heading', { name: 'Comedy Night: Laugh Riot' }).click();

    await page.getByLabel('+ General').click();
    await expect(page.getByText('1 ticket(s) selected')).toBeVisible();
    await page.getByRole('button', { name: /Continue to checkout/ }).click();

    await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Comedy Night: Laugh Riot')).toBeVisible();

    const termsBox = page.locator('.terms-consent input[type=checkbox]');
    await termsBox.click();
    const scrollBox = page.locator('.terms-scroll');
    await scrollBox.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await page.getByRole('button', { name: 'I have read and accept' }).click();
    await expect(termsBox).toBeChecked();

    await page.getByRole('button', { name: /Pay \$35 · Instant demo →/ }).click();
    await expect(page.getByRole('heading', { name: 'Payment successful!' })).toBeVisible({ timeout: 20000 });
  });
});
test.describe('Checkout discount picker layout', () => {
  // Regression: .offer-label was `flex: 1` with no `min-width: 0`, so its
  // flex-basis stayed auto and a long voucher title set the row's intrinsic
  // width. The row rendered ~690px wide inside a 516px card and pushed the whole
  // checkout page wider than its own container, spilling text outside the page.
  test('a long voucher title stays inside the checkout card', async ({ page, request }) => {
    const login = async (email, password) => {
      const res = await request.post('/api/auth/login', { data: { email, password } });
      expect(res.status()).toBe(200);
      return (await res.json()).data.token;
    };
    const adminToken = await login('admin@eventease.app', 'AdminPass123!');
    const demoToken = await login('demo@eventease.app', 'DemoPass123!');

    await page.goto('/login');
    await page.evaluate((t) => localStorage.setItem('eventease_token', t), demoToken);

    const bookingId = await page.evaluate(async ([demoToken, adminToken]) => {
      const auth = (t) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}` });
      const ev = await fetch('/api/events?q=Comedy&limit=12').then((r) => r.json());
      const evt = ev.data.events.find((e) => !e.seating?.enabled);
      const cat = evt.ticketCategories[0];

      const created = await fetch('/api/vouchers', {
        method: 'POST',
        headers: auth(adminToken),
        body: JSON.stringify({
          code: 'LONGTITLE20',
          title: 'Comedy Night early-bird supporter discount voucher for very long word wrapping',
          eventId: evt.id,
          type: 'percent',
          value: 20,
          maxDiscount: 30,
          minSpend: 0,
          perUserLimit: 1,
          active: true,
        }),
      });
      const createdBody = await created.text();
      if (created.status !== 201) throw new Error(`voucher create ${created.status}: ${createdBody}`);

      const redeemed = await fetch('/api/vouchers/redeem', {
        method: 'POST',
        headers: auth(demoToken),
        body: JSON.stringify({ code: 'LONGTITLE20' }),
      });
      const redeemedBody = await redeemed.text();
      if (redeemed.status !== 201) throw new Error(`redeem ${redeemed.status}: ${redeemedBody}`);

      const booked = await fetch('/api/bookings', {
        method: 'POST',
        headers: auth(demoToken),
        body: JSON.stringify({
          eventId: evt.id,
          items: [{ categoryId: cat.id, sessionId: evt.sessions[0].id, qty: 2 }],
          entitlements: [],
        }),
      });
      const bookedBody = await booked.text();
      if (booked.status !== 201) throw new Error(`booking ${booked.status}: ${bookedBody}`);
      return JSON.parse(bookedBody).data.booking._id;
    }, [demoToken, adminToken]);

    await page.goto(`/checkout/${bookingId}`);
    // The offers live behind the compact picker, so open it before measuring.
    const trigger = page.locator('.offer-trigger');
    await expect(trigger).toBeVisible();
    await trigger.click();
    await page.waitForSelector('.offer-row', { timeout: 15000 });
    // Not an exact count: the demo account may hold other vouchers, and other
    // specs share this seeded database.
    const longTitle = page.locator('.offer-row', { hasText: 'early-bird supporter discount voucher' });
    await expect(longTitle).toHaveCount(1);

    const overflowing = await page.evaluate(() => {
      const out = [];
      document
        .querySelectorAll('.card, .offer-picker, .offer-list, .offer-row, .offer-label, .table')
        .forEach((el) => {
          if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1)
            out.push(`${el.tagName}.${el.className} sw=${el.scrollWidth} cw=${el.clientWidth}`);
        });
      return out;
    });

    expect(overflowing, `elements overflowing their box: ${overflowing.join(', ')}`).toEqual([]);
    // One line per offer even with a very long voucher name: it truncates rather
    // than growing the row into a two-line block.
    const rowHeights = await page.$$eval('.offer-row', (els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
    expect(Math.max(...rowHeights), `rows wrapped: ${rowHeights}`).toBeLessThan(60);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      'checkout page scrolls horizontally'
    ).toBe(true);
  });
});
