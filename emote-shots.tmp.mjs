// Screenshots the emote work for the PR: the open wheel, and the character mid-emote in third person.
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('console', (m) => ['error'].includes(m.type()) && logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
await page.goto('http://localhost:4611/?password=dev');
// The dev office wants its password: sign in, then load the page with the cookie.
const login = await page.request.post('http://localhost:4611/api/login', { data: { password: 'dev' } });
console.log('login', login.status());
await page.goto('http://localhost:4611/');

// In: wait for the office; first visit asks for a character — name it and enter.
await page.waitForFunction(() => window.__office, null, { timeout: 60000 });
const enter = page.getByRole('button', { name: /enter the office/i });
if (await enter.count()) {
  const input = page.locator('.modal input');
  await input.fill('');
  await input.fill('Shot Taker');
  await enter.click();
}
await page.waitForFunction(() => !document.querySelector('.modal'), null, { timeout: 30000 });
await page.waitForTimeout(4000);

// 1. The wheel open (tap G), pointer free for clicking.
await page.keyboard.press('KeyG');
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/emote-wheel.png' });

// Point at an emote and let go? Just close with Esc — second screenshot shows Esc closed it.
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// 2. The character mid-emote: third person, the six seven, a beat into it.
await page.evaluate(() => {
  const o = window.__office;
  o.player.setView('third');
  o.emote('sixseven');
});
await page.waitForTimeout(1200);
await page.screenshot({ path: '/tmp/emote-sixseven.png' });

// 3. A looping dance, a couple of beats in.
await page.evaluate(() => window.__office.emote('spin'));
await page.waitForTimeout(1600);
await page.screenshot({ path: '/tmp/emote-spin.png' });

console.log(logs.length ? logs.join('\n') : 'no console errors');
await browser.close();
