import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { DEFAULT_VERSIONED_CONFIG, TIMEFRAMES, valueOfRate, type VersionedGameConfig } from "@invest254/shared";
import { InMemoryGameRepository } from "./wallet.js";
import { StaticConfigProvider } from "./gameconfig.js";
import { SiteRegistry } from "./siteregistry.js";
import { startMultiEngine, type MultiEngineHandle } from "./multiengine.js";
import { MAX_BARS } from "./markethistory.js";

/**
 * The candle feed over the wire (Step 2 of the MT5 chart work).
 *
 * Covers the protocol rather than the maths — markethistory.test.ts owns the series itself. What
 * matters here: a candlestick brand can fetch bars and page backwards, a line brand is told plainly
 * that it has none, bad input is rejected instead of guessed at, and the anchor shipped with the
 * bars really does place a live tick on the same axis.
 */

const CANDLE_SITE = "00000000-0000-0000-0000-0000000000c1";
const LINE_SITE = "00000000-0000-0000-0000-0000000000c2";
const cfg: VersionedGameConfig = { ...DEFAULT_VERSIONED_CONFIG, version: 1, defaultDurationS: 1, tickRateMs: 60 };

class Client {
  ws: WebSocket;
  constructor(url: string) { this.ws = new WebSocket(url); }
  open(): Promise<void> { return new Promise((res, rej) => { this.ws.once("open", () => res()); this.ws.once("error", rej); }); }
  /** Send a request and resolve on the first reply of `type` (or an `error`, so a test fails fast). */
  ask(type: string, data: unknown, expect: string, timeoutMs = 20_000): Promise<any> {
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`timeout waiting for ${expect}`)), timeoutMs);
      const h = (raw: any) => {
        let m: any; try { m = JSON.parse(String(raw)); } catch { return; }
        if (m.type !== expect && m.type !== "error") return;
        clearTimeout(t); this.ws.off("message", h); res(m);
      };
      this.ws.on("message", h);
      this.ws.send(JSON.stringify({ type, data }));
    });
  }
  /** Resolve on the next message of `type` (for pushed events like the tick stream). */
  next(type: string, timeoutMs = 20_000): Promise<any> {
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`timeout waiting for ${type}`)), timeoutMs);
      const h = (raw: any) => {
        let m: any; try { m = JSON.parse(String(raw)); } catch { return; }
        if (m.type !== type) return;
        clearTimeout(t); this.ws.off("message", h); res(m);
      };
      this.ws.on("message", h);
    });
  }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

async function boot(): Promise<{ handle: MultiEngineHandle; url: (site: string) => string }> {
  const repo = new InMemoryGameRepository();
  const registry = new SiteRegistry({
    masterSeed: "candles-master-test",
    repo,
    configFor: () => new StaticConfigProvider(cfg),
    seedManagerOpts: { calibrationSamples: 4000 },
    // Only the candlestick brand gets a market curve; the other draws the line wave.
    curveProfileFor: (siteId) => (siteId === LINE_SITE ? "wave" : "market"),
  });
  const handle = await startMultiEngine({
    port: 0,
    registry,
    repo,
    verifier: null,
    resolveSite: (req) => {
      const s = new URL(req.url ?? "/", "http://x").searchParams.get("site");
      if (!s) throw new Error("no site");
      return s;
    },
    onError: () => { /* quiet in tests */ },
  });
  const port = (handle.wss.address() as { port: number }).port;
  return { handle, url: (site) => `ws://127.0.0.1:${port}/?site=${site}` };
}

test("WS candles: a candlestick brand gets closed bars, newest last", async () => {
  const { handle, url } = await boot();
  const c = new Client(url(CANDLE_SITE));
  try {
    await c.open();
    const m = await c.ask("candles", { tf: "M15", count: 120 }, "candles");
    assert.equal(m.type, "candles", `unexpected error: ${JSON.stringify(m.data)}`);
    assert.equal(m.data.tf, "M15");
    assert.equal(m.data.instrument.symbol, "XAUUSD");
    assert.equal(m.data.instrument.digits, 2);
    assert.equal(m.data.bars.length, 120);
    const bars = m.data.bars;
    for (let i = 1; i < bars.length; i++) {
      assert.equal(bars[i].time - bars[i - 1].time, TIMEFRAMES.M15, `bucket width wrong at ${i}`);
      assert.ok(bars[i].high >= bars[i].low, `inverted bar at ${i}`);
    }
    const nowS = Math.floor(Date.now() / 1000);
    assert.ok(bars.at(-1).time + TIMEFRAMES.M15 <= nowS, "served a bar that has not closed");
  } finally { c.close(); await handle.close(); }
});

test("WS candles: `to` pages backwards and the pages join up without gaps or overlap", async () => {
  const { handle, url } = await boot();
  const c = new Client(url(CANDLE_SITE));
  try {
    await c.open();
    const first = (await c.ask("candles", { tf: "H1", count: 50 }, "candles")).data.bars;
    const older = (await c.ask("candles", { tf: "H1", count: 50, to: first[0].time }, "candles")).data.bars;
    assert.equal(older.length, 50);
    // The older page must end exactly one bucket before the newer page begins.
    assert.ok(older.at(-1).time < first[0].time, "older page overlaps the newer one");
    assert.equal(first[0].time - older.at(-1).time, TIMEFRAMES.H1, "a bar is missing between the pages");
  } finally { c.close(); await handle.close(); }
});

test("WS candles: the anchor places a live tick on the same axis as the bars", async () => {
  // The forming candle is built client-side from the tick stream. If the anchor were wrong it would
  // sit at a different level from the history beside it — the most visible possible bug.
  const { handle, url } = await boot();
  const c = new Client(url(CANDLE_SITE));
  try {
    await c.open();
    const m = await c.ask("candles", { tf: "M1", count: 5 }, "candles");
    const { anchor, instrument, bars } = m.data;
    assert.equal(m.type, "candles", `unexpected error: ${JSON.stringify(m.data)}`);

    // Take a real tick off the live stream and price it exactly as the client will.
    const tick = await c.next("tick");
    const priced = anchor.base + instrument.scale * (valueOfRate(tick.data.rate) - anchor.openValue);

    // It must land on the bars' axis. The last CLOSED minute ended moments ago, so the live price
    // can only have moved by about one minute of the walk — a point or two on this symbol.
    const last = bars.at(-1);
    assert.ok(
      Math.abs(priced - last.close) < 15,
      `live tick priced ${priced.toFixed(2)} but the last bar closed at ${last.close} — the anchor does not match the bars`,
    );
  } finally { c.close(); await handle.close(); }
});

test("WS candles: a line brand is told it has no candles rather than given empty ones", async () => {
  const { handle, url } = await boot();
  const c = new Client(url(LINE_SITE));
  try {
    await c.open();
    const m = await c.ask("candles", { tf: "M15", count: 10 }, "candles");
    assert.equal(m.type, "error");
    assert.equal(m.data.code, "NO_CANDLES");
  } finally { c.close(); await handle.close(); }
});

test("WS candles: bad input is rejected, and an oversized count is clamped not refused", async () => {
  const { handle, url } = await boot();
  const c = new Client(url(CANDLE_SITE));
  try {
    await c.open();
    assert.equal((await c.ask("candles", { tf: "H5", count: 10 }, "candles")).data.code, "BAD_TIMEFRAME");
    assert.equal((await c.ask("candles", { tf: "M1", count: 0 }, "candles")).data.code, "BAD_COUNT");
    assert.equal((await c.ask("candles", { tf: "M1", count: -5 }, "candles")).data.code, "BAD_COUNT");
    assert.equal((await c.ask("candles", { tf: "M1", count: 10, to: "soon" }, "candles")).data.code, "BAD_TO");
    const big = await c.ask("candles", { tf: "M1", count: MAX_BARS * 4 }, "candles");
    assert.equal(big.type, "candles");
    assert.ok(big.data.bars.length <= MAX_BARS, `expected a clamp, got ${big.data.bars.length} bars`);
  } finally { c.close(); await handle.close(); }
});
