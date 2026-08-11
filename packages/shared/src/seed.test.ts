import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { dateKeyUTC, dayStartMs, deriveDaySeed, commitment } from "./seed.js";

test("dateKeyUTC: UTC calendar day, boundary-correct, timezone-independent", () => {
  assert.equal(dateKeyUTC(0), "1970-01-01");
  assert.equal(dateKeyUTC(Date.parse("2026-06-18T00:00:00.000Z")), "2026-06-18");
  // one ms before midnight UTC is still the previous day
  assert.equal(dateKeyUTC(Date.parse("2026-06-18T00:00:00.000Z") - 1), "2026-06-17");
  // last instant of the day
  assert.equal(dateKeyUTC(Date.parse("2026-06-18T23:59:59.999Z")), "2026-06-18");
  assert.throws(() => dateKeyUTC(Number.NaN), /invalid epoch ms/);
});

test("dayStartMs: UTC midnight, round-trips with dateKeyUTC", () => {
  const ms = dayStartMs("2026-06-18");
  assert.equal(ms, Date.parse("2026-06-18T00:00:00.000Z"));
  assert.equal(dateKeyUTC(ms), "2026-06-18");
  assert.equal(ms % 86_400_000, 0); // exact day boundary
  assert.throws(() => dayStartMs("2026-6-18"), /invalid date key/);
  assert.throws(() => dayStartMs("not-a-date"), /invalid date key/);
});

test("deriveDaySeed: deterministic, equals HMAC-SHA256(master,'day:'+key), distinct per day/master", () => {
  const master = "master-seed-xyz";
  const a = deriveDaySeed(master, "2026-06-18");
  const expected = createHmac("sha256", master).update("day:2026-06-18").digest("hex");
  assert.equal(a, expected);
  assert.equal(deriveDaySeed(master, "2026-06-18"), a); // deterministic
  assert.notEqual(deriveDaySeed(master, "2026-06-19"), a); // different day
  assert.notEqual(deriveDaySeed("other-master", "2026-06-18"), a); // different master
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.throws(() => deriveDaySeed("", "2026-06-18"), /masterSeed is required/);
  assert.throws(() => deriveDaySeed(master, "bad"), /invalid date key/);
});

test("deriveDaySeed: forced rotation (version) is backward-compatible and distinct per version (J5)", () => {
  const master = "master-seed-xyz";
  const base = deriveDaySeed(master, "2026-06-18");
  // version 0 is the canonical label -> byte-identical to the unversioned call (every prior commitment stays valid)
  assert.equal(deriveDaySeed(master, "2026-06-18", 0), base);
  // each bumped version derives an entirely different, deterministic seed
  const v1 = deriveDaySeed(master, "2026-06-18", 1);
  const v2 = deriveDaySeed(master, "2026-06-18", 2);
  assert.notEqual(v1, base);
  assert.notEqual(v2, v1);
  assert.equal(v1, createHmac("sha256", master).update("day:2026-06-18#1").digest("hex"));
  assert.equal(deriveDaySeed(master, "2026-06-18", 1), v1); // deterministic
  assert.match(v1, /^[0-9a-f]{64}$/);
  assert.throws(() => deriveDaySeed(master, "2026-06-18", -1), /invalid seed version/);
  assert.throws(() => deriveDaySeed(master, "2026-06-18", 1.5), /invalid seed version/);
});

test("commitment: equals SHA-256(seed) hex — matches DB reveal check encode(digest(seed,'sha256'),'hex')", () => {
  const seed = deriveDaySeed("m", "2026-06-18");
  const c = commitment(seed);
  assert.equal(c, createHash("sha256").update(seed).digest("hex"));
  assert.match(c, /^[0-9a-f]{64}$/);
  assert.throws(() => commitment(""), /seed is required/);
});
