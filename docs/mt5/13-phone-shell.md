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
| Messages (Broker chat) | `components/game/mobile/MT5MobileMessages.tsx` |
| Order logic shared by both tickets | `lib/game/useOrderEntry.ts` |
| Which shell renders | `lib/ui/useIsPhone.ts`, branched in `TradeSurface` |

The phone shell and the desktop layout are chosen in JavaScript, not with `lg:hidden`, because they
are different TREES: hiding one with CSS would mount two charts, two quote subscriptions and two
sets of chart state.

## Deviations, and the reason for each

| MetaTrader | Here | Why |
|---|---|---|
| Opens on the tab last used; a fresh install opens on Quotes | Opens on **Charts** | A trader arriving from a link has come to see the price. The last tab is still remembered. |
| One-click panel sits under the top bar by default | Sits along the **bottom** | MetaTrader's own "One Click panel at the bottom" setting. The phone screen already ends in the tab bar, and the panel wants to be where the thumb is. |
| SELL carries the bid, BUY the ask | Both carry **one price** | There is no spread: a contract opens and settles on the same seeded number. Two different prices would say the player buys at one and sells at the other. |
| Quotes row shows Bid and Ask with `L:`/`H:` beneath | One price, no `L:`/`H:` | One price, as above. The day range is a **gap**, not a decision — see below. |
| Trade screen has an `Orders` section | Absent | Every contract is market execution, so there are no pending orders. An empty section headed "Orders" promises a feature. |
| Position menu offers `New order` | Absent | The engine holds one position at a time, so there is nothing to pre-fill a second from. |
| Messages has six chat categories | One, `Broker` | The other five are MQL5.community, VPS rental and a code marketplace. Five empty rows would be a menu of things this product does not have. |
| Chart's `◐` places a pending order | Present and disabled, with the reason | Market execution only. A button drawn as if it worked is worse than one that says why it cannot. |
| Phone has no Market Watch tab strip | The strip is hidden on a phone | Its destinations moved into the row context menu, where MetaTrader's phone keeps them: `Properties` is the Specification, `Market statistics` is the session figures. |
| Android's quick-strip gesture is a long press | Long press, 600ms | Same gesture; the timing is this shell's. |

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

1. **`L:` and `H:` on the Quotes row.** MetaTrader prints the day's low and high under the Bid and
   Ask. The engine's quote fan-out (`symbol_ticks`) carries no day range, and fetching a day of bars
   per watched symbol from a phone to derive one would be the wrong way to get it: the engine
   already holds the day. The range belongs on the quote message.
2. **Unread state on Messages.** MetaTrader shows an unread count beside the category title, a blue
   circle on a chat with new messages, and a red badge on the Messages tab. The notifications API
   gives a notification no read state, so all three would be decoration. `MT5MobileTabs` already
   takes an `unread` prop for when it exists.
3. **Swipe actions.** Android documents a six-icon swipe menu on a Trade row; iOS documents a
   three-icon one and a swipe on a Quotes row. Only the tap menus are built.
4. **Landscape full-screen.** "Rotate to landscape = full-screen mode, automatically."
