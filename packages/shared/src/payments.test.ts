import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeMsisdn, msisdnToE164, validateDeposit, validateWithdrawal, MIN_DEPOSIT_CENTS, MIN_WITHDRAWAL_CENTS } from "./payments.js";

test("normalizeMsisdn: accepts KE formats -> local 07../01..", () => {
  assert.equal(normalizeMsisdn("0712345678"), "0712345678");
  assert.equal(normalizeMsisdn("0112345678"), "0112345678");
  assert.equal(normalizeMsisdn("+254712345678"), "0712345678");
  assert.equal(normalizeMsisdn("254712345678"), "0712345678");
  assert.equal(normalizeMsisdn("712345678"), "0712345678");
  assert.equal(normalizeMsisdn(" 0712 345 678 "), "0712345678");
  assert.equal(normalizeMsisdn("0712-345-678"), "0712345678");
});

test("msisdnToE164: converts local -> 254 for the Daraja edge", () => {
  assert.equal(msisdnToE164("0712345678"), "254712345678");
  assert.equal(msisdnToE164("254712345678"), "254712345678");
  assert.equal(msisdnToE164("712345678"), "254712345678");
});

test("normalizeMsisdn: rejects invalid", () => {
  for (const bad of ["", "12345", "0812345678", "25471234567", "2547123456789", "07123abc78", "0612345678"]) {
    assert.throws(() => normalizeMsisdn(bad), /INVALID_PHONE/, `should reject ${bad}`);
  }
});

test("validateDeposit: integer cents, positive, >= min", () => {
  assert.deepEqual(validateDeposit(MIN_DEPOSIT_CENTS), { ok: true });
  assert.deepEqual(validateDeposit(50_000), { ok: true });
  assert.equal(validateDeposit(MIN_DEPOSIT_CENTS - 1).reason, "BELOW_MIN");
  assert.equal(validateDeposit(0).reason, "INVALID_AMOUNT");
  assert.equal(validateDeposit(-100).reason, "INVALID_AMOUNT");
  assert.equal(validateDeposit(100.5).reason, "NOT_INTEGER_CENTS");
});

test("validateWithdrawal: min, positive, integer, and <= balance", () => {
  assert.deepEqual(validateWithdrawal(MIN_WITHDRAWAL_CENTS, 100_000), { ok: true });
  assert.equal(validateWithdrawal(MIN_WITHDRAWAL_CENTS - 1, 100_000).reason, "BELOW_MIN");
  assert.equal(validateWithdrawal(50_000, 30_000).reason, "INSUFFICIENT_FUNDS");
  assert.equal(validateWithdrawal(0, 100_000).reason, "INVALID_AMOUNT");
  assert.equal(validateWithdrawal(20_000.5, 100_000).reason, "NOT_INTEGER_CENTS");
  assert.throws(() => validateWithdrawal(20_000, 100_000.5), /balance/);
});
