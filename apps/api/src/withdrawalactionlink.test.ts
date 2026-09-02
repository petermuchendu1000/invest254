import { test } from "node:test";
import assert from "node:assert/strict";
import { signWithdrawalAction, verifyWithdrawalAction } from "./withdrawalactionlink.js";

const S = "a-sufficiently-long-test-secret-000000";

test("action link: sign -> verify round-trip", () => {
  assert.deepEqual(verifyWithdrawalAction(signWithdrawalAction("tx-1", "approve", S), S), { txId: "tx-1", action: "approve" });
  assert.deepEqual(verifyWithdrawalAction(signWithdrawalAction("tx-9", "reject", S), S), { txId: "tx-9", action: "reject" });
});

test("action link: wrong secret is rejected", () => {
  assert.equal(verifyWithdrawalAction(signWithdrawalAction("tx-1", "approve", S), "different-secret"), null);
});

test("action link: tampered payload/signature is rejected", () => {
  const tok = signWithdrawalAction("tx-1", "approve", S);
  const flipped = tok.slice(0, -1) + (tok.at(-1) === "A" ? "B" : "A");
  assert.equal(verifyWithdrawalAction(flipped, S), null);
  // swap the payload for a different tx but keep the old signature -> must fail
  const other = signWithdrawalAction("tx-2", "approve", S).split(".")[0];
  assert.equal(verifyWithdrawalAction(`${other}.${tok.split(".")[1]}`, S), null);
});

test("action link: expired token is rejected", () => {
  assert.equal(verifyWithdrawalAction(signWithdrawalAction("tx-1", "reject", S, -1000), S), null);
});

test("action link: malformed tokens are rejected (no throw)", () => {
  for (const bad of ["", "garbage", "a.b", ".", "onlyonepart"]) {
    assert.equal(verifyWithdrawalAction(bad, S), null);
  }
});
