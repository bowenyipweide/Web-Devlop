import { test, expect } from '@playwright/test';

test.describe('Home page', () => {
  test('renders hero and event grid', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Find your next unforgettable event.' })).toBeVisible();
    await expect(page.locator('.event-card').first()).toBeVisible();
  });

  test('search filters events', async ({ page }) => {
    await page.goto('/');
    await page.getByPlaceholder('Search concerts, theatre, sports…').fill('Comedy');
    await page.getByPlaceholder('Search concerts, theatre, sports…').press('Enter');
    await expect(page).toHaveURL(/\?q=Comedy/);
    await expect(page.getByRole('heading', { name: 'Comedy Night: Laugh Riot' })).toBeVisible();
  });

  test('category tab filters events', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: '🏆 Sports' }).click();
    await expect(page).toHaveURL(/category=sports/);
    await expect(page.getByRole('heading', { name: 'SG Premier League: Finals Weekend' })).toBeVisible();
  });

  test('language switch changes UI language', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '中文' }).click();
    await expect(page.getByRole('heading', { name: '找到你的下一场难忘活动。' })).toBeVisible();
  });

  test('accessibility menu toggles prefs', async ({ page }) => {
    await page.goto('/');
    await page.getByTitle('Accessibility settings').click();
    await expect(page.getByText('High contrast')).toBeVisible();
    const cb = page.getByLabel('High contrast');
    await cb.check();
    await expect(cb).toBeChecked();
  });

  // Regression: .hero-sub hardcoded rgba(5,5,5,0.85) instead of a token, so the
  // high-contrast overrides (which only redefine custom properties) never reached
  // it and the tagline stayed near-black. Measured, not just eyeballed.
  test('hero tagline stays legible in the default theme and in high contrast', async ({ page }) => {
    const measure = () =>
      page.evaluate(() => {
        const el = document.querySelector('.hero-sub');
        const bg = getComputedStyle(document.querySelector('.hero')).backgroundImage;
        return { color: getComputedStyle(el).color, bg, contrastClass: document.body.className };
      });

    await page.goto('/');
    const normal = await measure();
    // Every gradient stop is dark, so the tagline must be light in both themes.
    const rgb = normal.color.match(/\d+/g).map(Number);
    const luminance = rgb
      .slice(0, 3)
      .map((c) => {
        const v = c / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      })
      .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    expect(luminance, `.hero-sub default color ${normal.color} is too dark for the hero`).toBeGreaterThan(0.6);

    await page.getByTitle('Accessibility settings').click();
    await page.getByLabel('High contrast').check();
    await expect(page.getByLabel('High contrast')).toBeChecked();

    const contrast = await measure();
    expect(contrast.contrastClass).toContain('a11y-contrast');
    const crgb = contrast.color.match(/\d+/g).map(Number);
    const clum = crgb
      .slice(0, 3)
      .map((c) => {
        const v = c / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      })
      .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    expect(clum, `.hero-sub high-contrast color ${contrast.color} is not light`).toBeGreaterThan(0.6);
  });
});

test.describe('Hero tagline contrast', () => {
  // .hero-sub is used in two contexts with opposite foregrounds: the purple
  // gradient banner (HomePage) and the light image-hero panel (EventPage).
  // Setting the colour globally to white fixed the banner but made the
  // EventPage date/venue line white-on-white and invisible. Both are asserted
  // here, in the default and high-contrast themes.
  const luminance = (rgb) =>
    rgb
      .slice(0, 3)
      .map((c) => {
        const v = c / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      })
      .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);

  const contrastRatio = (fg, bg) => {
    const a = luminance(fg);
    const b = luminance(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };

  // Samples the painted pixel behind the text: the banner's backgroundColor is
  // transparent (it is a gradient), so a computed-style walk-up gives a false
  // reading. The probe sits at the element's RIGHT edge, not a few px in from
  // the left: the tagline starts with an emoji, and sampling the glyph (a bright
  // colour) instead of the background reports a false low-contrast failure.
  // The text is left-aligned and shorter than its box, so the right edge is bare
  // background.
  const measure = async (page, selector) => {
    const el = page.locator(selector).first();
    const box = await el.boundingBox();
    const fg = (await el.evaluate((n) => getComputedStyle(n).color)).match(/[\d.]+/g).slice(0, 3).map(Number);
    const png = await page.screenshot({
      clip: { x: Math.max(0, box.x + box.width - 3), y: Math.max(0, box.y + box.height / 2 - 1), width: 1, height: 1 },
    });
    const bg = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      canvas.getContext('2d').drawImage(img, 0, 0);
      return [...canvas.getContext('2d').getImageData(0, 0, 1, 1).data];
    }, png.toString('base64'));
    return contrastRatio(fg, bg);
  };

  const toggleContrast = async (page, on) => {
    await page.getByTitle('Accessibility settings').click();
    const cb = page.getByLabel('High contrast');
    if (on) await cb.check();
    else await cb.uncheck();
    await expect(page.locator('body')).toHaveClass(on ? /a11y-contrast/ : /^((?!a11y-contrast).)*$/);
  };

  test('home banner tagline clears AA in both themes', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.hero .hero-sub')).toBeVisible();

    const normal = await measure(page, '.hero .hero-sub');
    expect(normal, 'home banner tagline, default theme').toBeGreaterThanOrEqual(4.5);

    await toggleContrast(page, true);
    const hc = await measure(page, '.hero .hero-sub');
    expect(hc, 'home banner tagline, high contrast').toBeGreaterThanOrEqual(4.5);
  });

  test('event page tagline is not white-on-white', async ({ page }) => {
    await page.goto('/');
    await page.locator('.event-card').first().click();
    await page.waitForSelector('.event-hero-info .hero-sub', { timeout: 15000 });

    const normal = await measure(page, '.event-hero-info .hero-sub');
    expect(normal, 'event page tagline, default theme').toBeGreaterThanOrEqual(4.5);

    await toggleContrast(page, true);
    const hc = await measure(page, '.event-hero-info .hero-sub');
    expect(hc, 'event page tagline, high contrast').toBeGreaterThanOrEqual(4.5);
  });
});

test.describe('Public pages', () => {
  test('resale market page loads', async ({ page }) => {
    await page.goto('/resale');
    await expect(page.getByRole('heading', { name: 'Resale market' })).toBeVisible();
  });

  test('register page loads', async ({ page }) => {
    await page.goto('/register');
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  });

  test('unknown route shows 404', async ({ page }) => {
    await page.goto('/does-not-exist');
    await expect(page.getByRole('heading', { name: '404' })).toBeVisible();
    await expect(page.getByText('Page not found.')).toBeVisible();
  });
});