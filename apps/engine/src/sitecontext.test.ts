import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_VERSIONED_CONFIG, type VersionedGameConfig, type Direction } from "@invest254/shared";
import { buildSiteContext } from "./sitecontext.js";

const MASTER = "platform-master-xyz";
const SITE_A = "00000000-0000-0000-0000-000000000001";
const SITE_B = "00000000-0000-0000-0000-0000000000b2";
const DAY = "2026-02-10";
const SAMPLES = 30_000; // calibration sample count (kept modest for test speed)

// Site A: default economy (house edge 0.75 -> RTP 0.25).
const cfgA: VersionedGameConfig = { ...DEFAULT_VERSIONED_CONFIG, version: 1 };
// Site B: a much tighter economy (house edge 0.90 -> RTP 0.10), feasible win rate.
const cfgB: VersionedGameConfig = { ...DEFAULT_VERSIONED_CONFIG, version: 1, houseEdge: 0.90, targetWinRate: 0.05 };

/** Held-out realized RTP over many random entry times, both directions (hold-to-expiry). */
function realizedRtp(ctx: ReturnType<typeof buildSiteContext>, n = 40_000): number {
  const stake = 100_000;
  let paid = 0;
  const dirs: Direction[] = ["buy", "sell"];
  for (let i = 0; i < n; i++) {
    const entryT = Math.random() * 3600;
    const dir = dirs[i % 2]!;
    paid += ctx.settlement.settle(stake, dir, entryT).payoutCents;
  }
  return paid / (n * stake);
}

test("two brands get decorrelated curves from the same master + day", () => {
  const a = buildSiteContext({ masterSeed: MASTER, siteId: SITE_A, dateKey: DAY, cfg: cfgA, calibrationSamples: SAMPLES });
  const b = buildSiteContext({ masterSeed: MASTER, siteId: SITE_B, dateKey: DAY, cfg: cfgA, calibrationSamples: SAMPLES });
  assert.notEqual(a.seed, b.seed);
  assert.notEqual(a.seedHash, b.seedHash);
  // Sample the curve at many points; the two brands must not track each other.
  let diff = 0;
  for (let t = 0; t < 600; t += 3) diff += Math.abs(a.curve.value(t) - b.curve.value(t));
  assert.ok(diff / 200 > 0.05, `curves too similar (mean |Δ| ${(diff / 200).toFixed(4)})`);
});

test("each brand calibrates RTP to its OWN economy, independently", () => {
  const a = buildSiteContext({ masterSeed: MASTER, siteId: SITE_A, dateKey: DAY, cfg: cfgA, calibrationSamples: SAMPLES });
  const b = buildSiteContext({ masterSeed: MASTER, siteId: SITE_B, dateKey: DAY, cfg: cfgB, calibrationSamples: SAMPLES });
  const rtpA = realizedRtp(a);
  const rtpB = realizedRtp(b);
  // Site A ~ 0.25, Site B ~ 0.10 — each tracks its own config, well separated.
  assert.ok(Math.abs(rtpA - 0.25) < 0.04, `site A RTP ${rtpA.toFixed(3)} not ~0.25`);
  assert.ok(Math.abs(rtpB - 0.10) < 0.04, `site B RTP ${rtpB.toFixed(3)} not ~0.10`);
  assert.ok(rtpA > rtpB + 0.05, `brands' RTPs must be independent (A ${rtpA.toFixed(3)} vs B ${rtpB.toFixed(3)})`);
});

test("deterministic rebuild — crash-recovery equivalence per brand", () => {
  const a1 = buildSiteContext({ masterSeed: MASTER, siteId: SITE_A, dateKey: DAY, cfg: cfgA, calibrationSamples: SAMPLES });
  const a2 = buildSiteContext({ masterSeed: MASTER, siteId: SITE_A, dateKey: DAY, cfg: cfgA, calibrationSamples: SAMPLES });
  assert.equal(a1.seed, a2.seed);
  // Same committed outcome for a fixed (dir, entryT) — what recovery relies on.
  const o1 = a1.settlement.settle(100_000, "buy", 123.4);
  const o2 = a2.settlement.settle(100_000, "buy", 123.4);
  assert.deepEqual({ r: o1.result, p: o1.payoutCents }, { r: o2.result, p: o2.payoutCents });
});

test("forced seed rotation changes a brand's curve without touching others", () => {
  const base = buildSiteContext({ masterSeed: MASTER, siteId: SITE_A, dateKey: DAY, cfg: cfgA, calibrationSamples: SAMPLES });
  const rotated = buildSiteContext({ masterSeed: MASTER, siteId: SITE_A, dateKey: DAY, cfg: cfgA, seedVersion: 1, calibrationSamples: SAMPLES });
  assert.notEqual(base.seed, rotated.seed);
  assert.notEqual(base.curve.value(10), rotated.curve.value(10));
});

test("a per-brand master seed also fully decorrelates brands", () => {
  const a = buildSiteContext({ masterSeed: "master-A", siteId: SITE_A, dateKey: DAY, cfg: cfgA, calibrationSamples: SAMPLES });
  const b = buildSiteContext({ masterSeed: "master-B", siteId: SITE_A, dateKey: DAY, cfg: cfgA, calibrationSamples: SAMPLES });
  assert.notEqual(a.seed, b.seed);
});
