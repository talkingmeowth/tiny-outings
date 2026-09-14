// Local-only visual/interaction regression check. All non-local requests are mocked or blocked.
// PLAYWRIGHT_MODULE may point to a bundled Playwright ESM entry; no dependency change needed.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.DESIGN19_TEST_URL || 'http://127.0.0.1:5189';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Test only against local app');
const colorScheme = process.env.DESIGN19_TEST_SCHEME || 'dark';
assert.ok(['light', 'dark'].includes(colorScheme));
const output = resolve(process.env.DESIGN19_TEST_OUTPUT || `output/design19-qa/${colorScheme}`);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const failures = [];
const checks = [];
const contrastIssues = [];
let supabaseHost;
const adminUser = { id: '00000000-0000-4000-8000-000000000099', email: 'tinyoutings-qa-admin@tinyoutings.test', aud: 'authenticated', role: 'authenticated', user_metadata: {} };
const fixture = ['Little London Explorers', 'Saturday Story Club', 'Garden Playtime'].map((name, index) => ({
  activity_id: `00000000-0000-4000-8000-00000000000${index + 1}`,
  activity_name: name, category: 'Parks & outdoor play', public_listing_status: 'published', archive: false,
  description: 'Explore, play and discover together in London.', borough: 'Camden', address: 'London NW1',
  start_time: '09:00', end_time: '11:00', cost: 'Free', age_suitability: 'All ages',
  days_of_week: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  lat: 51.535 + index / 100, long: -.15, source_name: 'Other',
  website: 'https://example.test/activity',
}));
async function contextFor(width, height, admin = false) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  await context.routeWebSocket('**/*', (socket) => socket.close());
  if (admin) {
    assert.ok(supabaseHost, 'Configured Supabase client reached the local request mock');
    await context.addInitScript(({ host, user }) => {
      const expires = Math.floor(Date.now() / 1000) + 3600;
      const access = `${btoa(JSON.stringify({ alg: 'HS256' }))}.${btoa(JSON.stringify({ sub: user.id, exp: expires, role: 'authenticated' }))}.local-fixture-only`;
      localStorage.setItem(`sb-${host.split('.')[0]}-auth-token`, JSON.stringify({ access_token: access, refresh_token: 'local-fixture-only', token_type: 'bearer', expires_at: expires, expires_in: 3600, user }));
      localStorage.setItem('tiny-outings:onboarding-complete', 'true');
    }, { host: supabaseHost, user: adminUser });
  }
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(base).origin) return route.continue();
    if (url.pathname.startsWith('/rest/v1/')) {
      supabaseHost = url.hostname;
      let data = url.pathname === '/rest/v1/activities' ? fixture : [];
      if (url.searchParams.get('public_listing_status') === 'eq.draft') data = [{ ...fixture[0], public_listing_status: 'draft' }];
      if (url.pathname === '/rest/v1/user_table') data = { user_id: adminUser.id, display_name: 'Local design tester', user_name: 'design19tester' };
      return route.fulfill({ status: 200, json: data, headers: { 'content-range': `0-${Math.max(data.length - 1, 0)}/${data.length}` } });
    }
    if (url.pathname.startsWith('/auth/')) return route.fulfill({ status: 200, json: admin ? adminUser : { user: null, session: null } });
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => failures.push(error.message));
  return { context, page };
}
async function noOverflow(page, label) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: no horizontal overflow`);
  checks.push(`${label}: no horizontal overflow`);
}
async function screenshot(page, name) {
  await page.evaluate(() => Promise.all(document.getAnimations().filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime)).map((animation) => animation.finished.catch(() => {}))));
  await page.evaluate(() => window.scrollTo(0, 0));
  const issues = await page.evaluate(() => {
    const rgba = (value) => value.match(/[\d.]+/g)?.map(Number) || [0, 0, 0, 0];
    const blend = (fg, bg) => fg.slice(0, 3).map((v, i) => v * (fg[3] ?? 1) + bg[i] * (1 - (fg[3] ?? 1)));
    const background = (element) => {
      if (!element) return [41, 35, 48];
      const color = rgba(getComputedStyle(element).backgroundColor);
      return blend(color, (color[3] ?? 1) === 1 ? [0, 0, 0] : background(element.parentElement));
    };
    const lum = (rgb) => rgb.map((n) => n / 255).map((n) => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
    return [...document.querySelectorAll('.phone-app *')].flatMap((element) => {
      if (!element.checkVisibility() || element.closest('svg,button:disabled,.leaflet-container,.card-photo,.detail-photo') || ![...element.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return [];
      const style = getComputedStyle(element);
      const bg = background(element), fg = blend(rgba(style.color), bg);
      const ratio = (Math.max(lum(bg), lum(fg)) + .05) / (Math.min(lum(bg), lum(fg)) + .05);
      const large = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700);
      return ratio + .02 >= (large ? 3 : 4.5) ? [] : [{ element: element.className, text: element.textContent.trim().slice(0, 55), ratio: Number(ratio.toFixed(2)), color: style.color, background: bg }];
    });
  });
  contrastIssues.push(...issues.map((issue) => ({ screen: name, ...issue })));
  await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: false });
}
try {
  const { page, context } = await contextFor(390, 844);
  await page.goto(base);
  await page.getByRole('button', { name: 'Continue as guest' }).waitFor();
  await screenshot(page, '01-sign-in');
  await page.getByRole('button', { name: 'Continue as guest' }).click();
  await page.getByRole('heading', { name: 'Welcome to your London.' }).waitFor();
  assert.equal(await page.locator('.design19-tour li').count(), 3);
  await noOverflow(page, 'Welcome');
  await screenshot(page, '02-welcome');
  await page.getByRole('button', { name: 'Let’s explore' }).click();
  assert.equal(await page.evaluate(() => localStorage.getItem('tiny-outings:welcome-design19-v1')), 'true');
  await page.locator('.start-summary').waitFor();
  await screenshot(page, '03-plan');
  await noOverflow(page, 'Plan');
  const canvas = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim());
  assert.equal(await canvas(), colorScheme === 'dark' ? '#292330' : '#f3edf5');
  await page.emulateMedia({ colorScheme: colorScheme === 'dark' ? 'light' : 'dark' });
  assert.equal(await canvas(), colorScheme === 'dark' ? '#f3edf5' : '#292330');
  await page.emulateMedia({ colorScheme });
  checks.push('Theme follows device preference and changes without reloading');
  assert.equal(await page.locator('.bottom-nav button').count(), 6);
  const nav = (label) => page.getByRole('navigation', { name: 'App navigation' }).getByRole('button', { name: label, exact: true });
  await nav('Swipe').click();
  await page.locator('.swipe-card').waitFor();
  await screenshot(page, '04-swipe');
  await noOverflow(page, 'Swipe');
  const title = await page.locator('.swipe-card h2').innerText();
  await page.getByRole('button', { name: 'Details', exact: true }).click();
  await page.locator('.activity-detail-screen').waitFor();
  await screenshot(page, '05-detail');
  await noOverflow(page, 'Details');
  await page.getByRole('button', { name: /Back/ }).first().click();
  assert.equal(await page.locator('.swipe-card h2').innerText(), title);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.swipe-status-bar')?.textContent.includes('1 saved'));
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  checks.push('Details/back keeps card; save and skip update the deck');
  for (const [label, selector] of [['Week', '.calendar-screen'], ['Where', '.map-screen'], ['Add', '.app-form'], ['Profile', '.user-screen']]) {
    await nav(label).click();
    if (label !== 'Profile') await page.locator(selector).first().waitFor();
    await noOverflow(page, label);
    await screenshot(page, `06-${label.toLowerCase()}`);
  }
  const beforeReplay = await page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort()));
  await page.getByRole('button', { name: 'Show welcome screen' }).click();
  await page.getByRole('heading', { name: 'Welcome to your London.' }).waitFor();
  await page.getByRole('button', { name: 'Let’s explore' }).click();
  await page.locator('.user-screen').waitFor();
  assert.equal(await page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort())), beforeReplay);
  checks.push('Profile reopens welcome and returns without resetting saved plans');
  await page.reload();
  await page.getByRole('button', { name: 'Continue as guest' }).click();
  await nav('Plan').waitFor();
  assert.equal(await page.locator('.design19-welcome').count(), 0);
  checks.push('First welcome completion persists; guest and all six tabs work');
  await context.close();
  const { page: adminPage, context: adminContext } = await contextFor(320, 740, true);
  await adminPage.goto(base);
  await adminPage.getByRole('heading', { name: 'Welcome to your London.' }).waitFor();
  await adminPage.getByRole('button', { name: 'Let’s explore' }).click();
  checks.push('Existing signed-in user with legacy onboarding flag sees the new welcome');
  await adminPage.getByRole('navigation').getByRole('button', { name: 'Review', exact: true }).click();
  await adminPage.locator('.review-item').first().waitFor();
  assert.equal(await adminPage.locator('.bottom-nav button').count(), 7);
  await noOverflow(adminPage, 'Admin review 320px');
  await screenshot(adminPage, '08-admin-review');
  await adminPage.getByRole('navigation').getByRole('button', { name: 'Profile', exact: true }).click();
  await adminPage.getByText('Local design tester', { exact: true }).waitFor();
  await noOverflow(adminPage, 'Signed-in profile 320px');
  await screenshot(adminPage, '09-admin-profile');
  await adminPage.reload();
  await adminPage.getByRole('navigation').waitFor();
  assert.equal(await adminPage.locator('.design19-welcome').count(), 0);
  checks.push('Signed-in upgrade welcome is shown only once');
  await adminContext.close();
  for (const [width, height] of [[320, 568], [768, 1024]]) {
    const { page: sized, context: sizedContext } = await contextFor(width, height);
    await sized.goto(base);
    await sized.getByRole('button', { name: 'Continue as guest' }).click();
    await noOverflow(sized, `Welcome ${width}px`);
    await sized.getByRole('button', { name: 'Let’s explore' }).click();
    await noOverflow(sized, `Plan ${width}px`);
    await screenshot(sized, `07-plan-${width}`);
    await sizedContext.close();
  }
  assert.deepEqual(failures, [], 'No JavaScript runtime errors');
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ checks, failures, contrastIssues }, null, 2));
  assert.deepEqual(contrastIssues, [], 'Text contrast passes on sampled screens (photos and map excluded)');
  console.log(JSON.stringify({ checks, failures, contrastIssues, output }, null, 2));
} finally {
  await browser.close();
}
