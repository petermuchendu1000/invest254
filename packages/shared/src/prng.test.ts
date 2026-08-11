import { test } from "node:test";
import assert from "node:assert/strict";
import { SeededRng } from "./prng.js";
import { DEFAULT_CONFIG, assertFeasible, rtp } from "./config.js";
import { kesToCents, formatKes, mulCents, subCents } from "./money.js";

test("PRNG is deterministic for same (seed,label)", () => {
  const a = new SeededRng("seed-x", "pos-1");
  const b = new SeededRng("seed-x", "pos-1");
  const seqA = Array.from({ length: 5 }, () => a.next());
  const seqB = Array.from({ length: 5 }, () => b.next());
  assert.deepEqual(seqA, seqB);
});

test("PRNG differs for different labels", () => {
  const a = new SeededRng("seed-x", "pos-1");
  const b = new SeededRng("seed-x", "pos-2");
  assert.notEqual(a.next(), b.next());
});

test("PRNG uniforms stay in [0,1) and refill across block boundary", () => {
  const r = new SeededRng("s", "l");
  for (let i = 0; i < 1000; i++) { const v = r.next(); assert.ok(v >= 0 && v < 1, `out of range: ${v}`); }
});

test("default config is feasible and RTP is 0.25", () => {
  assertFeasible(DEFAULT_CONFIG);
  assert.equal(rtp(DEFAULT_CONFIG), 0.25);
});

test("money helpers are exact", () => {
  assert.equal(kesToCents(50), 5000);
  assert.equal(formatKes(123450), "KES 1,234.50");
  assert.equal(mulCents(5000, 2.5), 12500);
  assert.throws(() => subCents(100, 200), RangeError);
});
