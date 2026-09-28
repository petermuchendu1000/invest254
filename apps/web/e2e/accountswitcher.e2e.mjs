/**
 * DEMO-3 e2e — the Real/Demo account switcher on a PHONE, against the production web build with the
 * API mocked at the network layer (the roles.e2e.mjs pattern: no API, engine or Postgres needed).
 *
 * It exists because the switcher's first version passed review by inspection and still shipped a
 * menu that was full-bleed on a phone and read as a slab dropped over the trade screen. These checks
 * are the ones inspection cannot make: that a TAP (not a click) on the Demo row actually reaches the
 * server, that the card lands inside the viewport anchored to its trigger, that every target clears
 * Apple's 44px minimum, that an outside tap dismisses, and that the Demo account offers no way out.
 *
 * Run:  build with NEXT_PUBLIC_API_BASE_URL=http://api.e2e.test/api/v1, `next start -p 3100`, then
 *       WEB_URL=http://127.0.0.1:3100 node apps/web/e2e/accountswitcher.e2e.mjs
 *       (PROBE_PATH=/ drives the trade screen; the default /wallet drives the standard shell.)
 */
import { chromium } from 'playwright-core';

const WEB = process.env.WEB_URL ?? 'http://127.0.0.1:3100';
const API = 'http://api.e2e.test/api/v1';
const SITE = '00000000-0000-0000-0000-000000000001';
const OUT = process.env.OUT ?? '/tmp/claude-0/-home-user/452c9309-f7cb-51b6-8e0c-13816b147fab/scratchpad';

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (p) => `${b64u({ alg: 'HS256' })}.${b64u({ iat: 1, exp: 9999999999, ...p })}.sig`;
const TOKEN = jwt({ sub: 'u-player', role: 'player', site: SITE });

const ME = { userId: 'u-player', role: 'player', username: 'punter', phone: '254700000009' };
const wallet = (mode) => ({
  real: mode === 'demo' ? 1_000_000 : 523_400, bonus: mode === 'demo' ? 0 : 20_000, currency: 'KES',
  mode, modeLocked: false, realBalance: 523_400, bonusBalance: 20_000, demoBalance: 1_000_000, bonuses: [],
});

const results = [];
const check = (n, ok, d = '') => { results.push({ n, ok }); console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ` -- ${d}` : ''}`); };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });

async function session({ width = 390, height = 844, mode = 'real', touch = true } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height }, colorScheme: 'dark',
    hasTouch: touch, isMobile: touch, deviceScaleFactor: 3,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const calls = [];
  let cur = mode;
  await ctx.route(`${API}/**`, async (route) => {
    const req = route.request();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const path = new URL(req.url()).pathname.replace('/api/v1', '');
    calls.push(`${req.method()} ${path}`);
    let body;
    if (path === '/auth/me') body = ME;
    else if (path === '/wallet') body = wallet(cur);
    else if (path === '/wallet/mode') { let b = {}; try { b = req.postDataJSON(); } catch {} cur = b.mode ?? cur; body = { mode: cur, wallet: wallet(cur) }; }
    else if (path === '/wallet/demo/topup') body = { wallet: wallet(cur), demoBalance: 1_000_000 };
    else if (path === '/game/config') body = { currency: 'KES', minStakeCents: 25_000, maxStakeCents: 1_000_000, minWithdrawalCents: 200_000, minWithdrawalNative: null };
    else if (path === '/me/referral') body = { referralCode: 'X', referralPath: '/r/X', isMarketer: false, totalReferrals: 0, earnedCents: 0, heldCents: 0, paidCents: 0, availableCents: 0, minPayoutCents: 50000, marketerEarnedCents: 0 };
    else body = { items: [], providers: [], methods: [], enabled: true };
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  });
  await ctx.addInitScript((t) => localStorage.setItem('pp-session', JSON.stringify({ state: { token: t }, version: 0 })), TOKEN);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page, calls, errors };
}

const SHOTS = process.env.SHOTS !== '0';
const shot = (page, name) => (SHOTS ? page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false }) : Promise.resolve());

try {
  // ── 1. PHONE, real mode: open the account menu and tap Demo ──
  {
    const { ctx, page, calls, errors } = await session({ mode: 'real' });
    await page.goto(`${WEB}${process.env.PROBE_PATH ?? '/wallet'}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await shot(page, 'phone-1-closed');

    const pill = page.locator('#balance-pill');
    check('phone: the account pill renders', (await pill.count()) === 1, `count=${await pill.count()}`);
    const box = await pill.boundingBox();
    check('phone: the pill meets the 44px Apple touch target', !!box && box.height >= 44, box ? `h=${box.height}` : 'no box');

    await pill.tap();
    await page.waitForTimeout(500);
    await shot(page, 'phone-2-open');

    const dialog = page.getByRole('dialog', { name: 'Switch account' });
    check('phone: the switcher opens', (await dialog.count()) === 1);
    if (await dialog.count()) {
      const db = await dialog.boundingBox();
      console.log('    dialog box:', JSON.stringify(db));
      check('phone: the switcher is inside the viewport', !!db && db.y >= 0 && db.y + db.height <= 844 && db.x >= 0 && db.x + db.width <= 390,
        db ? `y=${db.y} h=${db.height} x=${db.x} w=${db.width}` : 'no box');
    }

    const demoRow = page.getByRole('menuitemradio', { name: /Demo account/ });
    check('phone: the Demo row exists', (await demoRow.count()) === 1);
    if (await demoRow.count()) {
      const rb = await demoRow.boundingBox();
      check('phone: the Demo row meets the 44px touch target', !!rb && rb.height >= 44, rb ? `h=${rb.height}` : 'no box');
      // what is actually on top at the row's centre? (a cover would eat the tap)
      if (rb) {
        const hit = await page.evaluate(([x, y]) => {
          const el = document.elementFromPoint(x, y);
          return el ? `${el.tagName}.${el.className}`.slice(0, 120) : 'none';
        }, [rb.x + rb.width / 2, rb.y + rb.height / 2]);
        console.log('    element at the Demo row centre:', hit);
      }
      await demoRow.tap();
      await page.waitForTimeout(900);
      const fired = calls.filter((c) => c === 'POST /wallet/mode');
      check('phone: tapping Demo fires POST /wallet/mode', fired.length === 1, `calls=${JSON.stringify(calls.filter((c) => c.includes('wallet')))}`);
      await shot(page, 'phone-3-after-demo');
      const label = await pill.getAttribute('aria-label');
      check('phone: the pill now reads Demo', /^Demo account/.test(label ?? ''), String(label));
    }
    // outside tap must dismiss immediately (pointerdown, not the delayed synthetic mousedown)
    await page.locator('#balance-pill').tap();
    await page.waitForTimeout(300);
    await page.tap('body', { position: { x: 195, y: 700 } });
    await page.waitForTimeout(250);
    check('phone: an outside tap dismisses the menu', (await page.getByRole('dialog', { name: 'Switch account' }).count()) === 0);
    check('phone: no page errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ── 2. PHONE, demo mode: no withdrawal affordance anywhere ──
  {
    const { ctx, page, errors } = await session({ mode: 'demo' });
    await page.goto(`${WEB}${process.env.PROBE_PATH ?? '/wallet'}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await shot(page, 'phone-4-demo-wallet');
    const bodyText = (await page.locator('body').innerText()).toLowerCase();
    check('demo: the /wallet page offers no Withdraw button', !(await page.getByRole('button', { name: /^withdraw$/i }).count()));
    console.log('    /wallet text mentions "withdraw":', bodyText.includes('withdraw'));

    await page.locator('#balance-pill').tap();
    await page.waitForTimeout(400);
    await shot(page, 'phone-5-demo-switcher');
    check('demo: the switcher offers no Withdraw', !(await page.getByRole('button', { name: /^withdraw$/i }).count()));
    check('demo: no page errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ── 3. DESKTOP, for comparison ──
  {
    const { ctx, page } = await session({ width: 1440, height: 900, touch: false });
    await page.goto(`${WEB}${process.env.PROBE_PATH ?? '/wallet'}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    await page.locator('#balance-pill').click();
    await page.waitForTimeout(400);
    await shot(page, 'desktop-1-open');
    await ctx.close();
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
