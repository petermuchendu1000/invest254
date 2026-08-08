import { test } from "node:test";
import assert from "node:assert/strict";
import { CurveGenerator, SettlementEngine, DEFAULT_CONFIG } from "@invest254/shared";
import { InMemoryGameRepository } from "./wallet.js";
import { GameServer } from "./game.js";
import { userSettlement, overrideAffectsPricing, InMemoryUserOverridesRepository, type UserOverride } from "./overrides.js";

const ov = (p: Partial<UserOverride>): UserOverride => ({
  userId: "u", winRate: null, tradeDurationS: null, maxWinMultiplier: null,
  minStakeCents: null, maxStakeCents: null, notes: null, updatedBy: null, updatedAtMs: 0, ...p,
});

function winFraction(eng: SettlementEngine, n = 800): number {
  let wins = 0;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * 3600;
    if (eng.settle(20000, "buy", t).result === "win") wins++;
  }
  return wins / n;
}

test("overrideAffectsPricing: only win rate / max multiplier change pricing", () => {
  assert.equal(overrideAffectsPricing(null), false);
  assert.equal(overrideAffectsPricing(ov({ tradeDurationS: 30 })), false);
  assert.equal(overrideAffectsPricing(ov({ minStakeCents: 5000 })), false);
  assert.equal(overrideAffectsPricing(ov({ winRate: 0.4 })), true);
  assert.equal(overrideAffectsPricing(ov({ maxWinMultiplier: 3 })), true);
});

test("userSettlement: a higher win-rate override actually wins more often", () => {
  const curve = new CurveGenerator("engine-day", DEFAULT_CONFIG);
  // Feasible band at RTP 0.25 is winRate in [0.05, 0.25): mean win multiple = 0.25/winRate must be in (1, 5].
  const low = userSettlement(curve, DEFAULT_CONFIG, ov({ winRate: 0.08 }))!;
  const high = userSettlement(curve, DEFAULT_CONFIG, ov({ winRate: 0.22 }))!;
  assert.ok(low && high);
  const fLow = winFraction(low);
  const fHigh = winFraction(high);
  assert.ok(fHigh > fLow + 0.05, `expected ${fHigh} > ${fLow} + 0.05`);
  assert.ok(Math.abs(fLow - 0.08) < 0.06, `low ~0.08, got ${fLow}`);
  assert.ok(Math.abs(fHigh - 0.22) < 0.06, `high ~0.22, got ${fHigh}`);
});

test("userSettlement: an infeasible override returns null (caller falls back to global)", () => {
  const curve = new CurveGenerator("engine-day", DEFAULT_CONFIG);
  // RTP 0.25 with winRate 0.9 needs mean win multiple 0.277 (<=1) -> infeasible.
  assert.equal(userSettlement(curve, DEFAULT_CONFIG, ov({ winRate: 0.95 })), null);
});

function rig(loadOverride?: (u: string) => Promise<UserOverride | null>) {
  const cfg = DEFAULT_CONFIG;
  const curve = new CurveGenerator("engine-day", cfg);
  const eng = new SettlementEngine(curve, cfg);
  const repo = new InMemoryGameRepository();
  const clock = { ms: 0 };
  const ctx = { curve, settlement: eng, dayStartMs: 0, gameDayId: null, configVersion: 1 };
  const gs = new GameServer(() => ctx, repo, () => cfg, () => clock.ms, loadOverride);
  let loseT = -1;
  for (let t = 0; t < 3600 && loseT < 0; t += 0.05) if (eng.settle(20000, "buy", t).result === "loss") loseT = t;
  return { cfg, curve, eng, repo, clock, gs, loseT };
}

test("GameServer: per-user trade-duration override drives the auto-sell timer", async () => {
  const repo = new InMemoryUserOverridesRepository();
  repo.set(ov({ userId: "u1", tradeDurationS: 30 }));
  const r = rig((u) => repo.getForUser(u));
  r.repo.seed("u1", 100000);
  const { position } = await r.gs.openPosition({ userId: "u1", stakeCents: 25000, direction: "buy" });
  assert.equal(position.durationS, 30);
  assert.equal(position.expiresAtMs, position.openedAtMs + 30_000);
});

test("GameServer: per-user stake bounds gate the open", async () => {
  const repo = new InMemoryUserOverridesRepository();
  repo.set(ov({ userId: "u1", minStakeCents: 50_000, maxStakeCents: 100_000 }));
  const r = rig((u) => repo.getForUser(u));
  r.repo.seed("u1", 1_000_000);
  await assert.rejects(() => r.gs.openPosition({ userId: "u1", stakeCents: 20_000, direction: "buy" }), /STAKE_BELOW_MIN/);
  await assert.rejects(() => r.gs.openPosition({ userId: "u1", stakeCents: 200_000, direction: "buy" }), /STAKE_ABOVE_MAX/);
  const { position } = await r.gs.openPosition({ userId: "u1", stakeCents: 60_000, direction: "buy" });
  assert.equal(position.stakeCents, 60_000);
});

test("GameServer: a higher win-rate override wins where the global settlement loses", async () => {
  const repo = new InMemoryUserOverridesRepository();
  repo.set(ov({ userId: "lucky", winRate: 0.22 })); // vs global 0.125 — wins more often
  const r = rig((u) => repo.getForUser(u));
  const userEng = userSettlement(r.curve, r.cfg, ov({ winRate: 0.22 }))!;
  // Find an entry the GLOBAL engine loses but the OVERRIDE engine wins — proves per-user pricing.
  let flipT = -1;
  for (let t = 0; t < 3600 && flipT < 0; t += 0.05) {
    if (r.eng.settle(20000, "buy", t).result === "loss" && userEng.settle(20000, "buy", t).result === "win") flipT = t;
  }
  assert.ok(flipT >= 0, "found an entry the override flips from loss to win");
  r.repo.seed("lucky", 100000);
  r.clock.ms = Math.round(flipT * 1000);
  const { position } = await r.gs.openPosition({ userId: "lucky", stakeCents: 25000, direction: "buy" });
  assert.equal(position.outcome.result, "win", "override settlement should win where global loses");

  // A user with NO override still gets the global outcome (a loss at the same entry).
  r.repo.seed("plain", 100000);
  const { position: p2 } = await r.gs.openPosition({ userId: "plain", stakeCents: 25000, direction: "buy" });
  assert.equal(p2.outcome.result, "loss", "non-override user uses the global settlement");
});
