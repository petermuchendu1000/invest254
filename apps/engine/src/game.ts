import {
  CurveGenerator, SettlementEngine, type GameConfig, type VersionedGameConfig,
  type Direction, type Outcome, type Tick,
} from "@invest254/shared";
import type { GameRepository } from "./wallet.js";

export interface Position {
  id: string; userId: string; stakeCents: number; direction: Direction; durationS: number;
  openedAtMs: number; expiresAtMs: number; entryT: number;
  outcome: Outcome;                       // committed at open; kept server-side only (never persisted pre-settle)
  status: "open" | "settled";
  sellable: boolean;
  gameDayId: number | null;               // the day whose seed determined this outcome
  configVersion: number;                  // the game_config version that priced this outcome
}
export interface SettledEvent { position: Position; lockedMultiplier: number; payoutCents: number; pnlCents: number; balance: number; mode: "auto" | "manual"; }
export interface UpdateEvent { positionId: string; liveMultiplier: number; livePnlCents: number; secondsLeft: number; sellable: boolean; }
type Listener = { onTick?: (t: Tick) => void; onUpdate?: (u: UpdateEvent) => void; onSettled?: (e: SettledEvent) => void; onError?: (err: Error, ctx: string) => void; };

/**
 * The active trading day, supplied to the GameServer on every tick/open. Decoupling the
 * server from a fixed (curve, settlement, dayStart) lets the SeedManager rotate the day
 * at the UTC boundary without rebuilding the server, and lets recovery re-arm positions
 * from prior days. `settlement.liveWinMultiplier` is day-agnostic, so re-armed positions
 * from an earlier day still render and settle correctly against the active settlement.
 */
export interface ActiveContext {
  curve: CurveGenerator;
  settlement: SettlementEngine;
  dayStartMs: number;
  gameDayId: number | null;
  /** The game_config version baked into `curve`/`settlement`; recorded on every position. */
  configVersion: number;
}
export type ActiveContextProvider = () => ActiveContext;

let nonceCounter = 0;

export class GameServer {
  private positions = new Map<string, Position>();
  private listeners = new Set<Listener>();
  private lastRate?: number;
  private tickTimer: NodeJS.Timeout | undefined;
  private stepping = false;

  /** tickRateMs the running interval was created with, so we only reschedule on a real change. */
  private tickRateMs: number | undefined;

  /**
   * `getConfig` is a provider rather than a value: game configuration is edited live in the
   * admin panel, and every read below must see the current row instead of a snapshot frozen
   * at process boot (which is precisely the bug this replaced).
   */
  constructor(
    private readonly getActiveContext: ActiveContextProvider,
    private readonly repo: GameRepository,
    private readonly getConfig: () => GameConfig | VersionedGameConfig,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** The configuration in force right now. */
  private get cfg(): GameConfig { return this.getConfig(); }

  subscribe(l: Listener): () => void { this.listeners.add(l); return () => this.listeners.delete(l); }
  private emitTick(t: Tick) { for (const l of this.listeners) l.onTick?.(t); }
  private emitUpdate(u: UpdateEvent) { for (const l of this.listeners) l.onUpdate?.(u); }
  private emitSettled(e: SettledEvent) { for (const l of this.listeners) l.onSettled?.(e); }
  private emitError(err: Error, ctx: string) { for (const l of this.listeners) l.onError?.(err, ctx); }

  start(): void {
    if (this.tickTimer) return;
    this.tickRateMs = this.cfg.tickRateMs;
    this.tickTimer = setInterval(() => { void this.step(); }, this.tickRateMs);
  }
  stop(): void {
    if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = undefined; }
    this.tickRateMs = undefined;
  }

  /**
   * Re-arm the tick loop when the configured tick rate changes. setInterval captures its
   * period at creation, so a live tick-rate edit needs the timer torn down and recreated;
   * without this the admin's "Tick rate (ms)" field would be silently inert until redeploy.
   * Returns true when the loop was actually rescheduled.
   */
  applyTickRate(): boolean {
    const next = this.cfg.tickRateMs;
    if (!this.tickTimer || next === this.tickRateMs) return false;
    clearInterval(this.tickTimer);
    this.tickRateMs = next;
    this.tickTimer = setInterval(() => { void this.step(); }, next);
    return true;
  }

  /** Current tick period in ms, or undefined when the loop is stopped. Exposed for tests/health. */
  currentTickRateMs(): number | undefined { return this.tickRateMs; }

  async step(): Promise<void> {
    if (this.stepping) return;
    this.stepping = true;
    try {
      const ctx = this.getActiveContext();
      const nowMs = this.now();
      const tick = ctx.curve.tick(nowMs, ctx.dayStartMs, this.lastRate);
      this.lastRate = tick.rate;
      this.emitTick(tick);
      const expired: Position[] = [];
      for (const p of this.positions.values()) {
        if (p.status !== "open") continue;
        if (nowMs >= p.expiresAtMs) { expired.push(p); continue; }
        const g = (nowMs - p.openedAtMs) / (p.durationS * 1000);
        const live = this.liveMultiplier(p, g, ctx.settlement);
        this.emitUpdate({ positionId: p.id, liveMultiplier: live, livePnlCents: Math.round(p.stakeCents * live) - p.stakeCents, secondsLeft: Math.max(0, (p.expiresAtMs - nowMs) / 1000), sellable: p.sellable });
      }
      for (const p of expired) { try { await this.settleAuto(p); } catch (err) { this.emitError(err as Error, `auto-settle ${p.id}`); } }
    } finally { this.stepping = false; }
  }

  private liveMultiplier(p: Position, g: number, settlement: SettlementEngine): number {
    if (p.outcome.result === "win") return settlement.liveWinMultiplier(p.outcome.multiplier, g);
    const x = Math.min(1, Math.max(0, g));
    return 1 - x * x * x * (x * (x * 6 - 15) + 10);
  }

  /** Open a position: outcome committed in memory; stake+position+ledger persisted atomically by the repo. */
  async openPosition(input: { userId: string; stakeCents: number; direction: Direction; durationS?: number }): Promise<{ position: Position; balance: number }> {
    const durationS = input.durationS ?? this.cfg.defaultDurationS;
    if (!Number.isInteger(input.stakeCents)) throw new RangeError("stake must be integer cents");
    if (input.stakeCents < this.cfg.minStakeCents) throw new Error(`STAKE_BELOW_MIN: min ${this.cfg.minStakeCents}`);
    if (input.stakeCents > this.cfg.maxStakeCents) throw new Error(`STAKE_ABOVE_MAX: max ${this.cfg.maxStakeCents}`);
    if (durationS <= 0) throw new RangeError("duration must be > 0");
    const ctx = this.getActiveContext();
    const openedAtMs = this.now();
    const entryT = (openedAtMs - ctx.dayStartMs) / 1000;
    const outcome = ctx.settlement.settle(input.stakeCents, input.direction, entryT);
    const nonce = (nonceCounter = (nonceCounter + 1) % Number.MAX_SAFE_INTEGER);
    const { positionId, newBalance } = await this.repo.openPosition({
      userId: input.userId, stakeCents: input.stakeCents, direction: input.direction,
      entryRate: outcome.entryRate, durationS, gameDayId: ctx.gameDayId, nonce, openedAtMs,
      configVersion: ctx.configVersion,
    });
    const p: Position = { id: positionId, userId: input.userId, stakeCents: input.stakeCents, direction: input.direction, durationS, openedAtMs, expiresAtMs: openedAtMs + durationS * 1000, entryT, outcome, status: "open", sellable: outcome.result === "win", gameDayId: ctx.gameDayId, configVersion: ctx.configVersion };
    this.positions.set(positionId, p);
    return { position: p, balance: newBalance };
  }

  /**
   * Re-arm an in-flight position recovered from the database after a restart. The caller
   * (RecoveryService) has already recomputed its committed outcome from the day seed, so
   * the position resumes its normal lifecycle: live updates until expiry, then auto-settle.
   * Idempotent and safe — never re-arms an already-tracked or non-open position.
   */
  rearm(p: Position): boolean {
    if (p.status !== "open") return false;
    if (this.positions.has(p.id)) return false;
    this.positions.set(p.id, p);
    return true;
  }

  async sell(positionId: string, userId: string): Promise<SettledEvent> {
    const p = this.positions.get(positionId);
    if (!p || p.userId !== userId) throw new Error("POSITION_NOT_FOUND");
    if (p.status !== "open") throw new Error("ALREADY_SETTLED");
    if (!p.sellable) throw new Error("NOT_SELLABLE: losing positions settle at expiry");
    const g = (this.now() - p.openedAtMs) / (p.durationS * 1000);
    return this.finalize(p, this.getActiveContext().settlement.liveWinMultiplier(p.outcome.multiplier, g), "manual");
  }

  private async settleAuto(p: Position): Promise<SettledEvent> {
    return this.finalize(p, p.outcome.result === "win" ? p.outcome.multiplier : 0, "auto");
  }

  /** Idempotent settlement. Status locked synchronously before the async repo call. */
  private async finalize(p: Position, multiplier: number, mode: "auto" | "manual"): Promise<SettledEvent> {
    if (p.status !== "open") throw new Error("ALREADY_SETTLED");
    p.status = "settled";
    const payoutCents = multiplier >= 1 ? Math.round(p.stakeCents * multiplier) : 0;
    const result: "win" | "loss" = payoutCents > 0 ? "win" : "loss";
    try {
      const { newBalance } = await this.repo.settlePosition({ positionId: p.id, exitRate: p.outcome.exitRate, result, multiplier, payoutCents });
      const e: SettledEvent = { position: p, lockedMultiplier: multiplier, payoutCents, pnlCents: payoutCents - p.stakeCents, balance: newBalance, mode };
      this.emitSettled(e);
      return e;
    } catch (err) { p.status = "open"; throw err; }
  }

  getPosition(id: string): Position | undefined { return this.positions.get(id); }
  openCount(): number { let n = 0; for (const p of this.positions.values()) if (p.status === "open") n++; return n; }
  onlineConfigSnapshot() {
    const c = this.cfg;
    return {
      minStakeCents: c.minStakeCents, maxStakeCents: c.maxStakeCents, maxMultiplier: c.maxMultiplier,
      defaultDurationS: c.defaultDurationS, tickRateMs: c.tickRateMs,
      configVersion: (c as VersionedGameConfig).version ?? 0,
    };
  }
}
