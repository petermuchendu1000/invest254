import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_VERSIONED_CONFIG } from "@invest254/shared";
import { InMemoryGameRepository } from "./wallet.js";
import { GameServer } from "./game.js";
import { SeedManager } from "./daycontext.js";
import { RecoveryService } from "./recovery.js";
import { StaticConfigProvider } from "./gameconfig.js";

const MASTER = "recovery-test-master";
// Small calibration sample count keeps the test fast; determinism is unaffected because
// open-time and recovery-time both build contexts with the SAME (master, key, samples).
const OPTS = { calibrationSamples: 4000 };

test("recovery: settles expired, re-arms in-flight, deterministically and idempotently", async () => {
  const cfg = DEFAULT_VERSIONED_CONFIG;
  const config = new StaticConfigProvider(cfg);
  const repo = new InMemoryGameRepository();
  repo.seed("u1", 100000);
  repo.seed("u2", 100000);
  const clock = { ms: 0 };

  // --- pre-crash: a SeedManager + GameServer open two positions on the same UTC day ---
  const seeds1 = new SeedManager(MASTER, config, repo, () => clock.ms, OPTS);
  await seeds1.init();
  const game1 = new GameServer(() => seeds1.getActive(), repo, () => cfg, () => clock.ms);

  const C1 = 1000; // open P1 (will be expired by recovery time)
  clock.ms = C1;
  const { position: p1 } = await game1.openPosition({ userId: "u1", stakeCents: 25000, direction: "buy" });

  const C2 = C1 + 5000; // open P2 5s later (still in-flight at recovery time)
  clock.ms = C2;
  const { position: p2 } = await game1.openPosition({ userId: "u2", stakeCents: 25000, direction: "sell" });

  const balU1AfterOpen = await repo.getBalance("u1");
  const balU2AfterOpen = await repo.getBalance("u2");
  assert.equal(balU1AfterOpen, 75000);
  assert.equal(balU2AfterOpen, 75000);
  assert.equal((await repo.listOpenPositions()).length, 2);

  // expected hold-to-expiry payout for the expired P1, recomputed independently
  const ctx = await seeds1.contextFor("1970-01-01");
  const oP1 = ctx.settlement.settle(25000, "buy", (C1 - ctx.dayStartMs) / 1000);
  const expectedP1Payout = oP1.result === "win" ? Math.round(25000 * oP1.multiplier) : 0;

  // --- crash: discard game1/seeds1; a fresh process boots with only the durable repo ---
  const recoverAtMs = C1 + 10000 + 1; // P1 expired (opened C1, 10s), P2 in-flight (expires C2+10000)
  clock.ms = recoverAtMs;
  const seeds2 = new SeedManager(MASTER, config, repo, () => clock.ms, OPTS);
  await seeds2.init();
  const game2 = new GameServer(() => seeds2.getActive(), repo, () => cfg, () => clock.ms);
  const recovery = new RecoveryService(repo, seeds2, game2, () => clock.ms);

  const report = await recovery.recover();
  assert.equal(report.scanned, 2);
  assert.equal(report.settled, 1);  // P1 expired -> finalised now
  assert.equal(report.rearmed, 1);  // P2 in-flight -> resumed
  assert.equal(report.failed, 0);

  // P1 settled deterministically to the recomputed outcome
  assert.equal(await repo.getBalance("u1"), 75000 + expectedP1Payout);
  // P2 is back on the live server, still open
  assert.ok(game2.getPosition(p2.id));
  assert.equal(game2.getPosition(p2.id)!.status, "open");
  assert.equal(game2.openCount(), 1);

  // recovery is idempotent: a second pass settles nothing new and re-arms nothing
  const report2 = await recovery.recover();
  assert.equal(report2.scanned, 1);            // only P2 still open in the DB
  assert.equal(report2.settled + report2.rearmed, 0);
  assert.equal(report2.noop, 1);               // P2 already tracked -> no-op
  assert.equal(await repo.getBalance("u1"), 75000 + expectedP1Payout); // no double credit

  // P2 settles normally at its expiry through the live tick loop
  clock.ms = p2.expiresAtMs;
  let settled: any; game2.subscribe({ onSettled: (e) => (settled = e) });
  await game2.step();
  assert.equal(game2.getPosition(p2.id)!.status, "settled");
  assert.ok(settled && settled.position.id === p2.id);
  assert.equal((await repo.listOpenPositions()).length, 0);

  // a P1 settle attempt would be an idempotent no-op (already settled in the DB)
  const reSettle = await repo.settlePosition({ positionId: p1.id, exitRate: 0, result: "loss", multiplier: 0, payoutCents: 0 });
  assert.equal(reSettle.settled, false);
});
