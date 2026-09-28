import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestApi, type TestApi } from "./testutil.js";

/**
 * #10 geo-currency — the API surface for a per-user display currency and the geo/preference override
 * on the public brand route. Presentation only: nothing here moves money (always KES cents).
 */

const json = (res: Response): Promise<any> => res.json() as Promise<any>;
interface ReqOpts { token?: string; body?: unknown }
function req(api: TestApi, method: string, path: string, opts: ReqOpts = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.token) headers["authorization"] = `Bearer ${opts.token}`;
  const init: RequestInit = { method, headers };
  if (opts.body !== undefined) { headers["content-type"] = "application/json"; init.body = JSON.stringify(opts.body); }
  return fetch(`${api.baseUrl}${path}`, init);
}

const REG = { phone: "0712345678", username: "alice", password: "Password1" };

// The stub verifier treats the bearer string as the userId, so authenticate as the freshly
// registered account by using its userId as the token (its profile then exists in the identity repo).
async function registerToken(api: TestApi): Promise<string> {
  const res = await req(api, "POST", "/api/v1/auth/register", { body: REG });
  return (await json(res)).userId as string;
}

test("POST /auth/currency requires authentication", async () => {
  const api = await startTestApi();
  try {
    assert.equal((await req(api, "POST", "/api/v1/auth/currency", { body: { currency: "USD" } })).status, 401);
  } finally { await api.close(); }
});

test("POST /auth/currency saves a supported preference and /auth/me echoes it", async () => {
  const api = await startTestApi();
  try {
    const token = await registerToken(api);
    // Default: no preference.
    assert.equal((await json(await req(api, "GET", "/api/v1/auth/me", { token }))).displayCurrency, null);
    // Set (lower-case accepted, normalized to upper).
    const set = await req(api, "POST", "/api/v1/auth/currency", { token, body: { currency: "usd" } });
    assert.equal(set.status, 200);
    assert.equal((await json(set)).displayCurrency, "USD");
    assert.equal((await json(await req(api, "GET", "/api/v1/auth/me", { token }))).displayCurrency, "USD");
    // Clear with null.
    const cleared = await req(api, "POST", "/api/v1/auth/currency", { token, body: { currency: null } });
    assert.equal(cleared.status, 200);
    assert.equal((await json(cleared)).displayCurrency, null);
    assert.equal((await json(await req(api, "GET", "/api/v1/auth/me", { token }))).displayCurrency, null);
  } finally { await api.close(); }
});

test("POST /auth/currency rejects an unsupported currency (400) and a non-string (400)", async () => {
  const api = await startTestApi();
  try {
    const token = await registerToken(api);
    const bad = await req(api, "POST", "/api/v1/auth/currency", { token, body: { currency: "JPY" } });
    assert.equal(bad.status, 400);
    assert.equal((await json(bad)).error.code, "UNSUPPORTED_CURRENCY");
    assert.equal((await req(api, "POST", "/api/v1/auth/currency", { token, body: { currency: 42 } })).status, 400);
  } finally { await api.close(); }
});

test("GET /site/brand: an unsupported/unknown geo or preference leaves the brand currency untouched (KES)", async () => {
  const api = await startTestApi();
  try {
    // Unknown country + unsupported preference → brand default stands, no override applied.
    const b1 = await json(await req(api, "GET", "/api/v1/site/brand?host=invest254.com&country=XX&currency=JPY"));
    assert.equal(b1.currency, "KES");
    // A KES preference on a KES brand is a no-op.
    const b2 = await json(await req(api, "GET", "/api/v1/site/brand?host=invest254.com&currency=KES"));
    assert.equal(b2.currency, "KES");
  } finally { await api.close(); }
});

test("GET /site/brand: a supported preference overrides the display currency with a live rate", async () => {
  const api = await startTestApi();
  try {
    const b = await json(await req(api, "GET", "/api/v1/site/brand?host=invest254.com&currency=USD"));
    assert.equal(b.currency, "USD");
    // The override MUST carry a usable KES→USD rate, else the web silently renders KES.
    assert.equal(typeof b.fxRateFromKes, "number");
    assert.ok(b.fxRateFromKes > 0 && Number.isFinite(b.fxRateFromKes), `expected a positive rate, got ${b.fxRateFromKes}`);
  } finally { await api.close(); }
});

test("GET /site/brand: geo country resolves a display currency when no preference is given", async () => {
  const api = await startTestApi();
  try {
    // A visitor in Great Britain, no explicit preference → GBP display on the KES brand.
    const b = await json(await req(api, "GET", "/api/v1/site/brand?host=invest254.com&country=GB"));
    assert.equal(b.currency, "GBP");
    assert.ok(b.fxRateFromKes > 0);
    // An explicit preference beats geo.
    const b2 = await json(await req(api, "GET", "/api/v1/site/brand?host=invest254.com&country=GB&currency=USD"));
    assert.equal(b2.currency, "USD");
  } finally { await api.close(); }
});
