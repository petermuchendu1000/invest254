import { createHmac } from "node:crypto";

/**
 * Deterministic, provably-fair pseudo-random number generator.
 *
 * Outcomes are derived from HMAC-SHA256(serverSeed, label). The serverSeed is
 * committed in advance (publish sha256(serverSeed)) and revealed later, so any
 * party can recompute and verify every outcome — see docs/02-game-engine.md §4.
 *
 * The HMAC digest is consumed as a stream of 48-bit blocks, each mapped to a
 * uniform float in [0, 1). The stream re-keys with an incrementing counter so it
 * never runs out of entropy for a given (seed, label).
 */
export class SeededRng {
  private buffer: Buffer = Buffer.alloc(0);
  private offset = 0;
  private counter = 0;

  constructor(private readonly serverSeed: string, private readonly label: string) {
    if (!serverSeed) throw new Error("serverSeed is required");
    if (!label) throw new Error("label is required");
  }

  private refill(): void {
    this.buffer = createHmac("sha256", this.serverSeed)
      .update(`${this.label}:${this.counter++}`)
      .digest();
    this.offset = 0;
  }

  /** Uniform float in [0, 1) with 48 bits of resolution. */
  next(): number {
    if (this.offset + 6 > this.buffer.length) this.refill();
    let v = 0;
    for (let i = 0; i < 6; i++) v = v * 256 + this.buffer[this.offset + i]!;
    this.offset += 6;
    return v / 2 ** 48; // 48-bit mantissa, strictly < 1
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Standard normal via Box–Muller (uses two uniforms). */
  normal(): number {
    let u1 = this.next();
    if (u1 < 1e-12) u1 = 1e-12; // avoid log(0)
    const u2 = this.next();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
}
