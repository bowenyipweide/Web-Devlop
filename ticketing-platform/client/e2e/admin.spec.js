import { test, expect } from '@playwright/test';

const ADMIN_EMAIL = 'admin@eventease.app';
const ADMIN_PASS = 'AdminPass123!';

async function loginAsAdmin(page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(ADMIN_EMAIL);
  await page.getByLabel('Password').fill(ADMIN_PASS);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/admin/, { timeout: 15000 });
  await expect(page.getByRole('heading', { name: 'Admin panel' })).toBeVisible();
}

test.describe('Admin panel', () => {
  test('overview shows platform stats', async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page.getByText(/users ·/)).toBeVisible();
    await expect(page.locator('.stat', { hasText: 'Users' })).toBeVisible();
    await expect(page.locator('.stat', { hasText: 'Events' })).toBeVisible();
    await expect(page.locator('.stat', { hasText: 'Tickets sold' })).toBeVisible();
    await expect(page.locator('.stat', { hasText: 'Revenue' })).toBeVisible();
  });

  test('users tab lists users with roles and pending organizers', async ({ page }) => {
    await loginAsAdmin(page);
    await page.getByRole('button', { name: 'Users', exact: true }).click();
    await expect(page.getByText('Platform Admin')).toBeVisible();
    await expect(page.getByText('Starlight Events', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('approved: no').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve' }).first()).toBeVisible();
  });

  test('moderation tab shows review queue or empty state', async ({ page }) => {
    await loginAsAdmin(page);
    await page.getByRole('button', { name: 'Moderation', exact: true }).click();
    const cards = page.locator('section.card-list .card');
    if ((await cards.count()) === 0) {
      await expect(page.getByText('Nothing waiting for review — all clear.')).toBeVisible();
    } else {
      await expect(cards.first()).toBeVisible();
    }
  });

  test('refunds tab shows empty state when no refunds', async ({ page }) => {
    await loginAsAdmin(page);
    await page.getByRole('button', { name: 'Refunds', exact: true }).click();
    await expect(page.getByText('No active refund requests.')).toBeVisible();
  });

  test('fraud monitor shows flagged customers section', async ({ page }) => {
    await loginAsAdmin(page);
    await page.getByRole('button', { name: 'Fraud', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Fraud monitor' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '🚨 Flagged customers' })).toBeVisible();
  });

  test('creates and lists a marketplace reward', async ({ page }) => {
    const name = `PW Reward ${Date.now()}`;
    await loginAsAdmin(page);
    await page.getByRole('button', { name: 'Rewards', exact: true }).click();

    await page.getByLabel('Reward name *').fill(name);
    await page.getByLabel('Description').fill('Auto-created by Playwright e2e test.');
    await page.getByLabel('Points required *').fill('100');
    await page.getByLabel('Stock (quantity available)').fill('5');
    await page.getByRole('button', { name: 'Create reward' }).click();

    await expect(page.getByText('Reward created.')).toBeVisible();
    const rewardCard = page.locator('.card.row-card', { has: page.getByRole('heading', { name }) });
    await expect(rewardCard).toContainText('100 pts · stock 5 · 0 redeemed');
  });

  test('creates and lists a voucher', async ({ page }) => {
    const code = `PW${Date.now().toString().slice(-6)}`;
    await loginAsAdmin(page);
    await page.getByRole('button', { name: 'Vouchers', exact: true }).click();

    await page.getByLabel('Event *').selectOption({ index: 1 });
    await page.getByLabel('Redemption code *').fill(code);
    await page.getByLabel('Title *').fill('Playwright discount');
    await page.getByLabel('Value *').fill('10');
    await page.getByRole('button', { name: 'Create voucher' }).click();

    await expect(page.getByText(`Voucher ${code} created.`)).toBeVisible();
    const voucherCard = page.locator('.card.row-card', { has: page.locator('code', { hasText: code }) });
    await expect(voucherCard.getByRole('heading', { name: /discount/ })).toBeVisible();
  });

  test('admin cannot access organizer panel', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/organizer');
    await expect(page).toHaveURL(/\/admin/, { timeout: 15000 });
    await expect(page.getByRole('heading', { name: 'Admin panel' })).toBeVisible();
  });
});