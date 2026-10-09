import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryPaymentRepository } from "./payments.js";
import { PaymentService } from "./paymentservice.js";
import { StubPaynicornClient, STUB_PAYNICORN_SECRET, encodeContent, paynicornSign } from "./paynicorn.js";

const daraja = {
  stkPush: async () => ({ merchantRequestId: "m", checkoutRequestId: "c" }),
  stkPushQuery: async () => ({ resultCode: 0, processing: false }),
  b2cPayment: async () => ({ conversationId: "x" }),
};

function rig(status: "1" | "-1" | "0" = "1") {
  const repo = new InMemoryPaymentRepository();
  repo.seed("u1", 0);
  const paynicorn = new StubPaynicornClient(status);
  const svc = new PaymentService(repo, daraja, { paynicorn });
  return { repo, svc, paynicorn };
}
/** A postback signed exactly as Paynicorn signs it (md5(content + merchant secret)). */
function postback(fields: Record<string, string>, secret = STUB_PAYNICORN_SECRET) {
  const content = encodeContent({ txnId: "PN1", amount: "200", currency: "KES", countryCode: "KE", status: "1", code: "0000", message: "ok", ...fields });
  return { content, sign: paynicornSign(content, secret) };
}

test("initiatePaynicornDeposit: a direct M-Pesa push keyed by our own tx id, never a cashier page", async () => {
  const repo = new InMemoryPaymentRepository();
  repo.seed("u1", 0);
  const sent: any[] = [];
  const paynicorn = new StubPaynicornClient("1");
  const pay = paynicorn.pay.bind(paynicorn);
  paynicorn.pay = async (a) => { sent.push(a); return pay(a); };
  const svc = new PaymentService(repo, daraja, { paynicorn });
  const out = await svc.initiatePaynicornDeposit("u1", 20_000, "+254 798 661 061");
  assert.equal(out.checkoutRequestId, out.txId);
  assert.deepEqual({ payMethod: sent[0].payMethod, phone: sent[0].phone, orderId: sent[0].orderId, frontPage: sent[0].frontPage },
    { payMethod: "MPESA", phone: "798661061", orderId: out.txId, frontPage: undefined }, "method + phone, no cashier page");
  const tx = await repo.getTransaction(out.txId);
  assert.equal(tx?.provider, "paynicorn");
  assert.equal(tx?.phone, "0798661061");
  assert.deepEqual((await repo.listUnsettledDeposits(0, 10, "paynicorn")).map((d) => d.checkoutRequestId), [out.txId]);
});

test("initiatePaynicornDeposit: floor, whole shillings and a missing client are refused", async () => {
  const { svc } = rig();
  await assert.rejects(svc.initiatePaynicornDeposit("u1", 9_900, "0798661061"), /BELOW_MIN/);
  await assert.rejects(svc.initiatePaynicornDeposit("u1", 20_050, "0798661061"), /INVALID_AMOUNT/);
  const bare = new PaymentService(new InMemoryPaymentRepository(), daraja);
  await assert.rejects(bare.initiatePaynicornDeposit("u1", 20_000, "0798661061"), /PAYNICORN_NOT_CONFIGURED/);
  await assert.rejects(svc.initiatePaynicornDeposit("u1", 20_000, "nope"), /INVALID_PHONE/);
});

test("paynicorn callback: a verified postback re-queries, credits exactly once, and returns the txnId", async () => {
  const { repo, svc } = rig("1");
  const { txId } = await svc.initiatePaynicornDeposit("u1", 20_000, "0798661061");
  const first = await svc.handlePaynicornCallback(postback({ orderId: txId }));
  assert.deepEqual(first, { txnId: "PN1", settled: true });
  assert.equal(await repo.getBalance("u1"), 20_000);
  const again = await svc.handlePaynicornCallback(postback({ orderId: txId }));
  assert.equal(again.settled, false, "a retried postback never credits twice");
  assert.equal(await repo.getBalance("u1"), 20_000);
});

test("paynicorn callback: forged signature is refused; the body's status never credits", async () => {
  const { repo, svc } = rig("-1"); // Paynicorn's own answer: still processing
  const { txId } = await svc.initiatePaynicornDeposit("u1", 20_000, "0798661061");
  await assert.rejects(svc.handlePaynicornCallback(postback({ orderId: txId }, "attacker-secret")), /PAYNICORN_BAD_SIGNATURE/);
  await assert.rejects(svc.handlePaynicornCallback({ orderId: txId, status: "1" }), /PAYNICORN_BAD_SIGNATURE/);
  // Signed "status 1", but the authoritative query says processing -> nothing moves.
  assert.deepEqual(await svc.handlePaynicornCallback(postback({ orderId: txId, status: "1" })), { txnId: "PN1", settled: false });
  assert.equal(await repo.getBalance("u1"), 0);
});

test("paynicorn callback: amount mismatch is never credited; unknown orders are acknowledged and ignored", async () => {
  const { repo, svc } = rig("1");
  const { txId } = await svc.initiatePaynicornDeposit("u1", 20_000, "0798661061");
  await assert.rejects(svc.handlePaynicornCallback(postback({ orderId: txId, amount: "50000" })), /PAYNICORN_AMOUNT_MISMATCH/);
  assert.equal(await repo.getBalance("u1"), 0);
  assert.deepEqual(await svc.handlePaynicornCallback(postback({ orderId: "console-check", txnId: "T0" })), { txnId: "T0", settled: false });
  assert.deepEqual(await svc.handlePaynicornCallback(postback({ orderId: "00000000-0000-0000-0000-000000000000", txnId: "T1" })), { txnId: "T1", settled: false });
});

test("paynicorn callback: a failed order is closed without credit", async () => {
  const { repo, svc } = rig("0");
  const { txId } = await svc.initiatePaynicornDeposit("u1", 20_000, "0798661061");
  assert.equal((await svc.handlePaynicornCallback(postback({ orderId: txId, status: "0" }))).settled, true);
  assert.equal((await repo.getTransaction(txId))?.status, "failed");
  assert.equal(await repo.getBalance("u1"), 0);
});

test("reconcilePaynicornDeposits settles a deposit whose postback never arrived", async () => {
  const { repo, svc, paynicorn } = rig("-1");
  await svc.initiatePaynicornDeposit("u1", 30_000, "0798661061");
  assert.deepEqual(await svc.reconcilePaynicornDeposits({ olderThanMs: 0 }), { scanned: 1, settled: 0, stillPending: 1, errors: 0 });
  paynicorn.queryStatus = "1";
  assert.equal((await svc.reconcilePaynicornDeposits({ olderThanMs: 0 })).settled, 1);
  assert.equal(await repo.getBalance("u1"), 30_000);
});

test("deposit methods: PayX is a plain M-Pesa tab, never a checkout channel or a named gateway", async () => {
  const { repo, svc } = rig();
  repo.setProviders([{ code: "paynicorn", displayName: "PayX" }]);
  assert.deepEqual((await svc.listDepositMethods()).map((m) => [m.id, m.channel, m.label]), [["paynicorn-stk", "stk", "M-Pesa"]]);
  const bare = new PaymentService(repo, daraja);
  assert.ok(!(await bare.listDepositMethods()).some((m) => m.provider === "paynicorn"), "no client => not offered");
});
