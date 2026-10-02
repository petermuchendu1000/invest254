import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_VERSIONED_CONFIG, deriveSiteDaySeed, dateKeyUTC, dayStartMs, CurveGenerator,
  valueOfRate, XAUUSD, DAY_S, TIMEFRAMES, type Timeframe,
} from "@invest254/shared";
import { MarketHistory, HISTORY_DAYS, MAX_BARS } from "./markethistory.js";

const MASTER = "history-master-seed";
const SITE_A = "00000000-0000-0000-0000-0000000000a1";
const SITE_B = "00000000-0000-0000-0000-0000000000b2";
/** Fixed "now" so every assertion is reproducible: Wed 18 Mar 2026, 13:47:29Z. */
const NOW = Date.UTC(2026, 2, 18, 13, 47, 29);

const build = (siteId = SITE_A, now = () => NOW) =>
  new MarketHistory((dateKey) => deriveSiteDaySeed(MASTER, siteId, dateKey, 0), () => DEFAULT_VERSIONED_CONFIG, { now });

test("returns the requested number of bars, newest last, strictly ascending", () => {
  const h = build();
  for (const [tf, want] of [["M1", 300], ["M15", 200], ["H1", 150], ["H4", 90], ["D1", 60]] as Array<[Timeframe, number]>) {
    const bars = h.candles(tf, want);
    assert.equal(bars.length, want, `${tf} returned ${bars.length}`);
    for (let i = 1; i < bars.length; i++) {
      assert.ok(bars[i]!.time > bars[i - 1]!.time, `${tf} not ascending at ${i}`);
      assert.ok(bars[i]!.high >= bars[i]!.low, `${tf} inverted bar at ${i}`);
    }
    // Buckets must be exactly one period apart for the fixed-width timeframes.
    if (tf !== "D1") {
      for (let i = 1; i < bars.length; i++) {
        assert.equal(bars[i]!.time - bars[i - 1]!.time, TIMEFRAMES[tf], `${tf} bucket width wrong at ${i}`);
      }
    }
  }
});

test("never returns a bar that has not closed yet", () => {
  // A forming candle drawn as a finished one would show a false high/low and a false close. The live
  // tick stream owns the current bar; history must stop at the last CLOSED one.
  const h = build();
  const nowS = Math.floor(NOW / 1000);
  for (const tf of ["M1", "M15", "H1", "D1"] as Timeframe[]) {
    const last = h.candles(tf, 10).at(-1)!;
    const width = tf === "D1" ? DAY_S : TIMEFRAMES[tf];
    assert.ok(last.time + width <= nowS, `${tf} returned a bar closing at ${last.time + width} > now ${nowS}`);
  }
});

test("history is CONTINUOUS across the UTC midnight reseed", () => {
  // The curve restarts from a fresh seed every day. Chaining the bases is what stops the chart from
  // jumping at midnight; without it the price would snap by tens of points every day.
  const h = build();
  const bars = h.candles("H1", 24 * 5);
  let worst = 0;
  for (let i = 1; i < bars.length; i++) worst = Math.max(worst, Math.abs(bars[i]!.open - bars[i - 1]!.close));
  // A single H1 bar's own range is several points; a rollover must not stand out against that.
  assert.ok(worst < 1.5, `discontinuity of ${worst.toFixed(2)} points across a boundary`);
});

test("timeframes agree with each other — H4 is exactly its four H1 bars", () => {
  const h = build();
  const h1 = h.candles("H1", 400);
  const h4 = h.candles("H4", 100);
  const byStart = new Map(h4.map((b) => [b.time, b]));
  let checked = 0;
  for (const [start, bar] of byStart) {
    const parts = h1.filter((b) => b.time >= start && b.time < start + 14_400);
    if (parts.length !== 4) continue; // edge buckets not fully covered by the H1 window
    checked++;
    assert.equal(bar.open, parts[0]!.open, `H4 ${start} open`);
    assert.equal(bar.close, parts[3]!.close, `H4 ${start} close`);
    assert.equal(bar.high, Math.max(...parts.map((p) => p.high)), `H4 ${start} high`);
    assert.equal(bar.low, Math.min(...parts.map((p) => p.low)), `H4 ${start} low`);
  }
  assert.ok(checked > 50, `expected many fully-covered H4 buckets, checked ${checked}`);
});

test("history matches the LIVE curve exactly — the chart cannot disagree with settlement", () => {
  // This is the fairness-critical one. A candle is only honest if it is the same seeded path the
  // settlement engine scores. Recompute a past minute straight from that day's curve and require the
  // stored bar to match it to the tick.
  const h = build();
  const bars = h.candles("M1", 2000);
  const anchorDay = dateKeyUTC(NOW);
  const checkKeys = new Set(bars.map((b) => dateKeyUTC(b.time * 1000)));
  assert.ok(checkKeys.size >= 2, "window must span more than one seeded day to be a real test");

  for (const dateKey of checkKeys) {
    const curve = new CurveGenerator(deriveSiteDaySeed(MASTER, SITE_A, dateKey, 0), DEFAULT_VERSIONED_CONFIG, "market");
    const dayStartS = dayStartMs(dateKey) / 1000;
    const open0 = curve.value(0);
    const inDay = bars.filter((b) => dateKeyUTC(b.time * 1000) === dateKey);
    // The day's base is implied by its first bar; every other bar must follow from the same curve.
    const first = inDay[0]!;
    const base = first.open - XAUUSD.scale * (curve.value(first.time - dayStartS) - open0);
    for (const b of inDay) {
      const t = b.time - dayStartS;
      const expected = Math.round((base + XAUUSD.scale * (curve.value(t) - open0)) * 100) / 100;
      assert.ok(Math.abs(b.open - expected) <= 0.011, `${dateKey} t=${t}: bar open ${b.open} vs curve ${expected}`);
    }
  }
  assert.ok(anchorDay.length === 10);
});

test("a tick priced through liveAnchor lands on the history's price axis", () => {
  // The live stream sends `rate`; the chart must place it on the same axis as the fetched candles,
  // or the forming candle would sit at a different level from the one beside it.
  const h = build();
  const { dateKey, base, openValue, instrument } = h.liveAnchor(NOW);
  const curve = new CurveGenerator(deriveSiteDaySeed(MASTER, SITE_A, dateKey, 0), DEFAULT_VERSIONED_CONFIG, "market");
  const bars = h.candles("M1", 5);
  const last = bars.at(-1)!;
  const t = last.time - dayStartMs(dateKey) / 1000;
  // Price the tick the way the client will: from the rate it receives, not from the curve directly.
  const fromTick = base + instrument.scale * (valueOfRate(curve.rate(t)) - openValue);
  assert.ok(Math.abs(fromTick - last.open) <= 0.011, `tick priced ${fromTick.toFixed(2)} vs bar open ${last.open}`);
});

test("brands get independent histories from the same master seed", () => {
  const a = build(SITE_A).candles("H1", 120);
  const b = build(SITE_B).candles("H1", 120);
  assert.equal(a.length, b.length);
  let same = 0;
  for (let i = 0; i < a.length; i++) if (a[i]!.close === b[i]!.close) same++;
  assert.ok(same < a.length * 0.05, `brands share ${same}/${a.length} closes`);
});

test("deterministic: the same brand and clock rebuild byte-identical history", () => {
  assert.deepEqual(build().candles("M15", 200), build().candles("M15", 200));
});

test("request size is capped, and the reach back is bounded by HISTORY_DAYS", () => {
  const h = build();
  assert.ok(h.candles("M1", 10 * MAX_BARS).length <= MAX_BARS, "an oversized request must be clamped");
  assert.ok(h.candles("M1", 0).length >= 1, "a non-positive count must still return something sane");
  // D1 cannot reach further back than the chain exists.
  assert.ok(h.candles("D1", HISTORY_DAYS + 500).length <= HISTORY_DAYS + 1, "reached past the chain");
  assert.ok(h.candles("D1", HISTORY_DAYS).length > 360, "a year of daily bars must be available");
});

test("a year of daily history builds in a reasonable time and caches", () => {
  // The whole reason the curve moved to a bulk keystream. If this regresses, scrolling the chart
  // back a year stalls the engine's event loop for a minute.
  const h = build();
  const t0 = Date.now();
  const first = h.candles("D1", 365).length;
  const cold = Date.now() - t0;
  const t1 = Date.now();
  h.candles("D1", 365);
  const warm = Date.now() - t1;
  assert.ok(first > 360, `expected a year of bars, got ${first}`);
  assert.ok(cold < 20_000, `cold year took ${cold}ms`);
  assert.ok(warm < cold / 2 + 50, `warm year (${warm}ms) should be far cheaper than cold (${cold}ms)`);
});
