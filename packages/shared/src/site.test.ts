import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveSiteDaySeed, siteCommitment } from "./site.js";
import { deriveDaySeed, commitment } from "./seed.js";

const MASTER = "platform-master-seed-abc";
const SITE_A = "00000000-0000-0000-0000-000000000001";
const SITE_B = "00000000-0000-0000-0000-0000000000b2";
const DAY = "2026-01-15";

test("deriveSiteDaySeed is deterministic in (master, site, day, version)", () => {
  assert.equal(deriveSiteDaySeed(MASTER, SITE_A, DAY), deriveSiteDaySeed(MASTER, SITE_A, DAY));
  assert.equal(deriveSiteDaySeed(MASTER, SITE_A, DAY, 3), deriveSiteDaySeed(MASTER, SITE_A, DAY, 3));
});

test("different sites get UNCORRELATED seeds from the same master + day", () => {
  const a = deriveSiteDaySeed(MASTER, SITE_A, DAY);
  const b = deriveSiteDaySeed(MASTER, SITE_B, DAY);
  assert.notEqual(a, b, "two brands must not share a day seed");
  // hex, 64 chars (sha256), and no trivial prefix overlap
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.match(b, /^[0-9a-f]{64}$/);
  assert.notEqual(a.slice(0, 16), b.slice(0, 16));
});

test("different days and versions decorrelate within a site", () => {
  const d1 = deriveSiteDaySeed(MASTER, SITE_A, "2026-01-15");
  const d2 = deriveSiteDaySeed(MASTER, SITE_A, "2026-01-16");
  const v1 = deriveSiteDaySeed(MASTER, SITE_A, DAY, 1);
  assert.notEqual(d1, d2, "different day -> different seed");
  assert.notEqual(d1, v1, "forced rotation (version) -> different seed");
});

test("a per-brand master seed also decorrelates brands", () => {
  const a = deriveSiteDaySeed("master-brand-a", SITE_A, DAY);
  const b = deriveSiteDaySeed("master-brand-b", SITE_A, DAY);
  assert.notEqual(a, b);
});

test("siteCommitment matches the single-tenant commitment construction (sha256 hex)", () => {
  const seed = deriveSiteDaySeed(MASTER, SITE_A, DAY);
  assert.equal(siteCommitment(seed), commitment(seed));
  assert.match(siteCommitment(seed), /^[0-9a-f]{64}$/);
});

test("guards: empty master/site and bad date/version throw", () => {
  assert.throws(() => deriveSiteDaySeed("", SITE_A, DAY));
  assert.throws(() => deriveSiteDaySeed(MASTER, "", DAY));
  assert.throws(() => deriveSiteDaySeed(MASTER, SITE_A, "15-01-2026"));
  assert.throws(() => deriveSiteDaySeed(MASTER, SITE_A, DAY, -1));
});

test("site version 0 differs from the single-tenant (no-site) day seed", () => {
  // A brand's seed must never collide with the legacy single-tenant lineage.
  assert.notEqual(deriveSiteDaySeed(MASTER, SITE_A, DAY, 0), deriveDaySeed(MASTER, DAY, 0));
});
