import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, DEFAULT_VERSIONED_CONFIG, checkFeasible, type VersionedGameConfig } from "@invest254/shared";
import { GameConfigStore, StaticConfigProvider, affectsPricing, configDiff, mapConfigRow } from "./gameconfig.js";
import { InMemoryGameRepository, type Querier } from "./wallet.js";
import { SeedManager } from "./daycontext.js";
import { GameServer } from "./game.js";
import { RecoveryService } from "./recovery.js";

/** Build a `game_config`-shaped DB row from a partial override. */
function row(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    house_edge: "0.75", max_multiplier: "5.0", min_stake: "5000", max_stake: "5000000",
    min_withdrawal: "25000", default_duration_s: 10, tick_rate_ms: 150, drift_bias: "0.3", volatility: "1.0",
    target_win_rate: "0.125", version: "1", ...over,
  };
}

/**
 * Fake Querier backed by a mutable current row + a version history table, mirroring the
 * shape migration 0028 creates. Lets us drive the store without a live database.
 */
function fakeDb(initial = row()) {
  const state = { current: initial, history: new Map<number, Record<string, unknown>>() };
  state.history.set(Number(initial.version), initial);
  const q: Querier = {
    async query(text: string, params: unknown[]) {
      if (text.includes("from game_config_versions")) {
        const v = Number(params[0]);
        const hit = state.history.get(v);
        return { rows: hit ? [hit] : [] };
      }
      if (text.includes("from game_config")) return { rows: [state.current] };
      return { rows: [] };
    },
  };
  const save = (over: Record<string, unknown>) => {
    const next = { ...state.current, ...over, version: String(Number(state.current.version) + 1) };
    state.current = next;
    state.history.set(Number(next.version), next);
    return next;
  };
  return { q, state, save };
}

// ── The regression this whole feature exists to prevent ───────────────────────────────────

test("config store: loads the DATABASE row, not the hardcoded DEFAULT_CONFIG", async () => {
  // Deliberately every field different from DEFAULT_CONFIG. Before migration 0028 the engine
  // booted from DEFAULT_CONFIG and ignored all of this.
  const { q } = fakeDb(row({
    house_edge: "0.05", max_multiplier: "12", min_stake: "10000", max_stake: "9900000",
    default_duration_s: 30, tick_rate_ms: 300, drift_bias: "0", volatility: "1.4",
    target_win_rate: "0.2", version: "9",
  }));
  const store = new GameConfigStore(q, { pollMs: 0 });
  const cfg = await store.init();
  try {
    assert.equal(cfg.version, 9);
    assert.equal(cfg.houseEdge, 0.05);
    assert.equal(cfg.maxMultiplier, 12);
    assert.equal(cfg.minStakeCents, 10000);
    assert.equal(cfg.maxStakeCents, 9900000);
    assert.equal(cfg.defaultDurationS, 30);
    assert.equal(cfg.tickRateMs, 300);
    assert.equal(cfg.driftBias, 0);
    assert.equal(cfg.volatility, 1.4);
    assert.equal(cfg.targetWinRate, 0.2);
    assert.notDeepEqual({ ...cfg, version: undefined }, { ...DEFAULT_CONFIG, version: undefined });
  } finally { store.stop(); }
});

test("config store: refresh picks up a saved change and notifies subscribers", async () => {
  const { q, save } = fakeDb();
  const store = new GameConfigStore(q, { pollMs: 0 });
  await store.init();
  try {
    const seen: { from: number; to: number; tick: number }[] = [];
    store.subscribe((next, prev) => seen.push({ from: prev.version, to: next.version, tick: next.tickRateMs }));

    save({ tick_rate_ms: 500, min_stake: "7500" });
    await store.refresh();

    assert.equal(store.active().version, 2);
    assert.equal(store.active().tickRateMs, 500);
    assert.equal(store.active().minStakeCents, 7500);
    assert.deepEqual(seen, [{ from: 1, to: 2, tick: 500 }]);

    // Re-reading the same version must not re-notify (idempotent poll).
    await store.refresh();
    assert.equal(seen.length, 1);
  } finally { store.stop(); }
});

test("config store: an infeasible config is rejected and the last good one stays live", async () => {
  const { q, save } = fakeDb();
  const errors: string[] = [];
  const store = new GameConfigStore(q, { pollMs: 0, onError: (e) => errors.push(e.message) });
  await store.init();
  try {
    // RTP 0.25 at a 0.01 win rate needs a mean winning multiple of 25 -- above the cap of 5.
    save({ target_win_rate: "0.01" });
    await store.refresh();

    assert.equal(store.active().version, 1, "engine must keep serving the last solvable config");
    assert.equal(store.active().targetWinRate, 0.125);
    assert.equal(errors.length, 1);
    assert.match(errors[0]!, /rejected game_config v2/);
    assert.match(errors[0]!, /infeasible/);
  } finally { store.stop(); }
});

test("config store: forVersion resolves history so old positions re-price correctly", async () => {
  const { q, save } = fakeDb();
  const store = new GameConfigStore(q, { pollMs: 0 });
  await store.init();
  try {
    save({ volatility: "2.0" });
    await store.refresh();
    assert.equal(store.active().version, 2);

    const v1 = await store.forVersion(1);
    assert.equal(v1.version, 1);
    assert.equal(v1.volatility, 1.0, "history must return the ORIGINAL parameters");

    // Unknown version degrades to live config rather than stranding a player's stake.
    const missing = await store.forVersion(999);
    assert.equal(missing.version, 2);

    // null/undefined => whatever is live now.
    assert.equal((await store.forVersion(null)).version, 2);
  } finally { store.stop(); }
});

test("config store: mapConfigRow coerces pg numeric/bigint strings to numbers", () => {
  const cfg = mapConfigRow(row());
  assert.equal(typeof cfg.houseEdge, "number");
  assert.equal(typeof cfg.minStakeCents, "number");
  assert.equal(typeof cfg.version, "number");
  assert.equal(cfg.minStakeCents, 5000);
  assert.ok(Number.isInteger(cfg.minStakeCents));
});

// ── Feasibility rules shared by DB constraint, admin UI and engine ────────────────────────

test("checkFeasible: accepts the default config and explains why RTP 100% @ cap 5 fails", () => {
  assert.equal(checkFeasible(DEFAULT_CONFIG).ok, true);
  assert.equal(checkFeasible(DEFAULT_CONFIG).requiredMeanWinMultiplier, 2);

  // houseEdge 0 (RTP 100%) with the documented 0.125 win rate needs a mean multiple of 8.
  const v = checkFeasible({ ...DEFAULT_CONFIG, houseEdge: 0 });
  assert.equal(v.ok, false);
  assert.equal(v.requiredMeanWinMultiplier, 8);
  assert.match(v.reason!, /above the 5 cap/);

  // Raising the win rate to 0.25 makes the same RTP solvable at a mean multiple of 4.
  const fixed = checkFeasible({ ...DEFAULT_CONFIG, houseEdge: 0, targetWinRate: 0.25 });
  assert.equal(fixed.ok, true);
  assert.equal(fixed.requiredMeanWinMultiplier, 4);
});

test("checkFeasible: enforces the operational bounds the DB CHECKs enforce", () => {
  assert.match(checkFeasible({ ...DEFAULT_CONFIG, tickRateMs: 10 }).reason!, /tickRateMs/);
  assert.match(checkFeasible({ ...DEFAULT_CONFIG, driftBias: 3 }).reason!, /driftBias/);
  assert.match(checkFeasible({ ...DEFAULT_CONFIG, volatility: 0 }).reason!, /volatility/);
  assert.match(checkFeasible({ ...DEFAULT_CONFIG, maxStakeCents: 100 }).reason!, /maxStakeCents/);
  assert.match(checkFeasible({ ...DEFAULT_CONFIG, defaultDurationS: 0 }).reason!, /defaultDurationS/);
  assert.match(checkFeasible({ ...DEFAULT_CONFIG, minWithdrawalCents: 0 }).reason!, /minWithdrawalCents/);
  assert.match(checkFeasible({ ...DEFAULT_CONFIG, minWithdrawalCents: -5 }).reason!, /minWithdrawalCents/);
  assert.match(checkFeasible({ ...DEFAULT_CONFIG, minWithdrawalCents: 250.5 }).reason!, /minWithdrawalCents/);
  assert.equal(checkFeasible({ ...DEFAULT_CONFIG, minWithdrawalCents: 50_000 }).ok, true);
});

test("mapConfigRow: parses min_withdrawal into minWithdrawalCents (integer cents)", () => {
  const cfg = mapConfigRow(row({ min_withdrawal: "50000" }));
  assert.equal(cfg.minWithdrawalCents, 50_000);
  assert.ok(Number.isInteger(cfg.minWithdrawalCents));
});

test("configDiff / affectsPricing classify changes correctly", () => {
  const a = DEFAULT_VERSIONED_CONFIG;
  const tickOnly = { ...a, tickRateMs: 400 };
  const stakeOnly = { ...a, maxStakeCents: 9_000_000 };
  const pricing = { ...a, volatility: 2 };

  assert.deepEqual(configDiff(a, tickOnly), ["tickRateMs: 150 -> 400"]);
  assert.equal(affectsPricing(a, tickOnly), false, "tick rate is a timer period, not economics");
  assert.equal(affectsPricing(a, stakeOnly), false, "stake bounds are read per request");
  assert.equal(affectsPricing(a, pricing), true, "volatility changes the curve -> recalibrate");
});

// ── End-to-end: the config actually reaches the running game ──────────────────────────────

test("GameServer: enforces the LIVE stake bounds, and follows them when they change", async () => {
  const repo = new InMemoryGameRepository();
  repo.seed("u1", 10_000_000);
  let cfg: VersionedGameConfig = { ...DEFAULT_VERSIONED_CONFIG, minStakeCents: 5000, maxStakeCents: 100_000 };
  const config = new StaticConfigProvider(cfg);
  const seeds = new SeedManager("cfg-test-master", config, repo, () => 0, { calibrationSamples: 2000 });
  await seeds.init();
  const game = new GameServer(() => seeds.getActive(), repo, () => cfg, () => 0);

  await assert.rejects(() => game.openPosition({ userId: "u1", stakeCents: 4999, direction: "buy" }), /STAKE_BELOW_MIN/);
  await assert.rejects(() => game.openPosition({ userId: "u1", stakeCents: 100_001, direction: "buy" }), /STAKE_ABOVE_MAX/);

  // Operator raises the ceiling: the very next request must honour it, with no restart.
  cfg = { ...cfg, maxStakeCents: 500_000, version: 2 };
  const { position } = await game.openPosition({ userId: "u1", stakeCents: 400_000, direction: "buy" });
  assert.equal(position.stakeCents, 400_000);
  assert.equal(game.onlineConfigSnapshot().maxStakeCents, 500_000);
  assert.equal(game.onlineConfigSnapshot().configVersion, 2);
});

test("GameServer: applyTickRate reschedules the loop when tick rate changes", () => {
  const repo = new InMemoryGameRepository();
  let cfg: VersionedGameConfig = { ...DEFAULT_VERSIONED_CONFIG, tickRateMs: 150 };
  const ctx = {
    curve: { tick: () => ({ t: 0, rate: 0.2, delta: 0 }) },
    settlement: {},
    dayStartMs: 0, gameDayId: 1, configVersion: 1,
  } as never;
  const game = new GameServer(() => ctx, repo, () => cfg, () => 0);

  assert.equal(game.applyTickRate(), false, "no-op while the loop is stopped");
  game.start();
  try {
    assert.equal(game.currentTickRateMs(), 150);
    assert.equal(game.applyTickRate(), false, "unchanged rate must not churn the timer");

    cfg = { ...cfg, tickRateMs: 500, version: 2 };
    assert.equal(game.applyTickRate(), true);
    assert.equal(game.currentTickRateMs(), 500);
  } finally { game.stop(); }
});

test("SeedManager: same day + different config versions are separate pricing contexts", async () => {
  const repo = new InMemoryGameRepository();
  const { q, save } = fakeDb(row({ target_win_rate: "0.125", volatility: "1.0" }));
  const store = new GameConfigStore(q, { pollMs: 0 });
  await store.init();
  try {
    const seeds = new SeedManager("epoch-master", store, repo, () => 0, { calibrationSamples: 2000 });
    const v1 = await seeds.init();
    assert.equal(v1.configVersion, 1);

    save({ volatility: "2.5" });
    await store.refresh();
    const v2 = await seeds.init();

    assert.equal(v2.configVersion, 2);
    assert.equal(v2.dateKey, v1.dateKey, "same trading day");
    assert.equal(v2.seedHash, v1.seedHash, "config must NOT invalidate the published commitment");
    assert.notEqual(v2.curve.value(12.5), v1.curve.value(12.5), "but pricing must actually change");

    // The old context is still reachable for anything still in flight under it.
    const back = await seeds.contextFor(v1.dateKey, 1);
    assert.equal(back.configVersion, 1);
    assert.equal(back.curve.value(12.5), v1.curve.value(12.5));
  } finally { store.stop(); }
});

test("recovery: an in-flight position is re-priced with ITS config version, not the newest", async () => {
  const repo = new InMemoryGameRepository();
  repo.seed("u1", 1_000_000);
  const { q, save } = fakeDb(row({ volatility: "1.0" }));
  const store = new GameConfigStore(q, { pollMs: 0 });
  await store.init();
  try {
    const clock = { ms: 1000 };
    const seeds1 = new SeedManager("recov-master", store, repo, () => clock.ms, { calibrationSamples: 2000 });
    await seeds1.init();
    const game1 = new GameServer(() => seeds1.getActive(), repo, () => store.active(), () => clock.ms);
    const { position } = await game1.openPosition({ userId: "u1", stakeCents: 20000, direction: "buy" });
    assert.equal(position.configVersion, 1);
    const committed = position.outcome;

    // Operator changes the economics while the position is still open, then the engine crashes.
    save({ volatility: "3.0", target_win_rate: "0.2" });
    await store.refresh();
    assert.equal(store.active().version, 2);

    const seeds2 = new SeedManager("recov-master", store, repo, () => clock.ms, { calibrationSamples: 2000 });
    await seeds2.init();
    const game2 = new GameServer(() => seeds2.getActive(), repo, () => store.active(), () => clock.ms);
    const report = await new RecoveryService(repo, seeds2, game2, () => clock.ms).recover();

    assert.equal(report.scanned, 1);
    assert.equal(report.rearmed, 1);
    assert.equal(report.failed, 0);
    const rearmed = game2.getPosition(position.id)!;
    assert.equal(rearmed.configVersion, 1, "must replay under the version that priced it");
    assert.equal(rearmed.outcome.result, committed.result);
    assert.equal(rearmed.outcome.multiplier, committed.multiplier);
    assert.equal(rearmed.outcome.exitRate, committed.exitRate);
  } finally { store.stop(); }
});
