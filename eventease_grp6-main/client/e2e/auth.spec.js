import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });

  test('login page loads with demo accounts', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await expect(page.getByText('demo@eventease.app / DemoPass123!')).toBeVisible();
  });

  test('rejects invalid credentials', async ({ page }) => {
    await page.getByLabel('Email').fill('demo@eventease.app');
    await page.getByLabel('Password').fill('wrongpassword');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.locator('.alert-error')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('logs in as customer and lands on account page', async ({ page }) => {
    await page.getByLabel('Email').fill('demo@eventease.app');
    await page.getByLabel('Password').fill('DemoPass123!');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/account/, { timeout: 15000 });
    await expect(page.getByRole('heading', { name: /Hi,/ })).toBeVisible();
  });

  test('logs in as organizer and lands on dashboard', async ({ page }) => {
    await page.getByLabel('Email').fill('org1@eventease.app');
    await page.getByLabel('Password').fill('OrgPass123!');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/organizer/, { timeout: 15000 });
    await expect(page.getByRole('heading', { name: 'Organizer Dashboard' })).toBeVisible();
  });

  test('logs in as admin and lands on admin panel', async ({ page }) => {
    await page.getByLabel('Email').fill('admin@eventease.app');
    await page.getByLabel('Password').fill('AdminPass123!');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/admin/, { timeout: 15000 });
    await expect(page.getByRole('heading', { name: 'Admin panel' })).toBeVisible();
  });

  test('logging out returns to home', async ({ page }) => {
    await page.getByLabel('Email').fill('demo@eventease.app');
    await page.getByLabel('Password').fill('DemoPass123!');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/account/, { timeout: 15000 });
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { name: 'Find your next unforgettable event.' })).toBeVisible();
  });

  test('protected route redirects to login when logged out', async ({ page }) => {
    await page.goto('/account');
    await expect(page).toHaveURL(/\/login/);
  });
});
test.describe('Account voucher list', () => {
  // Regression: the voucher card always printed "Redeemed {redeemedAt|createdAt}",
  // which is the date the code was claimed — not when it was spent. Next to the
  // "Ready to use" pill it read as though the credit were already used up.
  test('an unused voucher shows when it was added, not "Redeemed"', async ({ page, request }) => {
    const login = async (email, password) => {
      const res = await request.post('/api/auth/login', { data: { email, password } });
      expect(res.status()).toBe(200);
      return (await res.json()).data.token;
    };
    const adminToken = await login('admin@eventease.app', 'AdminPass123!');
    const demoToken = await login('demo@eventease.app', 'DemoPass123!');

    await page.goto('/login');
    await page.evaluate((t) => localStorage.setItem('eventease_token', t), demoToken);

    const title = await page.evaluate(async ([demoToken, adminToken]) => {
      const auth = (t) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}` });
      const ev = await fetch('/api/events?q=Comedy&limit=12').then((r) => r.json());
      const evt = ev.data.events.find((e) => !e.seating?.enabled);

      const created = await fetch('/api/vouchers', {
        method: 'POST',
        headers: auth(adminToken),
        body: JSON.stringify({
          code: 'ADDLABEL01',
          title: 'Added-label check voucher',
          eventId: evt.id,
          type: 'percent',
          value: 10,
          maxDiscount: 10,
          minSpend: 0,
          perUserLimit: 1,
          active: true,
        }),
      });
      if (created.status !== 201) throw new Error(`create ${created.status}: ${await created.text()}`);

      const redeemed = await fetch('/api/vouchers/redeem', {
        method: 'POST',
        headers: auth(demoToken),
        body: JSON.stringify({ code: 'ADDLABEL01' }),
      });
      if (redeemed.status !== 201) throw new Error(`redeem ${redeemed.status}: ${await redeemed.text()}`);
      return 'Added-label check voucher';
    }, [demoToken, adminToken]);

    // The vouchers tab renders only after /api/vouchers/mine resolves. Specs run
    // in parallel against one seeded database, so wait for the response rather
    // than racing it.
    const mine = page.waitForResponse((r) => r.url().includes('/api/vouchers/mine') && r.status() === 200, {
      timeout: 20000,
    });
    await page.goto('/account');
    await page.getByRole('button', { name: 'Vouchers', exact: true }).click();
    await mine;

    const card = page.locator('.row-card', { hasText: title });
    await expect(card).toBeVisible();
    await expect(card).toContainText('Ready to use');
    await expect(card).toContainText(/Added [A-Z][a-z]{2}, /);
    // The misleading "Redeemed <date>" must not appear on an unused credit.
    await expect(card).not.toContainText(/Redeemed /);
  });
});
