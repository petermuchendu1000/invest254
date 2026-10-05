# MetaTrader's phone shell — what was built, and what it is not

The specification this was built from is `04-mobile-app.md`, which was researched from MetaQuotes'
own help pages and current screenshots. This file records what shipped against it, what deviates and
why, and what is still missing. It is the status half; `04` stays the facts half.

## What the screen was before

Measured on a 360x800 phone, on the trade route of a candlestick brand:

| | |
|---|---|
| chart height | **168px of 800** (21%) |
| order ticket | roughly 60% of the screen |
| page scroll | `scrollHeight === clientHeight` — the page did not scroll, so what did not fit was unreachable |
| chart toolbar | the 21-period strip, truncated mid-strip at M5 |
| drawing rail | 40px of a 360px screen |
| bottom chrome | none; a terminal brand has no app bottom nav |

It was the desktop terminal's three-panel layout rendered as one tall column. MetaTrader's answer to
a phone is not a narrower desktop: it is five tabs with one full-screen view at a time.

Measured again on the same 360x800 phone, after:

| | |
|---|---|
| chart height | **576px of 800** (72%), starting 89px down |
| order ticket | a screen, reached from the panel or the Trade tab's `+` |
| page scroll | still `scrollHeight === clientHeight`, and now that is correct: each tab scrolls inside itself |
| chart toolbar | MetaTrader's six phone controls, none truncated |
| drawing rail | gone, as MetaTrader's phone has none |
| bottom chrome | MetaTrader's five-tab bar, 57px |

## What shipped

| Piece | Where |
|---|---|
| Five-tab bar, Android's set and order | `components/game/mobile/MT5MobileTabs.tsx` |
| The shell and its view switching | `components/game/mobile/MT5MobileShell.tsx` |
| Phone chart bar (`☰ ✛ ∿ M30 ◐ ▭`) | `components/game/CandleChart.tsx`, `phone` prop |
| Quick timeframe strip + the 21-period sheet | `lib/game/mobileTimeframes.ts` + the bar above |
| One-click trading panel | `components/game/mobile/MT5OneClickPanel.tsx` |
| Trade screen (account block + position rows) | `components/game/mobile/MT5MobileTrade.tsx` |
| Phone Quotes row + its context menu | `components/game/MarketWatch.tsx` (`phone`), `mobile/MT5MobileQuoteMenu.tsx` |
| Advanced / Simple view mode | `lib/game/quotesView.ts` |
| The phone order ticket (section 5a) | `components/game/mobile/MT5MobileOrder.tsx` |
| The day's range on the quote | `packages/shared/src/candles.ts` (`dayExtremes`), `apps/engine/src/markethistory.ts` (`dayRange`) |
| The advanced trading dialog (section 5b) | `components/game/mobile/MT5TradeDialog.tsx` |
| Its SL/TP level model | `lib/game/levels.ts`, `lib/game/levelsStore.ts` |
| Its adaptive seven-cell volume stepper | `lib/game/volumeSteps.ts` |
| Messages (Broker chat) | `components/game/mobile/MT5MobileMessages.tsx` |
| Order logic shared by both tickets | `lib/game/useOrderEntry.ts` |
| Which shell renders | `lib/ui/useIsPhone.ts`, branched in `TradeSurface` |

The phone shell and the desktop layout are chosen in JavaScript, not with `lg:hidden`, because they
are different TREES: hiding one with CSS would mount two charts, two quote subscriptions and two
sets of chart state.

## The order ticket is its own screen, not the desktop one

The New Order screen shipped first as the docked desktop ticket pushed over the shell: a bordered
card of label/value rows with two filled blue and red rectangles under a centred price. That is the
DESKTOP dialog, and the filled rectangles are iOS's treatment of the phone one; Android's phone
ticket, which is the build the rest of this shell follows, is a different screen with no fills at
all. `MT5MobileOrder` is Android's, field for field (section 5a, `android/en/open_market.png`):

| # | MetaTrader | Here |
|---|---|---|
| 1 | back, symbol bold, description subtitle | same |
| 2 | order type, full width, centred, triangle at the right | same, and disabled: every contract is market execution |
| 3 | `-0.5 -0.1 -0.01 [0.61] +0.01 +0.1 +0.5`, steps adaptive, tap the value to type | same, both gestures |
| 4 | Bid and Ask, large, side by side | one price, centred, for the reason above |
| 5 | `- SL +` orange underline, `- TP +` green underline | same rows and the same two rules |
| 6 | `Fill policy` ..... `Fill or Kill` | same, with Android's dotted leader |
| 7 | a tick chart | the live tick buffer, drawn with no value axis |
| 8 | a warning line | the one true of THIS contract, not MetaTrader's slippage sentence |
| 9 | `SELL`/`BY MARKET` red #D00000, `BUY`/`BY MARKET` blue #0064F2, text only, thin divider | same |

The volume steps scale with the value (`-5 -1 [7.00] +1 +5` at a volume of 7), which MetaQuotes
documents only by showing two screenshots at two volumes. The rule derived from them is
`D/10, D, 5D` for `D = 10^floor(log10(value))`, clamped so the finest cell is never below the
instrument's own volume step; `lib/game/volumeSteps.test.ts` pins it against both screenshots.

The tick chart really is ticks: the engine streams them and the client keeps the buffer, so the band
draws the same live edge the chart's forming candle is built from. It is drawn without the canvas's
value axis, because that axis is the curve's unitless value and a scale running 0.8 to -0.8 directly
under a quote of 3081.42 reads as a second price that disagrees with the first.

## The advanced trading dialog, and what its SL/TP really do

MetaTrader has TWO order screens on a phone and they are reached from different places. The classic
full-screen ticket (section 5a) is pushed from the Trade tab's `+`; the advanced dialog (5b) is
"used from the chart", and the classic ticket's top-right button switches to it. All three routes
are wired exactly that way here, and both screens place the same order through `useOrderEntry`.

The advanced dialog is where MetaTrader's real Stop Loss and Take Profit live, and it carries them:

| | |
|---|---|
| Levels stored in | POINTS, signed, as MetaTrader stores pips, so a level restored onto the next order still means something after the price has moved |
| Unit control | `Price \| Pips \| Currency`, MetaTrader's three |
| Chips | red `SL` #DD5B4E, green `TP` #0EB52E, Android's measured hexes |
| Default shape | buy-shaped: TP above the price, SL below |
| Tapping the other side | swaps them, and is idempotent |
| Inverting them by hand | disables **Buy** and leaves Sell, "on the assumption you meant it" |
| A pair on one side of the price | red, and both buttons dead |
| The lock | fixes the TP:SL **ratio**, so one level drags the other proportionally, and persists across orders |
| Remembered | levels and lock, most-recent only, **not** per symbol, as MetaTrader's are |

All of it is `lib/game/levels.ts`, unit-tested there against each of those sentences.

### What the engine will act on, which is a different question

```
if (this.pool?.enabled()) throw new Error("SELL_DISABLED: manual sell is disabled in pool mode");
if (!p.sellable)          throw new Error("NOT_SELLABLE: losing positions settle at expiry");
```
with `sellable: outcome.result === "win"`, set at open. So:

- on a **pool brand** every manual close is refused, and neither level can ever fire;
- on any brand, a position may be closed early only if it was already decided a **win**, so a stop
  loss can never fire by construction.

The dialog therefore renders MetaTrader's controls exactly and states what each does here, in the
slot where MetaTrader prints the level's money value: the stop reads `Risk <stake>`, because the
stake is the most this contract can lose whatever the price does, and the target reads what the
contract settles at. In `Currency` mode the stop is the stake and the target reads `varies`, because
the payout is a multiplier assigned at open that rises with elapsed time and no level determines it.

Two layout concessions at 360px, both measured rather than preferred:

- The lock sits at the end of the unit row rather than between the chips. MetaTrader puts it
  between them; with this app's 44px minimum tap targets, a chip, two of those buttons and a full
  price came to 166px against 164 available, and the price ellipsized to `30…`.
- The chip sits above its stepper rather than beside it, for the same budget.

The dialog's scroller is `overflow-x-hidden`. The order-type strip bleeds past it to scroll edge to
edge, which made the scroller horizontally scrollable too, and once anything nudged it the whole
sheet sat 14px off the left edge with the symbol, the SL chip and the money lines clipped.

### Dragging them on the chart

MetaTrader draws both levels on the chart and lets a finger move them: "Tap 'SL' / 'TP' then drag
those levels; as you drag, potential P/L shows in points and in money" (section 3), and the dialog's
row 13 has the same lines under it. `components/game/mobile/MT5ChartLevels.tsx` is that surface, and
it is the SAME pair the dialog holds: dragging the line moves the dialog's figure and stepping the
dialog's figure moves the line, because both read `levelsStore`. The ratio lock applies here too,
which is MetaTrader's own wording: it holds "including while dragging on the chart".

The money the drag label shows is the stop's stake and the target's `varies`, for the reason above.
The distance in points is real and is shown.

Four things had to be got right, each of which was wrong first:

- **A level is a price, not a distance from the live price.** Rendered against whatever the price
  happened to be when each surface read it, a stop 100 points below the market crawled down with the
  market and never sat anywhere, and the chart and the dialog disagreed about the same stop because
  they sampled the price a fraction of a second apart. The store now holds the `ref` the distances
  were anchored at. Points are still what survives to the next order, which is what MetaTrader keeps
  pips for.
- **The anchor is read from storage once per page load, not once per mounting component.** The
  restore deliberately clears the anchor so the first surface to render a restored pair re-bases it
  on the live price. Running that twice throws away an anchor a live level is being measured from:
  the dialog restored on every open, so reopening it moved a stop the trader had just dragged.
- **The drag is decided by a ref, not by state.** A pointer that moves fast emits moves before React
  has re-rendered from the `pointerdown`, so a handler reading state saw `null` and did nothing: a
  slow drag worked and a flick was ignored, which on a touch screen is most of them.
- **The tags are pushed apart when they would collide.** They are 44px tall, this app's minimum tap
  target on a control that moves money, so a tight stop and target produced overlapping tags and the
  one drawn second swallowed the other's taps entirely. The tags move; the dashed rules stay on the
  exact prices, so the levels still read where they are set.

The layer is `pointer-events-none` with only the two tags `pointer-events-auto`, because the plot is
the chart's own pan and pinch surface and a full-size overlay that took pointer events swallowed
every gesture on the chart.

## Deviations, and the reason for each

| MetaTrader | Here | Why |
|---|---|---|
| Opens on the tab last used; a fresh install opens on Quotes | Opens on **Charts** | A trader arriving from a link has come to see the price. The last tab is still remembered. |
| One-click panel sits under the top bar by default | Sits along the **bottom** | MetaTrader's own "One Click panel at the bottom" setting. The phone screen already ends in the tab bar, and the panel wants to be where the thumb is. |
| SELL carries the bid, BUY the ask | Both carry **one price** | There is no spread: a contract opens and settles on the same seeded number. Two different prices would say the player buys at one and sells at the other. |
| Quotes row shows Bid and Ask with `L:`/`H:` beneath | One price, with `L:`/`H:` beneath it | One price, as above, so the pair sits under it together rather than one under each. |
| Trade screen has an `Orders` section | Absent | Every contract is market execution, so there are no pending orders. An empty section headed "Orders" promises a feature. |
| Position menu offers `New order` | Absent | The engine holds one position at a time, so there is nothing to pre-fill a second from. |
| Messages has six chat categories | One, `Broker` | The other five are MQL5.community, VPS rental and a code marketplace. Five empty rows would be a menu of things this product does not have. |
| Chart's `◐` places a pending order | Present and disabled, with the reason | Market execution only. A button drawn as if it worked is worse than one that says why it cannot. |
| Phone has no Market Watch tab strip | The strip is hidden on a phone | Its destinations moved into the row context menu, where MetaTrader's phone keeps them: `Properties` is the Specification, `Market statistics` is the session figures. |
| Android's quick-strip gesture is a long press | Long press, 600ms | Same gesture; the timing is this shell's. |
| The ticket's order type is a selector over five types | Present, showing Market Execution, disabled | The other four are pending orders, and this engine has none. |
| The ticket has no expiry | An `Expiry` row | MetaTrader's positions run until closed; these settle on a timer the trader picks, which is the single most important fact about the trade. |
| The advanced dialog's volume unit switches to Margin | The selector states `Lots` only | The margin on this contract IS the stake, which the line below already prints, so the second mode would be two names for one number. |
| It attaches a comment of up to 31 characters | The row says the contract carries none | Nothing on this platform reads an order comment back. |
| Its SL/TP levels are draggable on the chart | Not draggable | The on-chart level drag is still to build; the dialog sets the same levels. |

### The one-click panel's colour

Both blocks are the same colour, tinted by the last tick's direction rather than by side. That is
MetaTrader: every official screenshot of the panel, on both platforms, shows SELL and BUY in the
same flat red (#D85852 Android, #D54A36 iOS). The red is used verbatim. The **up** state is an
inference — MetaQuotes publishes no screenshot or sentence for it — so its blue is the one colour
MetaQuotes does document for "the current price is higher than the previous one", #3183ff, rather
than a hex invented to sit beside the measured red. See `lib/game/oneClick.ts`.

### Every glyph is drawn

The phone chrome was written with Unicode characters first (`☰ ✛ ∿ ◐ ▭ ⌃ ⌄ ⌶ ✓`). Two of them came
out as blank boxes, including the volume stepper's increase arrow — a blank button on the one
control that changes the stake. All of them are inline SVG now, and the probe asserts that no phone
control carries one of those characters as text.

## Still missing

1. **Unread state on Messages.** MetaTrader shows an unread count beside the category title, a blue
   circle on a chat with new messages, and a red badge on the Messages tab. The notifications API
   gives a notification no read state, so all three would be decoration. `MT5MobileTabs` already
   takes an `unread` prop for when it exists.
2. **Swipe actions.** Android documents a six-icon swipe menu on a Trade row; iOS documents a
   three-icon one and a swipe on a Quotes row. Only the tap menus are built.
3. **Landscape full-screen.** "Rotate to landscape = full-screen mode, automatically."

## The day's range, which used to be missing

`L:` and `H:` are now on the row, and they come from the engine. The reason is worth keeping:

MetaTrader prints the session's low and high under the Bid and the Ask. The quote fan-out carried no
day range, and the obvious client-side fix — fold the day's bars for each watched symbol — is wrong
twice over. It would have a phone fetch a day of bars for each of twenty rows to print two numbers
each; and, worse, **this curve is deterministic for the whole day the moment its seed is known**, so
folding the day's bars returns the extremes of a day that has not happened yet. A high the price
will reach this evening, printed at breakfast as though it had.

So `symbol_ticks` carries `high` and `low`, already mapped through the day's anchor into prices, and
`MarketHistory.dayRange` walks the curve only as far as the current second. It keeps the walk's
position, so the fan-out extends it by the seconds since the last tick rather than rebuilding it;
`dayExtremes` in the shared package is the walk itself, and its tests pin that extending in steps
gives exactly the answer walking from zero does, and that the full day's high beats noon's.
