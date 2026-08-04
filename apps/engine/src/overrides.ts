import { SettlementEngine, checkFeasible, type GameConfig, type CurveGenerator } from "@invest254/shared";
import type { Querier } from "./wallet.js";

/**
 * Per-user admin overrides the engine consults at open (migration 0032). Any NULL field means
 * "use the global game_config value". The admin sets these from the user-detail page.
 *
 *  - winRate / maxWinMultiplier  → PRICING overrides: the user's outcomes are computed from a
 *    per-user SettlementEngine calibrated to their win rate / cap (see `userSettlement`).
 *  - tradeDurationS              → forces the auto-sell duration for the user's new trades.
 *  - minStakeCents/maxStakeCents → per-user stake gates (pre-open only; never affect pricing).
 *
 * Recovery re-derives an override position's outcome with the SAME helper, so a crash reprices
 * identically — PROVIDED the override is unchanged. (Changing a user's win rate while they hold an
 * open position is an admin action; a crash in that window would reprice under the new value.)
 */
export interface UserOverride {
  userId: string;
  winRate: number | null;
  tradeDurationS: number | null;
  maxWinMultiplier: number | null;
  minStakeCents: number | null;
  maxStakeCents: number | null;
  notes: string | null;
  updatedBy: string | null;
  updatedAtMs: number;
}

export interface UserOverridesRepository {
  getForUser(userId: string): Promise<UserOverride | null>;
}

/** True when the override changes how a round is priced (win rate / payout cap). */
export function overrideAffectsPricing(o: UserOverride | null | undefined): boolean {
  return !!o && (o.winRate != null || o.maxWinMultiplier != null);
}

/**
 * A per-user SettlementEngine for a pricing override, or `null` if the override would be
 * infeasible (RTP/winRate must land in (1, maxMultiplier]) — in which case the caller falls back
 * to the global settlement rather than crashing. Deterministic in (curve, effective cfg), so open
 * and recovery agree. Calibrated over the default-duration window, exactly like the global engine.
 */
export function userSettlement(curve: CurveGenerator, cfg: GameConfig, o: UserOverride): SettlementEngine | null {
  const effective: GameConfig = {
    ...cfg,
    targetWinRate: o.winRate ?? cfg.targetWinRate,
    maxMultiplier: o.maxWinMultiplier ?? cfg.maxMultiplier,
  };
  if (!checkFeasible(effective).ok) return null;
  return new SettlementEngine(curve, effective, "calibration", cfg.defaultDurationS);
}

// ── In-memory (tests/dev) ──
export class InMemoryUserOverridesRepository implements UserOverridesRepository {
  private map = new Map<string, UserOverride>();
  set(o: UserOverride): void { this.map.set(o.userId, o); }
  async getForUser(userId: string): Promise<UserOverride | null> { return this.map.get(userId) ?? null; }
}

// ── Postgres ──
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const ms = (v: unknown): number => (v instanceof Date ? v.getTime() : new Date(String(v)).getTime());

export class PgUserOverridesRepository implements UserOverridesRepository {
  constructor(private readonly q: Querier) {}
  async getForUser(userId: string): Promise<UserOverride | null> {
    const r = await this.q.query(
      `select user_id, win_rate, trade_duration_s, max_win_multiplier, min_stake, max_stake, notes, updated_by, updated_at
         from user_overrides where user_id = $1`, [userId]);
    if (!r.rows.length) return null;
    const x = r.rows[0];
    return {
      userId: String(x.user_id),
      winRate: num(x.win_rate),
      tradeDurationS: x.trade_duration_s == null ? null : Number(x.trade_duration_s),
      maxWinMultiplier: num(x.max_win_multiplier),
      minStakeCents: x.min_stake == null ? null : Number(x.min_stake),
      maxStakeCents: x.max_stake == null ? null : Number(x.max_stake),
      notes: x.notes == null ? null : String(x.notes),
      updatedBy: x.updated_by == null ? null : String(x.updated_by),
      updatedAtMs: ms(x.updated_at),
    };
  }
}
