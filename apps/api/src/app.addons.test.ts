import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestApi, TEST_ADMIN, SITE_A, PLATFORM_A, type TestApi } from "./testutil.js";

/**
 * Issue 2 — add-on API surface: reads/requests open to operators (admin+), and price/decide/grant/
 * revoke SYSTEM-owner-only. Plus the chart/UI assignment guard on the platform site-patch. Real
 * catalog/entitlement/scope logic is proven at the DB layer by e2e_addon_entitlements.py.
 * Token scheme: <userId>:<role>:<siteId>:<platformId>.
 */
const json = (r: Response): Promise<any> => r.json() as Promise<any>;
function reqf(api: TestApi, method: string, path: string, token: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  const init: RequestInit = { method, headers };
  if (body !== undefined) { headers["content-type"] = "application/json"; init.body = JSON.stringify(body); }
  return fetch(`${api.baseUrl}${path}`, init);
}
const SITE_ADMIN = `${TEST_ADMIN}:admin:${SITE_A}`;
const PA         = `${TEST_ADMIN}:platform_admin:${SITE_A}:plat-1`;
const SYS        = `${TEST_ADMIN}:platform_superadmin`;
const PLAYER     = `${TEST_ADMIN}:player:${SITE_A}`;

test("addons API: reads/requests are admin+, writes are system-only, chart assignment is guarded", async () => {
  const api = await startTestApi();
  try {
    // Catalog: any operator; player denied.
    assert.equal((await reqf(api, "GET", "/api/v1/addons/catalog", SITE_ADMIN)).status, 200, "site admin reads catalog");
    assert.equal((await reqf(api, "GET", "/api/v1/addons/catalog", PA)).status, 200, "platform admin reads catalog");
    assert.equal((await reqf(api, "GET", "/api/v1/addons/catalog", PLAYER)).status, 403, "player denied catalog");
    assert.ok((await json(await reqf(api, "GET", "/api/v1/addons/catalog", SITE_ADMIN))).items.length > 0, "catalog has items");

    // Brand view: site admin uses its own site claim; player denied.
    assert.equal((await reqf(api, "GET", "/api/v1/addons/brand", SITE_ADMIN)).status, 200, "site admin brand view");
    assert.equal((await reqf(api, "GET", "/api/v1/addons/brand", PLAYER)).status, 403, "player denied brand view");

    // Request: operator may request; player denied.
    assert.equal((await reqf(api, "POST", "/api/v1/addons/request", SITE_ADMIN, { category: "chart", key: "candlestick" })).status, 200, "site admin requests");
    assert.equal((await reqf(api, "POST", "/api/v1/addons/request", PLAYER, { category: "chart", key: "candlestick" })).status, 403, "player denied request");

    // Price: system only.
    assert.equal((await reqf(api, "PUT", "/api/v1/addons/price", SYS, { category: "payment_gateway", key: "paystack", priceCents: 1200000 })).status, 200, "system sets price");
    assert.equal((await reqf(api, "PUT", "/api/v1/addons/price", PA, { category: "payment_gateway", key: "paystack", priceCents: 1 })).status, 403, "platform admin denied price");
    assert.equal((await reqf(api, "PUT", "/api/v1/addons/price", SITE_ADMIN, { category: "payment_gateway", key: "paystack", priceCents: 1 })).status, 403, "site admin denied price");

    // Decide + grant + revoke: system only.
    assert.equal((await reqf(api, "POST", "/api/v1/addons/requests/1/decide", SYS, { decision: "approve" })).status, 200, "system decides");
    assert.equal((await reqf(api, "POST", "/api/v1/addons/requests/1/decide", PA, { decision: "approve" })).status, 403, "platform admin denied decide");
    assert.equal((await reqf(api, "POST", "/api/v1/addons/grant", SYS, { site: SITE_A, category: "payment_gateway", key: "paystack" })).status, 200, "system grants");
    assert.equal((await reqf(api, "POST", "/api/v1/addons/grant", PA, { site: SITE_A, category: "payment_gateway", key: "paystack" })).status, 403, "platform admin denied grant");

    // Chart/UI assignment guard: a platform admin cannot set chart_style via the site patch (must request).
    const guarded = await reqf(api, "PATCH", `/api/v1/platform/sites/${SITE_A}`, PA, { chart_style: "candlestick" });
    assert.equal(guarded.status, 403, "platform admin blocked from assigning chart_style");
  } finally { await api.close(); }
});

test("ADDON-1 API: catalog edits are owner-only and shaped; brands switch owned systems; matrix is platform tier", async () => {
  const api = await startTestApi();
  try {
    const path = "/api/v1/addons/catalog/chart/candlestick";
    for (const t of [SITE_ADMIN, PA]) assert.equal((await reqf(api, "PATCH", path, t, { priceCents: 1 })).status, 403);
    const ok = await reqf(api, "PATCH", path, SYS, { billingType: "monthly", priceCents: "800000", setupFeeCents: 0, description: "  Pro  ", active: true });
    assert.equal(ok.status, 200);
    assert.deepEqual(await json(ok), { category: "chart", key: "candlestick", billingType: "monthly", priceCents: 800000, setupFeeCents: 0, description: "Pro", active: true });
    assert.equal((await reqf(api, "PATCH", path, SYS, { billingType: "weekly" })).status, 400, "unknown pricing model");
    assert.equal((await reqf(api, "PATCH", path, SYS, { priceCents: -5 })).status, 400, "negative price");
    assert.equal((await reqf(api, "PATCH", path, SYS, { active: "yes" })).status, 400);
    assert.equal((await reqf(api, "PATCH", path, SYS, {})).status, 400, "nothing to update");
    assert.equal((await reqf(api, "PATCH", "/api/v1/addons/catalog/weapons/x", SYS, { priceCents: 1 })).status, 404);

    assert.equal((await reqf(api, "POST", "/api/v1/addons/activate", SITE_ADMIN, { category: "chart", key: "line" })).status, 200, "own brand, owned system");
    const nope = await reqf(api, "POST", "/api/v1/addons/activate", SITE_ADMIN, { category: "chart", key: "candlestick" });
    assert.equal(nope.status, 409); assert.match((await json(nope)).error.message, /Request it first/);
    assert.equal((await reqf(api, "POST", "/api/v1/addons/activate", SITE_ADMIN, { site: "00000000-0000-0000-0000-0000000000bb", category: "chart", key: "line" })).status, 403, "another brand");
    assert.equal((await reqf(api, "POST", "/api/v1/addons/activate", PLAYER, { category: "chart", key: "line" })).status, 403);

    assert.equal((await reqf(api, "POST", "/api/v1/addons/requests/7/cancel", SITE_ADMIN)).status, 404);
    assert.equal((await reqf(api, "POST", "/api/v1/addons/requests/abc/cancel", SITE_ADMIN)).status, 400);
    assert.equal((await reqf(api, "GET", "/api/v1/addons/brands", SITE_ADMIN)).status, 403, "brand admins get no matrix");
    assert.equal((await reqf(api, "GET", "/api/v1/addons/brands", PA)).status, 200);
  } finally { await api.close(); }
});

/**
 * 0172's fn_platform_addon_grant / fn_platform_addon_revoke had no API caller until 0213: a platform
 * could only be granted a gateway by hand in SQL, which is how `mugo` came to own none and `dakafx`
 * served "Deposits are temporarily unavailable" for 5h45m. These are the routes that close that.
 */
test("platform add-ons API: the matrix is platform tier, grant/revoke are owner-only, grandfathered is explicit", async () => {
  const api = await startTestApi();
  const path = (a: string) => `/api/v1/addons/platform/${a}`;
  const body = { platform: PLATFORM_A, category: "payment_gateway", key: "megapay" };
  try {
    // Read: a platform admin sees its own platform, a brand admin and a player see nothing.
    assert.equal((await reqf(api, "GET", "/api/v1/addons/platforms", PLAYER)).status, 403);
    assert.equal((await reqf(api, "GET", "/api/v1/addons/platforms", SITE_ADMIN)).status, 403, "brand admins get no matrix");
    const pa = await reqf(api, "GET", "/api/v1/addons/platforms", PA);
    assert.equal(pa.status, 200);
    const rows = (await json(pa)).platforms;
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].owned, ["payment_gateway:mpesa"], "what the platform owns, inherited by its brands");
    assert.equal(rows[0].scope_active, true);
    assert.deepEqual(rows[0].live_rails, [], "owns only mpesa, which is globally off => nothing serves deposits");

    // Writes: SYSTEM owner only, in the route and again in the RPC.
    for (const t of [PLAYER, SITE_ADMIN, PA]) {
      assert.equal((await reqf(api, "POST", path("grant"), t, body)).status, 403, "only the system owner may grant");
      assert.equal((await reqf(api, "POST", path("revoke"), t, body)).status, 403, "only the system owner may revoke");
    }

    // grandfathered is never inferred: absent => false (the platform IS charged), true => recognised
    // as already owned, so 0172's billing trigger raises nothing.
    const billed = await reqf(api, "POST", path("grant"), SYS, body);
    assert.equal(billed.status, 200);
    assert.equal((await json(billed)).grandfathered, false, "absent means the platform is charged");
    const free = await reqf(api, "POST", path("grant"), SYS, { ...body, grandfathered: true });
    assert.equal((await json(free)).grandfathered, true);
    assert.equal((await reqf(api, "POST", path("grant"), SYS, { ...body, grandfathered: "yes" })).status, 400, "no truthy strings on a billing flag");

    // Shape + existence.
    assert.equal((await reqf(api, "POST", path("grant"), SYS, { category: "payment_gateway", key: "megapay" })).status, 400, "platform is required");
    assert.equal((await reqf(api, "POST", path("grant"), SYS, { ...body, category: "weapons" })).status, 404, "unknown category");
    assert.equal((await reqf(api, "POST", path("grant"), SYS, { ...body, platform: "plat-nope" })).status, 404, "unknown platform");
    assert.equal((await reqf(api, "POST", path("revoke"), SYS, { ...body, platform: "plat-nope" })).status, 404);
    assert.equal((await reqf(api, "POST", path("revoke"), SYS, body)).status, 200);
  } finally { await api.close(); }
});
