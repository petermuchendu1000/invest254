import { test } from "node:test";
import assert from "node:assert/strict";
import type { Cents } from "@invest254/shared";
import {
  HttpPaynicornClient, StubPaynicornClient, UnconfiguredPaynicornClient, ConfiguredPaynicornClient, STUB_PAYNICORN_SECRET,
  paynicornSign, encodeContent, decodeContent, signMatches, centsToPaynicornAmount, mapPaynicornStatus, readPostbackEnvelope,
  missingPaynicornCredentials, resolvePaynicornConfig,
} from "./paynicorn.js";
import { testConnection } from "./gatewaytest.js";
import { GATEWAY_SCHEMAS, PLAYER_DEPOSIT_RAILS, splitSubmission, validateConfig } from "./gatewayschema.js";

const SECRET = "143f824b235c4a649b60fae3d1aa5fe6";
const cents = (n: number) => n as Cents;

test("paynicorn sign: reproduces the official documentation vector", () => {
  // docs/overview/authorization — merchant secret + content_base64 -> sign
  const content = "eyJhbW91bnQiOiIzMDAwMCIsImNvdW50cnlDb2RlIjoiSUQiLCJjcEZyb250UGFnZSI6Imh0dHA6Ly93d3cuYmFpZHUuY29tIiwiY3VycmVuY3kiOiJJRFIiLCJlbWFpbCI6IjExMUAxMTEuY29tIiwibWVtbyI6Ik1lbW8iLCJvcmRlckRlc2NyaXB0aW9uIjoiSSBhbSBUZXN0ISIsInBheVR5cGUiOiJEQU5BIiwicGhvbmUiOiIwMjIxOTA5MjM0NSIsInVzZXJJZCI6IlUyMDMyMzEyMyIsIm9yZGVySWQiOiJYWlNfVEVTVDE2MDk0MDk4NDQ2MTAifQ==";
  assert.equal(paynicornSign(content, SECRET), "3dc08594b8877479d8a5cb44a5b76b21");
  assert.ok(signMatches(content, "3DC08594B8877479D8A5CB44A5B76B21", SECRET), "hex case is not significant");
  assert.ok(!signMatches(content, "3dc08594b8877479d8a5cb44a5b76b21", SECRET + "x"));
  assert.ok(!signMatches("", "x", SECRET) && !signMatches(content, "", SECRET) && !signMatches(content, "x", ""));
});

test("paynicorn content: base64(JSON) round-trips, including non-ASCII", () => {
  const c = encodeContent({ orderId: "a-1", orderDescription: "Dépôt — KES" });
  assert.deepEqual(decodeContent(c), { orderId: "a-1", orderDescription: "Dépôt — KES" });
});

test("paynicorn amount: whole KES on the wire, partial shillings refused", () => {
  assert.equal(centsToPaynicornAmount(cents(20_000)), "200");
  assert.throws(() => centsToPaynicornAmount(cents(20_050)), /NOT_WHOLE_KES/);
  assert.throws(() => centsToPaynicornAmount(cents(0)), /NOT_WHOLE_KES/);
});

test("paynicorn status: 1 paid, 0 failed, -1/unknown processing", () => {
  assert.deepEqual(mapPaynicornStatus("1", "t"), { resultCode: 0, processing: false, txnId: "t" });
  assert.deepEqual(mapPaynicornStatus("0"), { resultCode: 1, processing: false, txnId: null });
  assert.equal(mapPaynicornStatus("-1").processing, true);
  assert.equal(mapPaynicornStatus(undefined).resultCode, null);
});

test("paynicorn postback envelope: JSON object, JSON text, Buffer and form-encoded", () => {
  const want = { content: "Y29udA==", sign: "abc" };
  assert.deepEqual(readPostbackEnvelope(want), want);
  assert.deepEqual(readPostbackEnvelope(JSON.stringify(want)), want);
  assert.deepEqual(readPostbackEnvelope(Buffer.from(JSON.stringify(want))), want);
  assert.deepEqual(readPostbackEnvelope(`content=${encodeURIComponent(want.content)}&sign=abc`), want);
  assert.equal(readPostbackEnvelope({ content: "x" }), null);
  assert.equal(readPostbackEnvelope(""), null);
  assert.equal(readPostbackEnvelope("{not json"), null);
});

/** A fake Paynicorn server: checks the request signature and answers a signed envelope. */
function fakePaynicorn(answer: (op: string, biz: any) => Record<string, unknown>, opts: { secret?: string; responseCode?: string; tamper?: boolean } = {}) {
  const calls: Array<{ url: string; body: any; biz: any }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    assert.equal(body.sign, paynicornSign(body.content, SECRET), "request must be signed with the merchant secret");
    const biz = decodeContent(body.content);
    calls.push({ url, body, biz });
    const op = url.split("/").pop()!;
    if (opts.responseCode && opts.responseCode !== "000000") return new Response(JSON.stringify({ responseCode: opts.responseCode, responseMessage: "nope" }), { status: 200 });
    const content = encodeContent(answer(op, biz));
    const sign = opts.tamper ? "0".repeat(32) : paynicornSign(content, opts.secret ?? SECRET);
    return new Response(JSON.stringify({ responseCode: "000000", responseMessage: "success", content, sign }), { status: 200 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}
const CFG = { baseUrl: "https://api.paynicorn.test/", appKey: "7971321", merchantSecret: SECRET };

test("paynicorn http: pay sends a signed KE/KES order and returns the cashier URL", async () => {
  const f = fakePaynicorn(() => ({ code: "0000", message: "ok", txnId: "PN1", status: "-1", webUrl: "https://cashier/x" }));
  const c = new HttpPaynicornClient({ ...CFG, frontPage: "https://default/wallet" }, f.impl);
  const out = await c.pay({ amountCents: cents(50_000), orderId: "tx-1", description: "Deposit", frontPage: "https://cpfmarket.com/wallet" });
  assert.deepEqual(out, { txnId: "PN1", webUrl: "https://cashier/x", status: "-1" });
  assert.equal(f.calls[0]!.url, "https://api.paynicorn.test/trade/v3/transaction/pay");
  assert.equal(f.calls[0]!.body.appKey, "7971321");
  assert.deepEqual(f.calls[0]!.biz, { amount: "500", countryCode: "KE", currency: "KES", orderId: "tx-1", orderDescription: "Deposit", cpFrontPage: "https://cpfmarket.com/wallet" });
});

test("paynicorn http: pay refuses a failed order, an envelope error, and an unsigned response", async () => {
  const failed = new HttpPaynicornClient(CFG, fakePaynicorn(() => ({ code: "1001", message: "bad", status: "0", webUrl: "" })).impl);
  await assert.rejects(failed.pay({ amountCents: cents(20_000), orderId: "o", description: "d" }), /PAYNICORN_PAY_REFUSED/);
  const authFail = new HttpPaynicornClient(CFG, fakePaynicorn(() => ({}), { responseCode: "204005" }).impl);
  await assert.rejects(authFail.pay({ amountCents: cents(20_000), orderId: "o", description: "d" }), /REJECTED_200:204005/);
  const forged = new HttpPaynicornClient(CFG, fakePaynicorn(() => ({ status: "-1", webUrl: "https://evil" }), { tamper: true }).impl);
  await assert.rejects(forged.pay({ amountCents: cents(20_000), orderId: "o", description: "d" }), /BAD_SIGNATURE/);
});

test("paynicorn http: query maps status; a transport/signature failure is 'processing', never paid", async () => {
  const paid = new HttpPaynicornClient(CFG, fakePaynicorn((_op, biz) => ({ txnId: "PN9", status: "1", orderId: biz.orderId })).impl);
  assert.deepEqual(await paid.queryPayment("tx-9"), { resultCode: 0, processing: false, txnId: "PN9" });
  const forged = new HttpPaynicornClient(CFG, fakePaynicorn(() => ({ status: "1" }), { tamper: true }).impl);
  assert.deepEqual(await forged.queryPayment("tx-9"), { resultCode: null, processing: true, txnId: null });
  const down = new HttpPaynicornClient(CFG, (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch);
  assert.equal((await down.queryPayment("tx-9")).processing, true);
});

test("paynicorn http: postbacks verify only with our secret", async () => {
  const c = new HttpPaynicornClient(CFG);
  const content = encodeContent({ txnId: "PN1", orderId: "tx-1", amount: "500", currency: "KES", countryCode: "KE", status: "1", code: "0000", message: "ok" });
  const ok = await c.verifyPostback({ content, sign: paynicornSign(content, SECRET) });
  assert.equal(ok?.orderId, "tx-1");
  assert.equal(ok?.status, "1");
  assert.equal(await c.verifyPostback({ content, sign: paynicornSign(content, "attacker") }), null);
  assert.equal(await c.verifyPostback({ orderId: "tx-1", status: "1" }), null, "an unsigned body never verifies");
});

test("paynicorn stub + unconfigured clients", async () => {
  const s = new StubPaynicornClient();
  assert.match((await s.pay({ amountCents: cents(20_000), orderId: "o1", description: "d" })).webUrl, /order=o1/);
  const content = encodeContent({ txnId: "t", orderId: "o1", status: "1" });
  assert.equal((await s.verifyPostback({ content, sign: paynicornSign(content, STUB_PAYNICORN_SECRET) }))?.orderId, "o1");
  const u = new UnconfiguredPaynicornClient(["merchant_secret"]);
  await assert.rejects(u.pay({ amountCents: cents(20_000), orderId: "o", description: "d" }), /PAYNICORN_NOT_CONFIGURED:merchant_secret/);
  await assert.rejects(u.queryPayment("o"), /PAYNICORN_NOT_CONFIGURED/);
  assert.equal(await u.verifyPostback({ content, sign: "x" }), null);
});

test("paynicorn config: env fallback, DB override, and production refuses the stub", async () => {
  assert.deepEqual(missingPaynicornCredentials(resolvePaynicornConfig({}, {})), ["app_key", "merchant_secret"]);
  const env = { PAYNICORN_APP_KEY: "k", PAYNICORN_MERCHANT_SECRET: SECRET, NODE_ENV: "production" } as NodeJS.ProcessEnv;
  assert.equal(resolvePaynicornConfig({}, env).baseUrl, "https://api.paynicorn.com");
  const prodEmpty = new ConfiguredPaynicornClient(async () => null, { NODE_ENV: "production" } as NodeJS.ProcessEnv);
  await assert.rejects(prodEmpty.pay({ amountCents: cents(20_000), orderId: "o", description: "d" }), /PAYNICORN_NOT_CONFIGURED/);
  const dbWins = new ConfiguredPaynicornClient(async () => ({ appKey: "db", merchantSecret: "dbsecret" }), env);
  const content = encodeContent({ orderId: "o" });
  assert.ok(await dbWins.verifyPostback({ content, sign: paynicornSign(content, "dbsecret") }), "DB secret is the one in force");
  assert.equal(await dbWins.verifyPostback({ content, sign: paynicornSign(content, SECRET) }), null);
});

test("paynicorn schema: a player rail with app key + encrypted merchant secret", () => {
  assert.ok(PLAYER_DEPOSIT_RAILS.has("paynicorn"));
  assert.equal(GATEWAY_SCHEMAS.paynicorn!.playerAvailable, true);
  const split = splitSubmission("paynicorn", { app_key: "7971321", merchant_secret: SECRET, front_page: "https://cpfmarket.com/wallet" });
  assert.deepEqual(split.secrets, { merchant_secret: SECRET });
  assert.deepEqual(validateConfig("paynicorn", split), []);
  assert.deepEqual(validateConfig("paynicorn", splitSubmission("paynicorn", { app_key: "k" })).map((i) => i.field), ["merchant_secret"]);
  assert.deepEqual(validateConfig("paynicorn", splitSubmission("paynicorn", { app_key: "k" }), ["merchant_secret"]), [], "a stored secret satisfies the requirement");
});

test("paynicorn connection test: signed query, codes mapped, secret never echoed", async () => {
  const answer = (code: string) => (async (_u: string, init: RequestInit) => {
    const b = JSON.parse(String(init.body));
    assert.equal(b.sign, paynicornSign(b.content, SECRET));
    return new Response(JSON.stringify({ responseCode: code, responseMessage: "m" }), { status: 200 });
  }) as unknown as typeof fetch;
  const cfg = { app_key: "7971321", merchant_secret: SECRET };
  assert.equal((await testConnection("paynicorn", cfg, answer("000000"))).status, "valid");
  const bad = await testConnection("paynicorn", cfg, answer("204005"));
  assert.equal(bad.status, "invalid");
  assert.ok(!bad.detail.includes(SECRET));
  assert.equal((await testConnection("paynicorn", { app_key: "k" }, answer("000000"))).status, "not_configured");
});
