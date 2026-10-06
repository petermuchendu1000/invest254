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

## What shipped

**The engine holds the levels.** A position carries `slPrice`/`tpPrice` as chart prices, armed with
the order or moved later through `set_levels` (MetaTrader's Modify position). Every tick converts
the current rate to a price and compares; a buy stops at or below its stop and takes profit at or
above its target, a sell mirrors it. The **stop is checked first**, because a tick spanning both
levels cannot be known to have touched the better one first and the trader does not get the benefit
of that doubt.

**The browser stopped watching.** `useTakeProfitLevelWatch` fired a sell from a React effect when
the price reached the level. That only worked while the tab was open, receiving ticks and connected:
a trader who set a target and shut the laptop had no target. It is deleted rather than kept as a
weaker second copy of the same rule.

**Expiry is gone from the ticket.** It was never a MetaTrader control. A position now ends at its
stop, its target, a manual close, or the brand's horizon, and choosing a term alongside a stop would
be two contradictory ways to end one trade. The horizon is the BRAND's: a brand with a price axis
ignores whatever duration the client sends.

### The horizon, and why its default did not move

`defaultDurationS` stays at **10 seconds**, deliberately. At ten seconds a stop barely has room to
be reached, so the levels only really earn their keep at a longer horizon, and an operator who wants
MetaTrader's open-ended positions raises it per brand (the bound is 3600).

That is their call rather than a side effect of shipping this. Raising the shipped default was tried
and reverted: it changes every brand's character at once, and it broke 10 engine tests whose
fixtures assume a ten-second term. The economics do not constrain the choice, because the
calibration re-solves for whatever horizon it is given:

| horizon | measured RTP (target 25%) | break-even cost |
| --: | --: | --: |
| 10s | 25.14% | 0.00289 |
| 60s | 25.47% | 0.00728 |
| 300s | 25.33% | 0.01708 |
| 3600s | 24.97% | 0.05767 |

The cost scales as the square root of the horizon, which is what a martingale implies.

### Known gap

A **re-armed** position keeps the committed contract. The levels are not persisted, so a restart
cannot know what stop the trader had set, and settling it on a model whose inputs were lost is worse
than settling it the way it opened. Closing this needs the same kind of forward-only column the
execution prices got in migration 0180.

### Proof

* `apps/engine/src/game.levels.test.ts` — 7 tests. Opens a position, steps the clock, and proves the
  stop closes it before its horizon with nothing watching; that a level set through Modify fires the
  same way; that a loser can now be closed by hand; and that a brand with no axis keeps the
  committed contract untouched. The stop level is chosen from the curve's own path, so the test
  cannot pass by firing instantly on the wrong side of entry.
* `packages/shared/src/settle.continuous.test.ts` — 4 tests pinning the economics under eight
  stopping rules.
* `scratchpad/sltp.mjs` — 9/9 in a real browser against the real engine. Reads the websocket frames:
  the order carries the levels as prices, the engine acknowledges what it took, and after a RELOAD
  the engine hands the stop back because it never lost it.
* Full suites: engine 574 pass / 0 fail, shared 379 pass / 0 fail.
