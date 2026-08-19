import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestApi, TEST_ADMIN, type TestApi } from "./testutil.js";

/**
 * Regression: marketer login must be BRAND-scoped.
 *
 * Reproduces the production "Patricia Muthoni cannot log in" bug. A marketer phone is unique only
 * WITHIN a brand, so two brands can each own an active marketer with the same number. Before the
 * fix the login ignored the brand entirely and defaulted to the default site, so it authenticated
 * against whichever marketer sat on the default brand — a marketer on any other brand (Patricia,
 * brand "brandb") could never sign in as themselves, and their PIN was checked against the wrong
 * account. These tests pin the corrected behaviour: the login resolves the marketer within the
 * brand named on the request (`site`), and never leaks across brands.
 */

const json = (res: Response): Promise<any> => res.json() as Promise<any>;
function req(api: TestApi, method: string, path: string, body?: unknown, token?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token) headers["authorization"] = `Bearer ${token}`;
  const init: RequestInit = { method, headers };
  if (body !== undefined) { headers["content-type"] = "application/json"; init.body = JSON.stringify(body); }
  return fetch(`${api.baseUrl}${path}`, init);
}

const ADMIN_DEFAULT = `${TEST_ADMIN}:admin`;                                              // default brand
const ADMIN_BRANDB = `${TEST_ADMIN}:admin:22222222-2222-2222-2222-222222222222`;          // brand "brandb"

/** Create a marketer on the admin token's brand + set its PIN; return the marketer id. */
async function onboard(api: TestApi, adminToken: string, name: string, phone: string, pin: string): Promise<string> {
  const id = (await json(await req(api, "POST", "/api/v1/admin/marketers", { name, phone }, adminToken))).id as string;
  assert.equal((await req(api, "POST", `/api/v1/admin/marketers/${id}/pin`, { pin }, adminToken)).status, 200, "set pin");
  return id;
}

const PHONE = "0706597235"; // the colliding number owned on BOTH brands

test("PIN login resolves the marketer in the request's brand, not the default brand", async () => {
  const api = await startTestApi();
  try {
    const gritel = await onboard(api, ADMIN_DEFAULT, "gritel", PHONE, "1111");           // default brand
    const patricia = await onboard(api, ADMIN_BRANDB, "Patricia Muthoni", PHONE, "2222"); // brand "brandb"
    assert.notEqual(gritel, patricia, "two distinct marketers share the phone across brands");

    // Patricia signs in on HER brand with HER PIN -> resolves Patricia (not gritel).
    const ok = await req(api, "POST", "/api/v1/marketers/auth/login", { phone: PHONE, pin: "2222", site: "brandb" });
    assert.equal(ok.status, 200, "brand-scoped login succeeds");
    assert.equal((await json(ok)).marketer.id, patricia, "resolved the brand-B marketer");

    // gritel signs in on the default brand with gritel's PIN -> resolves gritel.
    const okA = await req(api, "POST", "/api/v1/marketers/auth/login", { phone: PHONE, pin: "1111", site: "invest254" });
    assert.equal(okA.status, 200);
    assert.equal((await json(okA)).marketer.id, gritel, "resolved the default-brand marketer");
  } finally { await api.close(); }
});

test("a marketer's PIN is never accepted against the same phone on another brand", async () => {
  const api = await startTestApi();
  try {
    await onboard(api, ADMIN_DEFAULT, "gritel", PHONE, "1111");            // default brand, PIN 1111
    await onboard(api, ADMIN_BRANDB, "Patricia Muthoni", PHONE, "2222");   // brand "brandb", PIN 2222

    // Patricia's PIN must NOT authenticate against the default brand's marketer.
    assert.equal((await req(api, "POST", "/api/v1/marketers/auth/login", { phone: PHONE, pin: "2222", site: "invest254" })).status, 401);
    // gritel's PIN must NOT authenticate against Patricia's brand.
    assert.equal((await req(api, "POST", "/api/v1/marketers/auth/login", { phone: PHONE, pin: "1111", site: "brandb" })).status, 401);
  } finally { await api.close(); }
});

test("no-brand login keeps the legacy default-brand behaviour (single-tenant callers)", async () => {
  const api = await startTestApi();
  try {
    const gritel = await onboard(api, ADMIN_DEFAULT, "gritel", PHONE, "1111");
    await onboard(api, ADMIN_BRANDB, "Patricia Muthoni", PHONE, "2222");

    // With no `site` hint we fall back to the default brand -> only gritel's PIN works there.
    const res = await req(api, "POST", "/api/v1/marketers/auth/login", { phone: PHONE, pin: "1111" });
    assert.equal(res.status, 200);
    assert.equal((await json(res)).marketer.id, gritel);
    // Patricia's PIN (brand B) does not work without naming her brand.
    assert.equal((await req(api, "POST", "/api/v1/marketers/auth/login", { phone: PHONE, pin: "2222" })).status, 401);
  } finally { await api.close(); }
});
