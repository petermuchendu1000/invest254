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
  player: jwt({ sub: 'u-player', role: 'player', site: SITE }),
};
const ME = {
  admin: { userId: 'u-admin', role: 'admin', username: 'siteadmin', phone: '254700000001', scope: { site: { id: SITE, name: 'Tamu Traders' }, platform: null } },
  owner: { userId: 'u-owner', role: 'platform_superadmin', username: 'owner', phone: '254700000002' },
  player: { userId: 'u-player', role: 'player', username: 'punter', phone: '254700000009' },
  pa: { userId: 'u-pa', role: 'platform_admin', username: 'platadmin', phone: '254700000003', scope: { site: { id: SITE, name: 'Tamu Traders' }, platform: { id: PLATFORM, name: 'Alpha Platform' } } },
};
const USER = {
  userId: 'u-target', username: 'target', phone: '254711111111', role: 'player', status: 'active', createdAtMs: 1,
  realBalanceCents: 0, bonusBalanceCents: 0, demoBalanceCents: 0, isMarketer: false, depositsCents: 0, withdrawalsCents: 0,
  netDepositsCents: 0, lastFundedCents: null, turnoverCents: 0, ggrCents: 0, betCount: 0, lastTxAtMs: null, lastTxKind: null,
  lastTxAmountCents: null, lastTxStatus: null, lastActiveAtMs: null, referredBy: null, isBrandDefaultMarketer: false,
};

const REFERRAL = { referralCode: 'K7PQ2MX', referralPath: '/r/K7PQ2MX', isMarketer: false, totalReferrals: 0, earnedCents: 0,
  heldCents: 0, paidCents: 0, availableCents: 0, minPayoutCents: 50000, marketerEarnedCents: 0 };

// docs/42 UI-9 fixtures (owner console)
const OTHER_PLATFORM = '20000000-0000-0000-0000-000000000002';
const PLATFORMS = [
  { platformId: PLATFORM, slug: 'alpha', name: 'Alpha Platform', status: 'active', ownerUserId: null, notes: null },
  { platformId: OTHER_PLATFORM, slug: 'beta', name: 'Beta Platform', status: 'active', ownerUserId: null, notes: null },
];
const SITE_ROW = {
  siteId: SITE, slug: 'tamu', name: 'Tamu Traders', status: 'active', primaryDomain: 'tamu.test', logoUrl: null, faviconUrl: null,
  wordmarkText: 'Tamu', colorPrimary: '#3861FB', colorBg: '#0a0a0a', colorAccent: '#06b6d4', theme: 'dark', currency: 'KES', locale: 'en-KE',
  chartStyle: 'classic', tradeUi: 'classic', licenceLine: null, supportEmail: null, legalCopy: null, ownerUserId: null,
  config: { houseEdge: 0.05, maxMultiplier: 5, minStakeCents: 100, maxStakeCents: 100000, minWithdrawalCents: 1000, defaultDurationS: 10,
    tickRateMs: 150, driftBias: 0.3, volatility: 1, targetWinRate: 0.4, version: 1 },
};
const TICKET = { id: 't-1', platformId: PLATFORM, siteId: SITE, createdBy: 'u-admin', createdByRole: 'admin', subject: 'Payouts stuck',
  body: 'B2C failing', urgency: 'high', status: 'open', escalationLevel: 0, assigneeRole: 'platform_admin', slaDueAtMs: Date.now() + 3600e3,
  firstResponseAtMs: null, resolvedAtMs: null, resolvedBy: null, closedAtMs: null, createdAtMs: 1, updatedAtMs: 1 };
const ADDONS = [
  { category: 'chart', key: 'classic', display_name: 'Classic chart', price_cents: 0, is_default: true, entitled: true, active: true, pending: false },
  { category: 'chart', key: 'pro', display_name: 'Pro chart', price_cents: 500000, is_default: false, entitled: false, active: false, pending: false },
  { category: 'trade_ui', key: 'deriv', display_name: 'Deriv UI', price_cents: 0, is_default: false, entitled: true, active: false, pending: false },
];
const FIXTURES = {
  '/platform/platforms': { platforms: PLATFORMS },
  '/platform/sites': { sites: [SITE_ROW] },
  '/platform/platform-admins': { admins: [{ userId: 'u-alice', username: 'alice', phone: '254711000001', status: 'active', platformId: PLATFORM,
    platformName: 'Alpha Platform', homeSiteId: SITE, homeSiteName: 'Tamu Traders', createdAtMs: 1 }] },
  '/platform/users/search': { users: [
    { userId: 'u-bob', username: 'bobkamau', phone: '254722333444', role: 'admin', status: 'active', siteId: SITE, siteName: 'Tamu Traders', platformId: PLATFORM, platformName: 'Alpha Platform', isDefaultMarketer: false },
    { userId: 'u-dm', username: 'bobdefault', phone: '254722333555', role: 'marketer', status: 'active', siteId: SITE, siteName: 'Tamu Traders', platformId: PLATFORM, platformName: 'Alpha Platform', isDefaultMarketer: true },
  ] },
  '/tickets': { tickets: [TICKET] },
  '/tickets/t-1': { ticket: TICKET, comments: [], escalations: [] },
  '/addons/brand': { items: ADDONS },
  [`/platform/sites/${SITE}/users`]: { items: [USER] },
  [`/platform/sites/${SITE}/users/u-target`]: { ...USER, realBalanceCents: 50000, bonusBalanceCents: 2000, depositsCents: 100000, turnoverCents: 300000, betCount: 12, createdAtMs: 1 },
  [`/platform/sites/${SITE}/users/u-target/overrides`]: { userId: 'u-target', winRate: null, houseEdge: null, tradeDurationS: null, maxWinMultiplier: null,
    minStakeCents: null, maxStakeCents: null, notes: null, updatedBy: null, updatedAtMs: null },
  '/platform/audit-log': { items: [{ id: '9', actorId: 'u-admin', actorRole: 'admin', actorUsername: 'siteadmin', action: 'user.set_status',
    targetType: 'user', targetId: 'u-target', detail: { status: 'suspended' }, createdAtMs: Date.now() - 60000, siteId: SITE, siteName: 'Tamu Traders' }], nextCursor: null },
  '/platform/registrar/config': { platformId: PLATFORM, providerCode: 'namecheap', settings: {}, secretMeta: {}, hasSecret: false, encVersion: 1,
    updatedAt: null, exists: false, egressIp: '203.0.113.7', encryptionConfigured: true },
};

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${!ok && detail ? `  -- ${detail}` : ''}`); };

async function session(browser, { token, me, stash = null }) {
  const ctx = await browser.newContext();
  const calls = [];
  const full = [];   // method + path + query (UI-9: which platform a request acts for)
  const bodies = []; // [method path, parsed JSON body] of writes (UI-10: what a confirm actually sent)
  await ctx.route(`${API}/**`, async (route) => {
    const req = route.request();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const u = new URL(req.url());
    const path = u.pathname.replace('/api/v1', '');
    calls.push(`${req.method()} ${path}`);
    full.push(`${req.method()} ${path}${u.search}`);
    if (req.method() !== 'GET') { let b = null; try { b = req.postDataJSON(); } catch { /* none */ } bodies.push([`${req.method()} ${path}`, b]); }
    const body = path === '/auth/me' ? me
      : path === '/me/referral' ? REFERRAL
      : FIXTURES[path] ? FIXTURES[path]
      : /^\/admin\/users\/[^/]+$/.test(path) ? USER
      : { items: [], sites: [], platforms: [], statuses: {}, configured: false, key: null, enabled: true };
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  });
  await ctx.addInitScript(([tok, st]) => {
    localStorage.setItem('pp-session', JSON.stringify({ state: { token: tok }, version: 0 }));
    if (st) sessionStorage.setItem('pp-impersonating-brand', st);
  }, [token, stash]);
  const page = await ctx.newPage();
  return { ctx, page, calls, full, bodies };
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
    check('site admin: old /admin/audit forwards to the console, which reveals nothing (404)', page.url().endsWith('/platform/audit') && await page.getByText('This page could not be found.').isVisible(), page.url());
    check('site admin: no audit request was ever made', !calls.includes('GET /admin/audit'), calls.filter((c) => c.includes('audit')).join());
    await open(page, '/admin/game');
    check('site admin: old /admin/game forwards to the console (404 for a site admin)', await page.getByText('This page could not be found.').isVisible(), page.url());
    await open(page, '/admin/users/u-target');
    check('site admin: "Edit details" and "Role" sections visible', await page.getByText('Edit details', { exact: true }).isVisible().catch(() => false) && await page.getByText('Role', { exact: true }).first().isVisible().catch(() => false));
    check('site admin: overrides are read-only (no Save overrides)', !(await page.getByText('Save overrides').isVisible().catch(() => false)));
    await open(page, '/platform');
    check('site admin: /platform is a 404', await page.getByText('This page could not be found.').isVisible());
    await ctx.close(); }

  // 2) Owner, own session
  { const { ctx, page, calls } = await session(browser, { token: T.owner, me: ME.owner });
    await open(page, '/admin/tickets');
    check('owner (own session): /admin shows the brand picker, not an unscoped back office (UI-2)', await page.getByText('Choose a brand to open').isVisible());
    check('owner: no back-office data request was made without a brand', !calls.some((c) => /^GET \/(admin|tickets)/.test(c)), calls.join());
    await open(page, '/platform'); const pnav = await navTexts(page);
    check('owner console: system nav incl. moved governance (Audit log, System logs, M-Pesa, Engine)', ['Platforms', 'Payments', 'Global config', 'Audit log', 'System logs', 'M-Pesa (global)', 'Engine (Fly.io)'].every((x) => pnav.some((n) => n.includes(x))), pnav.join('|'));
    await open(page, '/admin/mpesa');
    check('owner: old /admin/mpesa forwards to /platform/mpesa', page.url().endsWith('/platform/mpesa'), page.url());
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
    check('platform admin console: NO system nav', !pnav.some((n) => /Platforms|Payments|Global config|Add-ons|Audit log|System logs|M-Pesa|Engine/.test(n)), pnav.join('|'));
    await open(page, '/platform/audit');
    check('platform admin: /platform/audit is a 404', await page.getByText('This page could not be found.').isVisible());
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

  // 7) docs/42 UI-12: operators are never affiliates — no enrolment, no referral code, no requests
  for (const [who, token, me] of [['site admin', T.admin, ME.admin], ['owner', T.owner, ME.owner],
    ['platform admin', T.pa, ME.pa], ['owner impersonating', T.ownerImp, ME.owner]]) {
    const { ctx, page, calls } = await session(browser, { token, me });
    await open(page, '/affiliate');
    check(`${who}: /affiliate explains staff accounts can't join (UI-12)`, await page.getByText('Not available for staff accounts').isVisible());
    check(`${who}: /affiliate offers no "Apply to the programme"`, !(await page.getByText('Apply to the programme').isVisible().catch(() => false)));
    await open(page, '/account');
    check(`${who}: /account shows no referral invite card`, !(await page.getByText(/Invite & earn/).isVisible().catch(() => false)));
    check(`${who}: no affiliate/referral request was made`, !calls.some((c) => /\/(me\/referral|affiliate)/.test(c)), calls.join());
    await ctx.close();
  }
  { const { ctx, page } = await session(browser, { token: T.player, me: ME.player });
    await open(page, '/account');
    check('player: /account keeps the referral invite card', await page.getByText(/Invite & earn/).isVisible());
    await open(page, '/affiliate');
    check('player: /affiliate offers "Apply to the programme"', await page.getByText('Apply to the programme').isVisible());
    await ctx.close(); }

  // 8) docs/42 UI-9: owner console gaps
  { const { ctx, page, calls, full } = await session(browser, { token: T.owner, me: ME.owner });
    await open(page, '/platform/tickets');
    await page.getByRole('button', { name: 'New ticket' }).click();
    check("owner: new ticket asks WHICH platform and says it goes to that platform's admin", await page.getByLabel('Platform').isVisible() && await page.getByText("Assigned to the chosen platform's admin").isVisible());
    check('owner: new ticket never claims "your platform admin"', !(await page.getByText('Assigned to your platform admin').isVisible().catch(() => false)));
    await page.keyboard.press('Escape');
    await page.getByText('Payouts stuck').first().click(); await page.waitForTimeout(400);
    check('owner: a ticket offers no "Escalate to System" (it would only reassign it to the owner)', !(await page.getByRole('button', { name: 'Escalate to System' }).isVisible().catch(() => false)));
    await page.keyboard.press('Escape');

    await open(page, '/platform/platforms');
    await page.getByRole('button', { name: 'Platform admins' }).click(); await page.waitForTimeout(300);
    check('owner: platform admins are listed by person (name + platform), not a count', await page.getByText('@alice').isVisible() && await page.getByText(/runs\s+Alpha Platform/).first().isVisible());
    check('owner: no raw "User id" field anywhere', (await page.getByLabel('User id').count()) === 0);
    await page.getByLabel('Find a person').fill('bob'); await page.waitForTimeout(900);
    check('owner: appoint searches people across brands', await page.getByText('@bobkamau').isVisible());
    check("owner: an ineligible person is shown with the reason (default marketer)", await page.getByText(/default marketer — reassign/).isVisible());
    check('owner: the search called the directory route', calls.some((c) => c.startsWith('GET /platform/users/search')), calls.join());

    const poolStart = full.length;
    await open(page, '/platform/pool');
    check('owner: /platform/pool asks which platform (was: every brand, "your brands")', await page.getByLabel('Pool for platform').isVisible() && !(await page.getByText("Set each of your brands").isVisible().catch(() => false)));
    // the page's own data requests (the shell may list all brands for navigation; that is not the pool)
    const poolCalls = full.slice(poolStart).filter((c) => c.startsWith('GET /platform/pool/'));
    check('owner: /platform/pool requests carry the chosen platform (?platform=)', poolCalls.length > 0 && poolCalls.every((c) => c.includes(`platform=${PLATFORM}`)), poolCalls.join());
    await page.getByLabel('Pool for platform').selectOption(OTHER_PLATFORM); await page.waitForTimeout(600);
    check('owner: switching platform re-scopes the pool requests', full.some((c) => c.startsWith('GET /platform/pool/distributions') && c.includes(`platform=${OTHER_PLATFORM}`)), full.filter((c) => c.includes('pool')).join());
    await open(page, '/platform/registrar');
    check('owner: registrar page asks which platform', await page.getByLabel('Registrar for platform').isVisible());
    await open(page, '/platform/onboard');
    check('owner: onboarding asks which platform up-front', await page.getByLabel('Onboard into platform').isVisible());
    await open(page, `/platform/clients/${SITE}`);
    check('owner: a brand page can ASSIGN a locked add-on (was: request only)', await page.getByRole('button', { name: 'Assign…' }).first().isVisible());
    check('owner: a brand page can REMOVE an owned non-default add-on', await page.getByRole('button', { name: 'Remove…' }).first().isVisible());
    await page.getByRole('button', { name: 'Assign…' }).first().click();
    check('owner: assigning states the effect on players and the price first', await page.getByText(/becomes this brand's ACTIVE chart for every player now\. It is billed at KES 5,000/).isVisible());
    await ctx.close(); }
  { const { ctx, page, calls } = await session(browser, { token: T.pa, me: ME.pa });
    await open(page, '/platform/pool');
    check('platform admin: /platform/pool has no platform picker (pinned to its own)', (await page.getByLabel('Pool for platform').count()) === 0);
    check('platform admin: no owner-only platforms list was requested', !calls.includes('GET /platform/platforms'), calls.join());
    await open(page, '/platform/tickets');
    await page.getByRole('button', { name: 'New ticket' }).click();
    check('platform admin: new ticket says it goes straight to the System admin', await page.getByText('Goes straight to the System admin.').isVisible());
    await page.keyboard.press('Escape');
    await open(page, `/platform/clients/${SITE}`);
    check('platform admin: a brand page offers Request, never Assign', (await page.getByRole('button', { name: 'Assign…' }).count()) === 0 && await page.getByRole('button', { name: /Request Pro chart/ }).isVisible());
    await ctx.close(); }
  { const { ctx, page } = await session(browser, { token: T.admin, me: ME.admin });
    await open(page, '/admin/tickets');
    await page.getByRole('button', { name: 'New ticket' }).click();
    check('site admin: new ticket goes to its platform admin (unchanged)', await page.getByText('Assigned to your platform admin').isVisible());
    await page.keyboard.press('Escape');
    await page.getByText('Payouts stuck').first().click(); await page.waitForTimeout(400);
    check('site admin: can still escalate to System', await page.getByRole('button', { name: 'Escalate to System' }).isVisible());
    await ctx.close(); }

  // 9) docs/42 UI-10: platform-admin player management + one audit trail
  { const { ctx, page, calls, bodies } = await session(browser, { token: T.pa, me: ME.pa });
    await open(page, `/platform/clients/${SITE}`);
    await page.getByRole('button', { name: 'Players' }).click(); await page.waitForTimeout(300);
    await page.getByText('@target').first().click(); await page.waitForTimeout(500);
    check('platform admin: selecting a player shows their money + activity (detail)', await page.getByText('Bonus balance').isVisible() && await page.getByText('KES 20').first().isVisible());
    await page.getByLabel('Wallet').selectOption('bonus');
    await page.getByLabel('Amount (KES)').fill('100');
    await page.getByLabel('Reason').fill('goodwill');
    await page.getByRole('button', { name: 'Review adjustment' }).click();
    check('platform admin: the confirm names the wallet and shows before -> after', await page.getByText(/bonus \(non-withdrawable\) balance/).isVisible() && await page.getByText('KES 120').isVisible());
    await page.getByRole('button', { name: 'Confirm adjustment' }).click(); await page.waitForTimeout(400);
    const adj = bodies.find(([k]) => k === 'POST /platform/sites/' + SITE + '/users/u-target/balance');
    check('platform admin: the adjustment is sent for the BONUS wallet (was: never sent, always real cash)', adj && adj[1]?.kind === 'bonus' && adj[1]?.amountCents === 10000, JSON.stringify(adj));
    await page.getByText('Game overrides for this player').click(); await page.waitForTimeout(400);
    check('platform admin: player overrides are editable in the console (was: no UI)', await page.getByLabel('Win rate (0–1)').isVisible());
    await page.getByLabel('Win rate (0–1)').fill('0.9');
    check("platform admin: an override better than the brand is stopped before saving", await page.getByText(/at most the brand's 0.4/).isVisible() && await page.getByRole('button', { name: 'Save overrides' }).isDisabled());
    await page.getByLabel('Win rate (0–1)').fill('0.3');
    await page.getByRole('button', { name: 'Save overrides' }).click(); await page.waitForTimeout(400);
    const ov = bodies.find(([k]) => k === 'PATCH /platform/sites/' + SITE + '/users/u-target/overrides');
    check('platform admin: a valid override is saved', ov && ov[1]?.winRate === 0.3, JSON.stringify(ov));
    await open(page, '/platform'); const nav = await navTexts(page);
    check('platform admin: nav has ONE audit trail across its brands (Brand audit)', nav.some((n) => n.includes('Brand audit')), nav.join('|'));
    await open(page, '/platform/activity');
    check('platform admin: the audit trail names the brand and the person', await page.getByText('@siteadmin').isVisible() && await page.getByRole('cell', { name: 'Tamu Traders' }).first().isVisible());
    check('platform admin: the audit trail uses the platform-scoped route', calls.includes('GET /platform/audit-log'), calls.filter((c) => c.includes('audit')).join());
    await ctx.close(); }
  { const { ctx, page } = await session(browser, { token: T.owner, me: ME.owner });
    await open(page, '/platform'); const nav = await navTexts(page);
    check('owner: nav keeps the global Audit log and no duplicate Brand audit', nav.some((n) => n.includes('Audit log')) && !nav.some((n) => n.includes('Brand audit')), nav.join('|'));
    await ctx.close(); }
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
