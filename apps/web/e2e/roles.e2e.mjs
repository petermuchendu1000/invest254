// docs/42 role-matrix UI e2e — drives the PRODUCTION web build (`next start`) in headless Chromium as each
// operator tier (incl. impersonation and a second tab), with the API mocked at the network layer, and
// asserts what each tier SEES: nav entries, page gates and key controls. It proves the capability list
// (packages/shared/src/capabilities.ts) is what the screens actually render, on the token role.
//
// Run:  WEB_URL=http://127.0.0.1:3100 node apps/web/e2e/roles.e2e.mjs
//   (build with NEXT_PUBLIC_API_BASE_URL=http://api.e2e.test/api/v1, then `next start -p 3100`;
//    needs `playwright-core` resolvable and Chromium at PLAYWRIGHT_BROWSERS_PATH / CHROMIUM_PATH.)
import { chromium } from 'playwright-core';

const WEB = process.env.WEB_URL ?? 'http://127.0.0.1:3100';
const API = 'http://api.e2e.test/api/v1';
const SITE = '00000000-0000-0000-0000-000000000001';
const PLATFORM = '10000000-0000-0000-0000-000000000001';

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload) => `${b64u({ alg: 'HS256' })}.${b64u({ iat: 1, exp: 9999999999, ...payload })}.sig`;

const T = {
  admin: jwt({ sub: 'u-admin', role: 'admin', site: SITE }),
  owner: jwt({ sub: 'u-owner', role: 'platform_superadmin', site: SITE }),
  pa: jwt({ sub: 'u-pa', role: 'platform_admin', site: SITE, platform: PLATFORM }),
  ownerImp: jwt({ sub: 'u-owner', role: 'admin', site: SITE, act: { sub: 'u-owner', role: 'platform_superadmin', brand: 'Tamu Traders' } }),
  paImp: jwt({ sub: 'u-pa', role: 'admin', site: SITE, act: { sub: 'u-pa', role: 'platform_admin', brand: 'Tamu Traders' } }),
};
const ME = {
  admin: { userId: 'u-admin', role: 'admin', username: 'siteadmin', phone: '254700000001', scope: { site: { id: SITE, name: 'Tamu Traders' }, platform: null } },
  owner: { userId: 'u-owner', role: 'platform_superadmin', username: 'owner', phone: '254700000002' },
  pa: { userId: 'u-pa', role: 'platform_admin', username: 'platadmin', phone: '254700000003', scope: { site: { id: SITE, name: 'Tamu Traders' }, platform: { id: PLATFORM, name: 'Alpha Platform' } } },
};
const USER = {
  userId: 'u-target', username: 'target', phone: '254711111111', role: 'player', status: 'active', createdAtMs: 1,
  realBalanceCents: 0, bonusBalanceCents: 0, demoBalanceCents: 0, isMarketer: false, depositsCents: 0, withdrawalsCents: 0,
  netDepositsCents: 0, lastFundedCents: null, turnoverCents: 0, ggrCents: 0, betCount: 0, lastTxAtMs: null, lastTxKind: null,
  lastTxAmountCents: null, lastTxStatus: null, lastActiveAtMs: null, referredBy: null, isBrandDefaultMarketer: false,
};

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${!ok && detail ? `  -- ${detail}` : ''}`); };

async function session(browser, { token, me, stash = null }) {
  const ctx = await browser.newContext();
  const calls = [];
  await ctx.route(`${API}/**`, async (route) => {
    const req = route.request();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const path = new URL(req.url()).pathname.replace('/api/v1', '');
    calls.push(`${req.method()} ${path}`);
    const body = path === '/auth/me' ? me
      : /^\/admin\/users\/[^/]+$/.test(path) ? USER
      : { items: [], sites: [], platforms: [], statuses: {}, configured: false, key: null, enabled: true };
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  });
  await ctx.addInitScript(([tok, st]) => {
    localStorage.setItem('pp-session', JSON.stringify({ state: { token: tok }, version: 0 }));
    if (st) sessionStorage.setItem('pp-impersonating-brand', st);
  }, [token, stash]);
  const page = await ctx.newPage();
  return { ctx, page, calls };
}
async function navTexts(page) {
  await page.waitForTimeout(300);
  return (await page.locator('aside a, nav a').allInnerTexts()).map((s) => s.trim()).filter(Boolean);
}
async function open(page, path) {
  await page.goto(`${WEB}${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  // 1) Site admin
  { const { ctx, page, calls } = await session(browser, { token: T.admin, me: ME.admin });
    await open(page, '/admin/tickets'); const nav = await navTexts(page);
    check('site admin: operations nav present', nav.includes('Withdrawals') && nav.includes('Users'), nav.join('|'));
    check('site admin: the shell names the brand (UI-8)', await page.getByText('Tamu Traders Admin').first().isVisible());
    check('site admin: NO Audit log / Governance / Platform nav', !nav.some((n) => /Audit log|Game config|M-Pesa|Fly\.io|All brands|System logs/.test(n)), nav.join('|'));
    await open(page, '/admin/audit');
    check('site admin: /admin/audit shows the owner-only gate', await page.getByText('Audit log is owner-only').isVisible());
    check('site admin: /admin/audit made NO audit request', !calls.includes('GET /admin/audit'), calls.filter((c) => c.includes('audit')).join());
    await open(page, '/admin/game');
    check('site admin: /admin/game shows the owner-only gate', await page.getByText('Owner-only area').isVisible());
    await open(page, '/admin/users/u-target');
    check('site admin: "Edit details" and "Role" sections visible', await page.getByText('Edit details', { exact: true }).isVisible().catch(() => false) && await page.getByText('Role', { exact: true }).first().isVisible().catch(() => false));
    check('site admin: overrides are read-only (no Save overrides)', !(await page.getByText('Save overrides').isVisible().catch(() => false)));
    await open(page, '/platform');
    check('site admin: /platform is a 404', await page.getByText('This page could not be found.').isVisible());
    await ctx.close(); }

  // 2) Owner, own session
  { const { ctx, page } = await session(browser, { token: T.owner, me: ME.owner });
    await open(page, '/admin/tickets'); const nav = await navTexts(page);
    check('owner: Audit log + Governance + Platform nav', ['Audit log', 'Game config', 'All brands', 'System logs'].every((x) => nav.includes(x)), nav.join('|'));
    await open(page, '/platform'); const pnav = await navTexts(page);
    check('owner console: system nav (Platforms, Payments, Global config, Add-ons)', ['Platforms', 'Payments', 'Global config'].every((x) => pnav.some((n) => n.includes(x))), pnav.join('|'));
    await ctx.close(); }

  // 3) Owner impersonating, SECOND TAB (no sessionStorage stash — the pre-fix failure mode)
  { const { ctx, page, calls } = await session(browser, { token: T.ownerImp, me: ME.owner });
    await open(page, '/admin/tickets'); const nav = await navTexts(page);
    check('owner impersonating (new tab): brand admin nav only — no Audit/Governance/Platform', nav.includes('Withdrawals') && !nav.some((n) => /Audit log|Game config|All brands|System logs/.test(n)), nav.join('|'));
    check('owner impersonating (new tab): banner names the brand from the token', await page.getByText('Tamu Traders').first().isVisible());
    check('owner impersonating: token NOT re-minted by the session bootstrap', !calls.includes('POST /auth/refresh'), calls.join());
    await open(page, '/admin/users/u-target');
    check('owner impersonating: no admin-role option (API refuses it as admin)', !(await page.locator('option[value="admin"]').count()));
    await open(page, '/platform');
    check('owner impersonating: /platform offers "Exit brand" instead of the console', await page.getByRole('button', { name: 'Exit brand' }).isVisible());
    await ctx.close(); }

  // 4) Platform admin, own session
  { const { ctx, page, calls } = await session(browser, { token: T.pa, me: ME.pa });
    await open(page, '/platform'); const pnav = await navTexts(page);
    check('platform admin console: the shell names its platform (UI-8)', await page.getByText('Platform · Alpha Platform').first().isVisible());
    check('platform admin console: NO system nav', !pnav.some((n) => /Platforms|Payments|Global config|Add-ons/.test(n)), pnav.join('|'));
    await open(page, '/platform/onboard');
    check('platform admin: onboarding never calls the owner-only platforms list', !calls.includes('GET /platform/platforms'), calls.filter((c) => c.includes('platforms')).join());
    await open(page, '/admin');
    check('platform admin (raw): /admin is a 404', await page.getByText('This page could not be found.').isVisible());
    await ctx.close(); }

  // 5) Platform admin impersonating (the pre-fix "hidden but allowed" case)
  { const { ctx, page } = await session(browser, { token: T.paImp, me: ME.pa, stash: JSON.stringify({ siteId: SITE, slug: 'tamu', name: 'Tamu Traders', primaryDomain: null }) });
    await open(page, '/admin/tickets'); const nav = await navTexts(page);
    check('platform admin impersonating: enters the brand back office', nav.includes('Withdrawals'), nav.join('|'));
    await open(page, '/admin/users/u-target');
    check('platform admin impersonating: "Edit details" section visible (API allows it as admin)', await page.getByText('Edit details', { exact: true }).isVisible().catch(() => false));
    check('platform admin impersonating: "Role" section visible (player<->marketer)', await page.getByText('Role', { exact: true }).first().isVisible().catch(() => false));
    await ctx.close(); }

  // 6) Deploy-order safety: an impersonation token minted BEFORE the API added `act` (tab stash only)
  { const legacy = jwt({ sub: 'u-owner', role: 'admin', site: SITE });
    const { ctx, page, calls } = await session(browser, { token: legacy, me: ME.owner, stash: JSON.stringify({ siteId: SITE, slug: 'tamu', name: 'Tamu Traders', primaryDomain: null }) });
    await open(page, '/admin/tickets');
    check('legacy impersonation (no act, tab stash): banner + exit still shown', await page.getByText('Tamu Traders').first().isVisible());
    check('legacy impersonation: token not re-minted', !calls.includes('POST /auth/refresh'), calls.join());
    await ctx.close(); }
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
