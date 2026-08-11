import { test } from "node:test";
import assert from "node:assert/strict";
import {
  base32Encode, base32Decode, totpCode, verifyTotp, generateTotpSecret,
  generateRecoveryCodes, normalizeRecoveryCode, otpauthUrl,
} from "./totp.js";

// RFC 6238 appendix B vectors (HMAC-SHA1, 30s step, secret = ASCII "12345678901234567890").
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

test("totp: matches the RFC 6238 SHA-1 test vectors (8 digits)", () => {
  const vectors: Array<[number, string]> = [
    [59, "94287082"],
    [1_111_111_109, "07081804"],
    [1_111_111_111, "14050471"],
    [1_234_567_890, "89005924"],
    [2_000_000_000, "69279037"],
    [20_000_000_000, "65353130"], // counter > 2^32 exercises the 64-bit counter packing
  ];
  for (const [seconds, expected] of vectors) {
    assert.equal(totpCode(RFC_SECRET, { nowMs: seconds * 1000, digits: 8 }), expected, `T=${seconds}`);
  }
});

test("totp: 6-digit code is the low-order slice of the RFC vector", () => {
  assert.equal(totpCode(RFC_SECRET, { nowMs: 59_000 }), "287082");
});

test("base32: round-trips arbitrary bytes and rejects invalid characters", () => {
  const buf = Buffer.from("12345678901234567890");
  assert.deepEqual(base32Decode(base32Encode(buf)), buf);
  assert.deepEqual(base32Decode(base32Encode(Buffer.from([0, 1, 2, 250, 255]))), Buffer.from([0, 1, 2, 250, 255]));
  assert.throws(() => base32Decode("!!!"), /INVALID_BASE32/);
});

test("verifyTotp: accepts current code, tolerates +/-1 step, rejects beyond the window", () => {
  const secret = generateTotpSecret();
  const now = 1_700_000_000_000;
  assert.equal(verifyTotp(secret, totpCode(secret, { nowMs: now }), { nowMs: now }), true);
  // clock skew of one step in either direction is tolerated
  assert.equal(verifyTotp(secret, totpCode(secret, { nowMs: now - 30_000 }), { nowMs: now }), true);
  assert.equal(verifyTotp(secret, totpCode(secret, { nowMs: now + 30_000 }), { nowMs: now }), true);
  // three steps away is outside the default window
  assert.equal(verifyTotp(secret, totpCode(secret, { nowMs: now + 90_000 }), { nowMs: now }), false);
  // malformed input fails closed rather than throwing
  assert.equal(verifyTotp(secret, "12345", { nowMs: now }), false);
  assert.equal(verifyTotp(secret, "abcdef", { nowMs: now }), false);
  assert.equal(verifyTotp(secret, "", { nowMs: now }), false);
});

test("recovery codes: unique, well-formed, and normalized case/dash-insensitively", () => {
  const codes = generateRecoveryCodes(8);
  assert.equal(codes.length, 8);
  assert.equal(new Set(codes).size, 8);
  for (const c of codes) assert.match(c, /^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
  // Note: base32 has no 0/1/8/9, so those are stripped as noise rather than treated as digits.
  assert.equal(normalizeRecoveryCode("k7qf2-4ztmr"), "K7QF24ZTMR");
  assert.equal(normalizeRecoveryCode(" K7QF2 4ZTMR "), "K7QF24ZTMR");
  assert.equal(normalizeRecoveryCode("k7qf2-9ztmr"), "K7QF2ZTMR");
});

test("otpauthUrl: encodes the issuer/account label and TOTP parameters", () => {
  const url = otpauthUrl({ secret: "ABCDEF", account: "254712345678", issuer: "Invest254" });
  assert.match(url, /^otpauth:\/\/totp\/Invest254:254712345678\?/);
  assert.match(url, /secret=ABCDEF/);
  assert.match(url, /digits=6/);
  assert.match(url, /period=30/);
});
