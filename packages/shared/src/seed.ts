import { createHash, createHmac } from "node:crypto";

/**
 * Daily seed model (provably fair, recovery-friendly).
 *
 * Each trading day gets its own server seed derived deterministically from a single
 * long-lived MASTER seed:
 *
 *   daySeed   = HMAC-SHA256(MASTER_SEED, "day:" + dateKey)   (hex)
 *   commitment = SHA-256(daySeed)                            (hex)
 *
 * Only the commitment is published/stored before the day ends; the daySeed itself is
 * revealed after the day closes (see migration 0011 `fn_reveal_game_day`, which checks
 * `server_seed_hash = sha256(seed)`). Because the daySeed is recomputable from the
 * master seed and the (public) dateKey, the engine never needs to read a secret from
 * the database to recover state after a crash — it recomputes it. No secret at rest.
 *
 * All day boundaries are in UTC so every client and server agrees on the active day
 * regardless of local timezone.
 */

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** UTC calendar day key ("YYYY-MM-DD") for an epoch-ms instant. */
export function dateKeyUTC(epochMs: number): string {
  if (!Number.isFinite(epochMs)) throw new RangeError(`invalid epoch ms: ${epochMs}`);
  const d = new Date(epochMs);
  if (Number.isNaN(d.getTime())) throw new RangeError(`invalid epoch ms: ${epochMs}`);
  return d.toISOString().slice(0, 10);
}

/** Epoch ms of UTC midnight (00:00:00.000Z) that begins the given day key. */
export function dayStartMs(dateKey: string): number {
  if (!DATE_KEY_RE.test(dateKey)) throw new RangeError(`invalid date key: ${dateKey}`);
  const ms = Date.parse(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(ms)) throw new RangeError(`invalid date key: ${dateKey}`);
  return ms;
}

/**
 * Deterministic per-day server seed (hex) derived from the master seed.
 *
 * `version` supports superadmin-forced seed rotation (J5): the base seed for a day is
 * version 0 and uses the canonical `day:<dateKey>` label, so every previously committed
 * commitment stays byte-identical (backward compatible). A forced rotation bumps the
 * version, deriving an entirely different seed via the `day:<dateKey>#<version>` label.
 * Because the version is the only extra input and it is persisted (see `seed_overrides`),
 * the rotated seed remains fully recomputable for crash recovery and reveal — no secret at
 * rest, exactly like the base model.
 */
export function deriveDaySeed(masterSeed: string, dateKey: string, version = 0): string {
  if (!masterSeed) throw new Error("masterSeed is required");
  if (!DATE_KEY_RE.test(dateKey)) throw new RangeError(`invalid date key: ${dateKey}`);
  if (!Number.isInteger(version) || version < 0) throw new RangeError(`invalid seed version: ${version}`);
  const label = version === 0 ? `day:${dateKey}` : `day:${dateKey}#${version}`;
  return createHmac("sha256", masterSeed).update(label).digest("hex");
}

/** Public commitment to a seed: SHA-256(seed) as lowercase hex. */
export function commitment(seed: string): string {
  if (!seed) throw new Error("seed is required");
  return createHash("sha256").update(seed).digest("hex");
}
