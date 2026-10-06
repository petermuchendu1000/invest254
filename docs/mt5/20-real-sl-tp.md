# 20. Making Stop Loss and Take Profit real

Asked for: *"We need to get away with the 'expiry' and implement the real thing - we must make it
work! SL and TP must work for this system to be functional... where we still maintain the advantage
already presented in the engine."*

## Why the current engine cannot have a real stop

Three facts about what is there today, all of them load-bearing:

1. **The price curve is a martingale by design.** `curve.ts`: *"A seed-derived RANDOM WALK
   (martingale)... increments are independent, so no strategy based on past prices beats the base
   rate"*, measured *"trend-following 0.2502, mean-reverting 0.2504 - neither beats the base rate"*.
2. **The outcome is committed at OPEN.** `game.ts openPosition` calls `settleVariable(...)` before a
   single tick passes; win, multiplier and payout are all fixed then. "Expiry" is only when that
   decision is revealed.
3. **The edge lives in a step function.** A contract pays nothing until the favourable move reaches
   `tau`, then jumps straight to `1 + gain*tau` = **1.70x**. `tau` is the (1 - targetWinRate)
   quantile of the move, `gain` is solved for RTP. That discontinuity IS the 75% house edge.

The first fact is the one that bites. By the optional stopping theorem, if the price alone decides
when a position closes, the expected close price equals the open price: **expected P/L is exactly
zero, RTP 100%, house edge nil.** No amount of engineering gets around that; it is a theorem. An
edge has to be injected structurally - as a cost, or as a cap on what a payout can be.

## What was measured

`scratchpad/sltpsim.ts` generalises settlement to an arbitrary stopping time (win iff
`move(close) >= tau`) and measures the realised economics over 40,000 trades per rule, three seeds:

| stopping rule | RTP | profitable |
| --- | --: | --: |
| held to horizon (today) | 25.5% | 12.8% |
| TP at tau, SL at tau | **32.9%** | 18.9% |
| TP at tau, SL at 2*tau | **33.3%** | 19.2% |
| TP only at tau | **32.8%** | 18.8% |
| tight: TP/SL at tau/4 | **0.00%** | **0.00%** |
| very tight: TP/SL at tau/20 | **0.00%** | **0.00%** |

Both failure modes are fatal, and they are the same defect seen from two sides:

* **A tight take profit wipes the trader out.** A target below `tau` closes the contract on the zero
  side of the step, so a trader who is right but modest is paid **nothing**. That is not a working
  take profit, it is a trap.
* **A target at or above `tau` leaks a third of the edge**, 25% RTP becoming 33%.

A step payout and a continuous target cannot both be sane. That is the finding.

## The fix: a continuous payout through a cost

Replace the step with a line through a cost `c`:

```
payout = clamp(1 + gain * (move_at_close - c), 0, maxMultiplier) * stake
```

* **Continuous.** A small favourable move makes a small profit; an adverse move a partial loss. A
  stop and a target can be put anywhere and behave the way a trader expects.
* **The floor at zero keeps the stake as the maximum loss**, exactly as today, so there is still no
  margin call and no negative balance.
* **`c` is economically the SPREAD** - the move a trader must make to break even - and it carries the
  whole house edge. This is the same thing a real broker does, and it is what MetaTrader models.

`scratchpad/sltpsim2.ts` solves `c` for the target RTP and then measures whether that RTP survives
arbitrary stopping. It does, across every sane rule and all three seeds:

| stopping rule | RTP (target 25%) |
| --- | --: |
| held to horizon | 25.1% |
| TP/SL at c | 24.5% |
| TP 2c / SL c | 24.8% |
| TP c / SL 2c | 24.5% |
| TP only at 2c | 24.6% |
| SL only at c | 24.8% |
| wide TP/SL at 5c | 24.6% |
| tight TP/SL at c/4 | 14.6% |
| very tight TP/SL at c/20 | 4.5% |

**No stopping rule beats the house** (worst case 25.45% against a 25% target, versus 33% under the
step). Over-trading with very tight stops costs the trader more, not less, which is how a real
spread behaves and is the correct direction for the leak to run.

## The one trade-off, quantified

With the continuous payout, the two config knobs can no longer both be honoured
(`scratchpad/sltpsim3.ts`). `c` pins the profitable-trade rate, because `P(payout > 1) = P(move > c)`;
`gain` then sets how far payouts spread around it. With `c` pinned to `targetWinRate` = 12.5%, the
**minimum reachable RTP is 30.3%** (at gain 882) - 25% is not reachable at `maxMultiplier` 5:

| gain | RTP |
| --: | --: |
| 100 | 79.8% |
| 342 | 42.5% |
| **882** | **30.3%** (minimum) |
| 2000 | 36.3% |
| 5000 | 48.3% |

So one of three must give:

* **RTP 25% wins** (what is implemented): `c` solves the house edge, and the profitable-trade rate
  lands near 5%. The money knob is exact; the win-rate knob becomes an output.
* **Win rate 12.5% wins**: house edge falls from 75% to ~70%.
* **Lower `maxMultiplier`**: capping winners harder lets both hold, at the cost of the 5x headline.

RTP is the operator's revenue and `targetWinRate` is a feel knob, so RTP binds and the achieved
win rate is surfaced rather than silently missed.
