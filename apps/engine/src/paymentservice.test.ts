import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryPaymentRepository } from "./payments.js";
import { StubDarajaClient, makeDarajaClient, HttpDarajaClient, type DarajaClient, type StkPushArgs, type StkPushResult, type StkQueryResult, type B2cArgs, type B2cResult } from "./daraja.js";
import { PaymentService } from "./paymentservice.js";

function rig(events?: any) {
  const repo = new InMemoryPaymentRepository();
  repo.seed("u", 100_000);
  const daraja = new StubDarajaClient();
  const svc = new PaymentService(repo, daraja, { events });
  return { repo, daraja, svc };
}

test("PaymentService: deposit STK -> callback credits; idempotent", async () => {
  const { repo, svc } = rig();
  const { txId, checkoutRequestId } = await svc.initiateDeposit("u", 50_000, "0712345678");
  assert.ok(txId && checkoutRequestId);
  const c1 = await svc.handleStkCallback(checkoutRequestId, 0, "OK", "RCPT", {});
  assert.deepEqual(c1, { applied: true, status: "success", newBalance: 150_000 });
  const c2 = await svc.handleStkCallback(checkoutRequestId, 0, "OK", "RCPT", {});
  assert.equal(c2.applied, false);
  assert.equal(await repo.getBalance("u"), 150_000);
});

test("PaymentService: deposit validation (min, integer, positive) + phone normalization", async () => {
  const { svc } = rig();
  await assert.rejects(() => svc.initiateDeposit("u", 9_999, "0712345678"), /BELOW_MIN/);
  await assert.rejects(() => svc.initiateDeposit("u", 0, "0712345678"), /INVALID_AMOUNT/);
  await assert.rejects(() => svc.initiateDeposit("u", 50_000, "not-a-phone"), /INVALID_PHONE/);
});

test("PaymentService: withdrawal request holds, approve dispatches B2C, success keeps debit + fires event", async () => {
  const fired: any[] = [];
  const { repo, svc } = rig({ onWithdrawalSuccess: (e: any) => fired.push(e) });
  const w = await svc.requestWithdrawal("u", 20_000, "0712345678");
  assert.equal(w.newBalance, 80_000);
  const ap = await svc.approveWithdrawal(w.txId, "admin");
  assert.ok(ap.approved && ap.conversationId);
  const c = await svc.handleB2cResult(w.txId, 0, ap.conversationId!, "RCPT", {});
  assert.deepEqual(c, { applied: true, status: "success", newBalance: 80_000 });
  assert.deepEqual(fired, [{ userId: "u", amountCents: 20_000 }]); // real activity hook
  assert.equal(await repo.getBalance("u"), 80_000);
});

test("PaymentService: reject reverses; failed B2C reverses; no event on failure", async () => {
  const fired: any[] = [];
  const { repo, svc } = rig({ onWithdrawalSuccess: (e: any) => fired.push(e) });
  const w1 = await svc.requestWithdrawal("u", 30_000, "0712345678");
  assert.equal(w1.newBalance, 70_000);
  const rj = await svc.rejectWithdrawal(w1.txId, "admin");
  assert.deepEqual(rj, { reversed: true, newBalance: 100_000 });

  const w2 = await svc.requestWithdrawal("u", 25_000, "0712345678");
  await svc.approveWithdrawal(w2.txId, "admin");
  const c = await svc.handleB2cResult(w2.txId, 1, "conv", null, {});
  assert.deepEqual(c, { applied: true, status: "failed", newBalance: 100_000 });
  assert.equal(fired.length, 0); // no success event
  assert.equal(await repo.getBalance("u"), 100_000);
});

test("PaymentService: withdrawal validation (min, positive, phone)", async () => {
  const { svc } = rig();
  await assert.rejects(() => svc.requestWithdrawal("u", 19_999, "0712345678"), /BELOW_MIN/);
  await assert.rejects(() => svc.requestWithdrawal("u", -1, "0712345678"), /INVALID_AMOUNT/);
  await assert.rejects(() => svc.requestWithdrawal("u", 20_000, "bad"), /INVALID_PHONE/);
});

test("makeDarajaClient: stub without creds, HttpDarajaClient when configured", () => {
  assert.ok(makeDarajaClient({} as NodeJS.ProcessEnv) instanceof StubDarajaClient);
  const cfgEnv = { MPESA_CONSUMER_KEY: "k", MPESA_CONSUMER_SECRET: "s", MPESA_SHORTCODE: "174379", MPESA_PASSKEY: "p" } as any;
  assert.ok(makeDarajaClient(cfgEnv) instanceof HttpDarajaClient);
});

test("HttpDarajaClient: builds STK Push + B2C requests with token, KES amounts, correct endpoints", async () => {
  const reqs: { url: string; body: any }[] = [];
  const fakeFetch = (async (url: any, init: any) => {
    const u = String(url);
    if (u.includes("/oauth/")) return { ok: true, json: async () => ({ access_token: "tok", expires_in: "3599" }) } as any;
    reqs.push({ url: u, body: JSON.parse(init.body) });
    if (u.includes("stkpush")) return { ok: true, json: async () => ({ MerchantRequestID: "MR1", CheckoutRequestID: "CO1" }) } as any;
    return { ok: true, json: async () => ({ ConversationID: "CONV1" }) } as any;
  }) as unknown as typeof fetch;
  const cfg = { env: "sandbox", consumerKey: "k", consumerSecret: "s", shortcode: "174379", passkey: "pk", stkCallbackUrl: "https://cb", b2cInitiator: "init", b2cSecurityCredential: "sec", b2cResultUrl: "https://r", b2cTimeoutUrl: "https://t" } as const;
  const c = new HttpDarajaClient(cfg, fakeFetch);
  const stk = await c.stkPush({ amountCents: 5_000, msisdn: "254712345678", accountRef: "Invest254", desc: "Deposit" });
  assert.deepEqual(stk, { merchantRequestId: "MR1", checkoutRequestId: "CO1" });
  const stkReq = reqs.find((r) => r.url.includes("stkpush"))!;
  assert.equal(stkReq.body.Amount, 50); // 5000 cents -> KES 50
  assert.equal(stkReq.body.TransactionType, "CustomerPayBillOnline");
  assert.equal(stkReq.body.PhoneNumber, "254712345678");
  const b2c = await c.b2cPayment({ amountCents: 20_000, msisdn: "254712345678", remarks: "Withdrawal", resultId: "TX-9" });
  assert.equal(b2c.conversationId, "CONV1");
  const b2cReq = reqs.find((r) => r.url.includes("b2c"))!;
  assert.equal(b2cReq.body.Amount, 200);
  assert.equal(b2cReq.body.CommandID, "BusinessPayment");
  // The result URL must carry the txId so Safaricom hits `/withdrawals/mpesa/result/:txId`.
  assert.equal(b2cReq.body.ResultURL, "https://r/TX-9");
});

/** Daraja double whose STKPushQuery result is scripted, to exercise callback verification. */
class FakeDaraja implements DarajaClient {
  constructor(private readonly q: StkQueryResult | Error) {}
  async stkPush(_a: StkPushArgs): Promise<StkPushResult> { return { merchantRequestId: "m", checkoutRequestId: "co-x" }; }
  async stkPushQuery(_c: string): Promise<StkQueryResult> { if (this.q instanceof Error) throw this.q; return this.q; }
  async b2cPayment(_a: B2cArgs): Promise<B2cResult> { return { conversationId: "c" }; }
}

test("PaymentService: forged STK success is NOT credited when STKPushQuery says failed", async () => {
  const repo = new InMemoryPaymentRepository();
  repo.seed("u", 100_000);
  const svc = new PaymentService(repo, new FakeDaraja({ resultCode: 1032, processing: false }));
  const { checkoutRequestId } = await svc.initiateDeposit("u", 50_000, "0712345678");
  const res = await svc.handleStkCallback(checkoutRequestId, 0, "forged success", "RCPT", {});
  assert.equal(res.status, "failed");
  assert.equal(await repo.getBalance("u"), 100_000); // no phantom credit
});

test("PaymentService: unverifiable STK success is left pending (throws for retry, no credit)", async () => {
  const repo = new InMemoryPaymentRepository();
  repo.seed("u", 100_000);
  const svc = new PaymentService(repo, new FakeDaraja({ resultCode: null, processing: true }));
  const { checkoutRequestId } = await svc.initiateDeposit("u", 50_000, "0712345678");
  await assert.rejects(() => svc.handleStkCallback(checkoutRequestId, 0, "OK", "RCPT", {}), /STK_VERIFY_PENDING/);
  assert.equal(await repo.getBalance("u"), 100_000); // not credited on unverified callback
});

test("PaymentService: verification can be disabled (legacy direct-credit) via option", async () => {
  const repo = new InMemoryPaymentRepository();
  repo.seed("u", 100_000);
  // Even a 'failing' query is ignored when verification is off — the raw callback is trusted.
  const svc = new PaymentService(repo, new FakeDaraja({ resultCode: 1032, processing: false }), { verifyStkCallbacks: false });
  const { checkoutRequestId } = await svc.initiateDeposit("u", 50_000, "0712345678");
  const res = await svc.handleStkCallback(checkoutRequestId, 0, "OK", "RCPT", {});
  assert.equal(res.status, "success");
  assert.equal(await repo.getBalance("u"), 150_000);
});

test("PaymentService: reconcile settles a stranded deposit from Safaricom's authoritative status", async () => {
  const repo = new InMemoryPaymentRepository();
  repo.seed("u", 100_000);
  const svc = new PaymentService(repo, new FakeDaraja({ resultCode: 0, processing: false }));
  await svc.initiateDeposit("u", 50_000, "0712345678"); // callback never arrives
  assert.equal(await repo.getBalance("u"), 100_000);
  const r = await svc.reconcileDeposits({ olderThanMs: 0 });
  assert.deepEqual(r, { scanned: 1, settled: 1, stillPending: 0, errors: 0 });
  assert.equal(await repo.getBalance("u"), 150_000); // paid deposit is no longer stranded
});

test("PaymentService: reconcile leaves still-processing deposits for the next sweep", async () => {
  const repo = new InMemoryPaymentRepository();
  repo.seed("u", 100_000);
  const svc = new PaymentService(repo, new FakeDaraja({ resultCode: null, processing: true }));
  await svc.initiateDeposit("u", 50_000, "0712345678");
  const r = await svc.reconcileDeposits({ olderThanMs: 0 });
  assert.equal(r.stillPending, 1);
  assert.equal(r.settled, 0);
  assert.equal(await repo.getBalance("u"), 100_000);
});

test("PaymentService: reconcile marks an unpaid deposit failed without crediting", async () => {
  const repo = new InMemoryPaymentRepository();
  repo.seed("u", 100_000);
  const svc = new PaymentService(repo, new FakeDaraja({ resultCode: 1037, processing: false }));
  await svc.initiateDeposit("u", 50_000, "0712345678");
  const r = await svc.reconcileDeposits({ olderThanMs: 0 });
  assert.equal(r.settled, 1);
  assert.equal(await repo.getBalance("u"), 100_000);
});

test("PaymentService: reconcile survives provider errors and reports them", async () => {
  const repo = new InMemoryPaymentRepository();
  repo.seed("u", 100_000);
  const svc = new PaymentService(repo, new FakeDaraja(new Error("DARAJA_STKQUERY_500")));
  await svc.initiateDeposit("u", 50_000, "0712345678");
  const r = await svc.reconcileDeposits({ olderThanMs: 0 });
  assert.equal(r.errors, 1);
  assert.equal(r.settled, 0);
  assert.equal(await repo.getBalance("u"), 100_000);
});
