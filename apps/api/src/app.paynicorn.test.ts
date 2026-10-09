import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeContent, paynicornSign, STUB_PAYNICORN_SECRET } from "@invest254/engine";
import { startTestApi, TEST_USER, type TestApi } from "./testutil.js";

const json = (res: Response): Promise<any> => res.json() as Promise<any>;
function req(api: TestApi, method: string, path: string, opts: { token?: string; body?: unknown; raw?: string; type?: string; origin?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.token) headers["authorization"] = `Bearer ${opts.token}`;
  if (opts.origin) headers["origin"] = opts.origin;
  const init: RequestInit = { method, headers };
  if (opts.raw !== undefined) { headers["content-type"] = opts.type ?? "application/json"; init.body = opts.raw; }
  else if (opts.body !== undefined) { headers["content-type"] = "application/json"; init.body = JSON.stringify(opts.body); }
  return fetch(`${api.baseUrl}${path}`, init);
}
const PLAYER = TEST_USER;
function signed(fields: Record<string, string>, secret = STUB_PAYNICORN_SECRET) {
  const content = encodeContent({ txnId: "PN77", amount: "500", currency: "KES", countryCode: "KE", status: "1", code: "0000", message: "ok", ...fields });
  return { content, sign: paynicornSign(content, secret) };
}

test("paynicorn: offered as an Online checkout method when enabled", async () => {
  const api = await startTestApi();
  try {
    api.payRepo.setProviders([{ code: "mpesa", displayName: "M-Pesa" }, { code: "paynicorn", displayName: "Paynicorn" }]);
    const body = await json(await req(api, "GET", "/api/v1/deposits/providers", { token: PLAYER }));
    assert.ok(body.methods.some((m: any) => m.id === "paynicorn-checkout" && m.channel === "checkout"));
    assert.ok(!body.methods.some((m: any) => m.id === "paynicorn-stk"));
  } finally { await api.close(); }
});

test("paynicorn deposit: 202 + cashier URL; signed postback credits once and answers success_{txnId}", async () => {
  const api = await startTestApi({ startingBalanceCents: 100_000 });
  try {
    api.payRepo.setProviders([{ code: "paynicorn", displayName: "Paynicorn" }]);
    const dep = await req(api, "POST", "/api/v1/deposits/paynicorn", { token: PLAYER, body: { amount: 50_000 } });
    assert.equal(dep.status, 202);
    const { transactionId, checkoutUrl } = await json(dep);
    assert.match(checkoutUrl, /^https:\/\//);

    const cb = await req(api, "POST", "/api/v1/deposits/paynicorn/callback", { raw: JSON.stringify(signed({ orderId: transactionId })) });
    assert.equal(cb.status, 200);
    assert.match(cb.headers.get("content-type") ?? "", /^text\/plain/);
    assert.equal(await cb.text(), "success_PN77");
    // Paynicorn retries are acknowledged without a second credit.
    const again = await req(api, "POST", "/api/v1/deposits/paynicorn/callback", { raw: JSON.stringify(signed({ orderId: transactionId })) });
    assert.equal(await again.text(), "success_PN77");

    const bal = await json(await req(api, "GET", "/api/v1/wallet", { token: PLAYER }));
    assert.equal(bal.real, 150_000);
  } finally { await api.close(); }
});

test("paynicorn callback: form-encoded body works; a forged signature is 401 and credits nothing", async () => {
  const api = await startTestApi({ startingBalanceCents: 0 });
  try {
    api.payRepo.setProviders([{ code: "paynicorn", displayName: "Paynicorn" }]);
    const { transactionId } = await json(await req(api, "POST", "/api/v1/deposits/paynicorn", { token: PLAYER, body: { amount: 50_000 } }));
    const forged = signed({ orderId: transactionId }, "attacker");
    const bad = await req(api, "POST", "/api/v1/deposits/paynicorn/callback", { raw: JSON.stringify(forged) });
    assert.equal(bad.status, 401);
    assert.equal((await json(await req(api, "GET", "/api/v1/wallet", { token: PLAYER }))).real, 0);

    const env = signed({ orderId: transactionId });
    const form = await req(api, "POST", "/api/v1/deposits/paynicorn/callback", {
      raw: `content=${encodeURIComponent(env.content)}&sign=${env.sign}`, type: "application/x-www-form-urlencoded",
    });
    assert.equal(form.status, 200);
    assert.equal((await json(await req(api, "GET", "/api/v1/wallet", { token: PLAYER }))).real, 50_000);
  } finally { await api.close(); }
});

test("paynicorn callback: address check (GET) and unknown signed orders answer 200", async () => {
  const api = await startTestApi();
  try {
    assert.equal((await req(api, "GET", "/api/v1/deposits/paynicorn/callback")).status, 200);
    const r = await req(api, "POST", "/api/v1/deposits/paynicorn/callback", { raw: JSON.stringify(signed({ orderId: "not-ours", txnId: "T9" })) });
    assert.equal(await r.text(), "success_T9");
  } finally { await api.close(); }
});

test("paynicorn deposit: refused when switched off, below the floor, or not whole shillings", async () => {
  const api = await startTestApi();
  try {
    api.payRepo.setProviders([{ code: "mpesa", displayName: "M-Pesa" }]);
    const off = await req(api, "POST", "/api/v1/deposits/paynicorn", { token: PLAYER, body: { amount: 50_000 } });
    assert.equal(off.status, 403);
    assert.equal((await json(off)).error.code, "PROVIDER_DISABLED");
    api.payRepo.setProviders([{ code: "paynicorn", displayName: "Paynicorn" }]);
    assert.equal((await req(api, "POST", "/api/v1/deposits/paynicorn", { token: PLAYER, body: { amount: 9_900 } })).status, 400);
    assert.equal((await req(api, "POST", "/api/v1/deposits/paynicorn", { token: PLAYER, body: { amount: 50_050 } })).status, 400);
    assert.equal((await req(api, "POST", "/api/v1/deposits/paynicorn", { body: { amount: 50_000 } })).status, 401);
  } finally { await api.close(); }
});
