// Screenshots the Satellites modal for the PR: a private machine's card (marker, Rename/Remove)
// and the invite form with the everyone/private choice.
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 850 } });
const logs = [];
page.on('console', (m) => ['error'].includes(m.type()) && logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));

const login = await page.request.post('http://localhost:4611/api/login', { data: { password: 'dev' } });
console.log('login', login.status());
await page.goto('http://localhost:4611/lite');
await page.waitForSelector('#btn-nodes', { timeout: 30000 });
// First visit asks for a name: give one and enter.
const enter = page.getByRole('button', { name: /enter|join|start/i });
if (await enter.count()) {
  const input = page.locator('.modal input').first();
  if (await input.count()) await input.fill('Shot Taker');
  await enter.first().click();
  await page.waitForTimeout(500);
}
await page.click('#btn-nodes');
await page.waitForSelector('.modal.nodes', { timeout: 10000 });

// Invite a private machine through the form.
await page.getByRole('button', { name: /Invite a machine/ }).click();
await page.fill('.nd-form input[type="text"]', 'Build box');
await page.check('.nd-form input[value="private"]');
await page.screenshot({ path: '/tmp/satellites-form.png' });
await page.getByRole('button', { name: /Create invite/ }).click();
await page.waitForSelector('.nd-node', { timeout: 10000 });
await page.waitForTimeout(400);

// Reopen the invite form so the shot has both: the choice and the card's actions.
await page.getByRole('button', { name: /Invite a machine/ }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: '/tmp/satellites-modal.png' });

console.log(logs.length ? logs.join('\n') : 'no console errors');
await browser.close();
