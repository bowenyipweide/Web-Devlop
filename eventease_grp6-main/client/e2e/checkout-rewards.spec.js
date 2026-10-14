import { test, expect } from '@playwright/test';

const login = async (request, email, password) => {
  const r = await request.post('/api/auth/login', { data: { email, password } });
  expect(r.status()).toBe(200);
  return (await r.json()).data.token;
};

test('checkout offer picker is a compact one-line dropdown', async ({ page, request }) => {
  const adminToken = await login(request, 'admin@eventease.app', 'AdminPass123!');
  const demoToken = await login(request, 'demo@eventease.app', 'DemoPass123!');
  await page.goto('/login');
  await page.evaluate((t) => localStorage.setItem('eventease_token', t), demoToken);

  const bookingId = await page.evaluate(async ([demoToken, adminToken]) => {
    const auth = (t) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}` });
    const ev = await fetch('/api/events?q=Comedy&limit=12').then((r) => r.json());
    const evt = ev.data.events.find((e) => !e.seating?.enabled);
    const cat = evt.ticketCategories[0];
    const c = await fetch('/api/vouchers', { method: 'POST', headers: auth(adminToken), body: JSON.stringify({
      code: 'DROPDN1', title: 'Dropdown layout check voucher', eventId: evt.id,
      type: 'percent', value: 15, maxDiscount: 15, minSpend: 0, perUserLimit: 1, active: true }) });
    if (c.status !== 201) throw new Error('create ' + c.status + ': ' + await c.text());
    const r = await fetch('/api/vouchers/redeem', { method: 'POST', headers: auth(demoToken), body: JSON.stringify({ code: 'DROPDN1' }) });
    if (r.status !== 201) throw new Error('redeem ' + r.status + ': ' + await r.text());
    const b = await fetch('/api/bookings', { method: 'POST', headers: auth(demoToken), body: JSON.stringify({
      eventId: evt.id, items: [{ categoryId: cat.id, sessionId: evt.sessions[0].id, qty: 2 }], entitlements: [] }) });
    return JSON.parse(await b.text()).data.booking._id;
  }, [demoToken, adminToken]);

  await page.goto(`/checkout/${bookingId}`);
  const trigger = page.locator('.offer-trigger');
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveText(/Select vouchers or gift cards/);
  // Menu is closed until the trigger is used.
  await expect(page.locator('.offer-menu')).toHaveCount(0);

  await trigger.click();
  const menu = page.locator('.offer-menu');
  await expect(menu).toBeVisible();
  await expect(page.locator('.offer-row', { hasText: 'Dropdown layout check voucher' })).toHaveCount(1);

  // Checkbox sits on the same line as the text (not a wrapped second line).
  const geom = await page.evaluate(() => {
    const row = document.querySelector('.offer-row');
    const cb = row.querySelector('input');
    const label = row.querySelector('.offer-label');
    const a = cb.getBoundingClientRect(), b = label.getBoundingClientRect();
    const rows = [...document.querySelectorAll('.offer-row')].map((r) => Math.round(r.getBoundingClientRect().height));
    const menu = document.querySelector('.offer-menu');
    return {
      checkboxVerticallyCentred: Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) < 6,
      singleLineRows: rows.every((h) => h < 60),
      heights: rows,
      menuFits: menu.scrollWidth <= menu.clientWidth + 1,
      menuOverflow: menu.scrollWidth - menu.clientWidth,
    };
  });
  expect(geom.checkboxVerticallyCentred, 'checkbox not aligned with its label').toBe(true);
  expect(geom.singleLineRows, `rows wrapped: ${geom.heights}`).toBe(true);
  expect(geom.menuFits, `menu overflows by ${geom.menuOverflow}px`).toBe(true);

  // Nothing is pre-ticked, and Apply stays disabled until something is chosen.
  await expect(page.getByRole('button', { name: /^Apply \(0\)/ })).toBeDisabled();

  // Select it, then apply. Apply lives inside the popover; as a sibling it sat
  // underneath the menu and the click was swallowed.
  await page.locator('.offer-row', { hasText: 'Dropdown layout check voucher' }).click();
  await expect(trigger).toHaveText(/1 selected/);
  await page.getByRole('button', { name: /^Apply \(1\)/ }).click();
  await expect(page.locator('.alert.alert-success')).toContainText('Dropdown layout check voucher');
  const discounted = await page.locator('.totals .success').innerText();
  expect(discounted).toMatch(/^-\$\d/);

  // An applied voucher has to still be listed (as Applied) and removable. Applying
  // marks it used, so it disappears from the plain available list — which used to
  // leave it in the total with nothing selectable.
  await trigger.click();
  await expect(menu).toBeVisible();
  const appliedRow = page.locator('.offer-row', { hasText: 'Dropdown layout check voucher' });
  await expect(appliedRow).toHaveCount(1);
  await expect(appliedRow).toContainText('Applied');

  // Untick it and apply the empty set to actually take the discount off.
  await appliedRow.click();
  await expect(trigger).toHaveText(/Select vouchers or gift cards/);
  await expect(page.getByRole('button', { name: /^Apply \(0\)/ })).toBeEnabled();
  await page.getByRole('button', { name: /^Apply \(0\)/ }).click();
  await expect(page.locator('.totals .success')).toHaveCount(0);
  await expect(page.locator('.totals .total')).not.toContainText('NaN');

  // Released, so it is offerable again on the booking.
  await expect(page.locator('.offer-row', { hasText: 'Dropdown layout check voucher' })).toHaveCount(0);
});

test('admin reward category is a dropdown with a custom option', async ({ page, request }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@eventease.app');
  await page.getByLabel('Password').fill('AdminPass123!');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.getByRole('button', { name: 'Rewards', exact: true }).click();

  const select = page.locator('select').filter({ has: page.locator('option[value="gift_card"]') });
  await expect(select).toHaveCount(1);
  // The slugs are gone as raw choices; friendly labels are shown instead.
  await expect(select.locator('option[value="gift_card"]')).toHaveText('Gift card (monetary credit)');

  // Picking gift card reveals the value field (it always did, via free text).
  await select.selectOption('gift_card');
  await expect(page.getByText('Gift card value *')).toBeVisible();
  await expect(page.getByText('Saved as “gift_card”')).toBeVisible();

  // "Other…" reveals a slug field that is not restricted to the known set.
  await select.selectOption('__custom__');
  const custom = page.getByLabel('Custom category slug');
  await expect(custom).toBeVisible();
  await custom.fill('Season Pass');
  await expect(custom).toHaveValue('season_pass');
  // A custom (non gift_card) category must NOT demand a monetary value.
  await expect(page.getByText('Gift card value *')).toHaveCount(0);
});
