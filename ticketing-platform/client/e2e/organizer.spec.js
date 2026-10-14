import { test, expect } from '@playwright/test';

const ORG_EMAIL = 'org1@eventease.app';
const ORG_PASS = 'OrgPass123!';

async function loginAsOrganizer(page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(ORG_EMAIL);
  await page.getByLabel('Password').fill(ORG_PASS);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/organizer/, { timeout: 15000 });
}

test.describe('Organizer dashboard', () => {
  test('loads stats and event rows', async ({ page }) => {
    await loginAsOrganizer(page);
    await expect(page.getByRole('heading', { name: 'Organizer Dashboard' })).toBeVisible();
    await expect(page.getByText('Total events')).toBeVisible();
    await expect(page.getByText('Gross revenue')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your events' })).toBeVisible();
    await expect(page.locator('.card.row-card').first()).toBeVisible();
  });

  test('navigates to create event page', async ({ page }) => {
    await loginAsOrganizer(page);
    await page.getByRole('link', { name: '+ Create event' }).click();
    await expect(page).toHaveURL(/\/organizer\/new/);
    await expect(page.getByRole('heading', { name: 'Create a new event' })).toBeVisible();
  });

  test('validates empty ticket categories', async ({ page }) => {
    await loginAsOrganizer(page);
    await page.goto('/organizer/new');
    await page.getByLabel('Event title *').fill('Playwright Validation Test');
    await page.getByLabel('Venue name *').fill('Playwright Arena');
    await page.locator('input[type=date]').first().fill('2026-11-01');
    await page.getByRole('button', { name: 'Create & submit for approval' }).click();
    await expect(page.locator('.alert-error')).toContainText('At least one complete ticket category is required.');
  });

  test('creates an event and sees it in the dashboard', async ({ page }) => {
    const title = `PW Event ${Date.now()}`;
    await loginAsOrganizer(page);
    await page.goto('/organizer/new');

    await page.getByLabel('Event title *').fill(title);
    await page.getByPlaceholder('What makes this event special?').fill('Auto-created by Playwright e2e test.');
    await page.getByLabel('Venue name *').fill('Playwright Arena');
    await page.getByLabel('City *').fill('Singapore');
    await page.locator('input[type=date]').first().fill('2026-11-01');

    await page.getByPlaceholder('Standard').fill('Standard');
    await page.getByPlaceholder('Qty').fill('100');
    await page.getByPlaceholder('$ Price').fill('20');

    await page.getByRole('button', { name: 'Create & submit for approval' }).click();
    await expect(page).toHaveURL(/\/organizer\?created=/);
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
  });

  test('opens the edit form for an existing event', async ({ page }) => {
    await loginAsOrganizer(page);
    const row = page.locator('.card.row-card', { hasText: 'Aurora Skylights: Live in Concert' });
    await expect(row).toBeVisible();
    await row.getByRole('link', { name: 'Edit' }).click();
    await expect(page).toHaveURL(/\/organizer\/edit\//);
    await expect(page.getByRole('heading', { name: 'Edit event' })).toBeVisible();
    await expect(page.getByLabel('Event title *')).toHaveValue('Aurora Skylights: Live in Concert');
  });

  test('entry scan page loads', async ({ page }) => {
    await loginAsOrganizer(page);
    await page.getByRole('link', { name: 'Entry scan (QR)' }).click();
    await expect(page).toHaveURL(/\/organizer\/validate/);
    await expect(page.getByRole('heading', { name: 'Entry validation scanner' })).toBeVisible();
  });

  test('organizer cannot access admin panel', async ({ page }) => {
    await loginAsOrganizer(page);
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/organizer/, { timeout: 15000 });
    await expect(page.getByRole('heading', { name: 'Organizer Dashboard' })).toBeVisible();
  });
});