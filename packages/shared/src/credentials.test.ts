import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePassword, validateUsername } from "./credentials.js";

test("validatePassword: accepts a strong-enough password", () => {
  assert.deepEqual(validatePassword("hunter2pass"), { ok: true });
});

test("validatePassword: rejects short / missing letter / missing digit / oversized", () => {
  assert.equal(validatePassword("ab1").reason, "TOO_SHORT");
  assert.equal(validatePassword("12345678").reason, "NEEDS_LETTER");
  assert.equal(validatePassword("abcdefgh").reason, "NEEDS_DIGIT");
  assert.equal(validatePassword("a1" + "x".repeat(200)).reason, "TOO_LONG");
  assert.equal(validatePassword(12345678 as unknown).reason, "INVALID");
});

test("validateUsername: accepts valid handles", () => {
  for (const u of ["njeri", "wanjiru.ke", "trader_01", "abc"]) assert.deepEqual(validateUsername(u), { ok: true });
});

test("validateUsername: rejects bad length / charset / edge dots", () => {
  assert.equal(validateUsername("ab").reason, "TOO_SHORT");
  assert.equal(validateUsername("x".repeat(21)).reason, "TOO_LONG");
  assert.equal(validateUsername(".njeri").reason, "INVALID_CHARS");
  assert.equal(validateUsername("njeri_").reason, "INVALID_CHARS");
  assert.equal(validateUsername("a b").reason, "INVALID_CHARS");
  assert.equal(validateUsername("hac@ker").reason, "INVALID_CHARS");
});

import { validateReferralCode, REFERRAL_CODE_ALPHABET, REFERRAL_CODE_LENGTH } from "./credentials.js";

test("validateReferralCode: normalizes (trim + upper) and accepts the canonical alphabet", () => {
  const r = validateReferralCode("  4u7vrsca  ");
  assert.deepEqual(r, { ok: true, code: "4U7VRSCA" });
  const full = REFERRAL_CODE_ALPHABET.slice(0, REFERRAL_CODE_LENGTH);
  assert.equal(validateReferralCode(full).ok, true);
});

test("validateReferralCode: rejects wrong length, ambiguous/illegal chars, and non-strings", () => {
  assert.equal((validateReferralCode("ABC123") as { reason: string }).reason, "INVALID_LENGTH");
  assert.equal((validateReferralCode("ABCDEFGHI") as { reason: string }).reason, "INVALID_LENGTH");
  assert.equal((validateReferralCode("4U7VRSC0") as { reason: string }).reason, "INVALID_CHARS");
  assert.equal((validateReferralCode("4U7VRSCI") as { reason: string }).reason, "INVALID_CHARS");
  assert.equal((validateReferralCode("4U7VRS-A") as { reason: string }).reason, "INVALID_CHARS");
  assert.equal((validateReferralCode(12345678 as unknown) as { reason: string }).reason, "INVALID");
});
