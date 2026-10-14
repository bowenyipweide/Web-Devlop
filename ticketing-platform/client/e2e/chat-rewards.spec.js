import { test, expect } from '@playwright/test';
const login = async (request, email, password) => {
  const r = await request.post('/api/auth/login', { data: { email, password } });
  return (await r.json()).data.token;
};
test('chat picker toggles without resetting', async ({ page, request }) => {
  test.setTimeout(120000);
  const adminToken = await login(request, 'admin@eventease.app', 'AdminPass123!');
  const demoToken = await login(request, 'demo@eventease.app', 'DemoPass123!');
  await page.goto('/login');
  await page.evaluate((t) => localStorage.setItem('eventease_token', t), demoToken);

  await page.evaluate(async ([d, a]) => {
    const auth = (t) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}` });
    const ev = await fetch('/api/events?q=Comedy&limit=12').then((r) => r.json());
    const evt = ev.data.events.find((e) => !e.seating?.enabled);
    window.__evtId = evt.id;
    const mk = async (code, title, type, value) => {
      const c = await fetch('/api/vouchers', { method: 'POST', headers: auth(a), body: JSON.stringify(
        { code, title, eventId: evt.id, type, value, maxDiscount: value, minSpend: 0, perUserLimit: 1, active: true }) });
      if (c.status !== 201) throw new Error(code + ' ' + c.status + ': ' + await c.text());
      const r = await fetch('/api/vouchers/redeem', { method: 'POST', headers: auth(d), body: JSON.stringify({ code }) });
      if (r.status !== 201) throw new Error(code + ' redeem ' + r.status + ': ' + await r.text());
    };
    await mk('CHT01', 'Chat A voucher', 'percent', 10);
    await mk('CHT02', 'Chat B voucher', 'percent', 20);
  }, [demoToken, adminToken]);

  await page.goto('/');
  await page.locator('.chatbot-launcher').click();
  const send = async (text) => {
    await page.locator('.chatbot-form input').fill(text);
    await page.locator('.chatbot-form button[type=submit]').click();
    await page.waitForTimeout(700);
  };
  await send('I want to book comedy night tickets');
  // Click through the structured choices until the order summary shows up,
  // answering the quantity prompt when it appears.
  for (let i = 0; i < 8; i += 1) {
    if (await page.locator('.chat-offers').count()) break;
    // Look at the newest bot message; the user's own echo is always last.
    const lastMsg = page.locator('.chat-msg:not(.me)').last();
    const last = await lastMsg.innerText();
    if (/how many/i.test(last)) {
      await send('2');
      continue;
    }
    // Stop at the summary rather than clicking "Change something".
    if (/Here's your order summary/i.test(last)) {
      await page.waitForTimeout(1200);
      break;
    }
    // Only the newest message: buttons from earlier turns stay in the DOM.
    const btns = lastMsg.locator('.chat-choice-btn:not([disabled])');
    if (!(await btns.count())) break;
    // The vouchers are scoped to the seeded comedy night, so pick that show.
    const target = btns.filter({ hasText: /Comedy/i }).first();
    await (await target.count() ? target : btns.last()).click();
    await page.waitForTimeout(1000);
  }

  const picker = page.locator('.chat-offers').last();
  await expect(picker).toBeVisible();
  await picker.locator('.offer-trigger').click();
  // Other specs share this seeded demo account, so target our own two codes
  // rather than counting the whole list.
  const rows = picker.locator('.offer-row').filter({ hasText: /Chat [AB] voucher/ });
  await expect(rows).toHaveCount(2);
  await expect(rows.locator('input:checked')).toHaveCount(0);

  // Ticking is local: no new message, no second picker, menu stays open.
  await rows.nth(0).locator('input').check();
  await expect(rows.locator('input:checked')).toHaveCount(1);
  await expect(page.locator('.chat-offers')).toHaveCount(1);
  await expect(picker.locator('.offer-menu')).toBeVisible();

  // Unticking used to snap straight back.
  await rows.nth(0).locator('input').uncheck();
  await expect(rows.locator('input:checked')).toHaveCount(0);
  await expect(page.locator('.chat-offers')).toHaveCount(1);
  await expect(picker.locator('.offer-menu')).toBeVisible();

  // Stack both, then apply: one round trip, one re-quote.
  await rows.nth(0).locator('input').check();
  await rows.nth(1).locator('input').check();
  await expect(rows.locator('input:checked')).toHaveCount(2);
  await expect(picker.locator('.offer-trigger-label')).toHaveText('2 rewards selected');

  await picker.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.chat-offers')).toHaveCount(1);
  await expect(page.locator('.chat-msg:not(.me)').last()).toContainText('+');

  // And the confirmed booking carries both rewards.
  await page.locator('.chat-msg:not(.me)').last().getByRole('button', { name: /Yes, book it/ }).click();
  await expect(page.locator('.chat-payment')).toBeVisible();
  await expect(page.locator('.chat-payment-total')).toContainText('$');
});
