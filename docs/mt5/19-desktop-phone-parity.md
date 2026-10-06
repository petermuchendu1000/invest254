# 19. Desktop and phone, one feature at a time

Asked for: *"You need to test everything both in mobile and desktop - one item at a time, every
feature, tool, how do they behave, are they accessed in both mobile and desktop, what are their
UI/UXs...? take screenshots, compare it with official MT5, then, enforce complete UI/UX."*

## How this is measured

The phone shell and the desktop terminal are different **trees**, not one tree restyled
(`lib/ui/useIsPhone` says why). So a control present in the source proves nothing about whether a
finger can reach it, and the audit asks the only question that matters: **starting from a fresh
page, can a trader get to this feature on this shell?** `scratchpad/parity.mjs` answers it by
navigating and looking for a VISIBLE element, at 1440x900 and at 360x800.

Each row carries its own selector **per shell**, because MetaTrader itself puts the same feature in
different places on the two:

| | desktop | phone |
| --- | --- | --- |
| period | a 21-button strip across the toolbar | one button that opens a quick strip, gear for the full sheet |
| indicators | the `⚙ Tools` menu | the `∿` button |
| objects | a left-hand rail with an Insert tree | an Objects button in the top bar (iOS) / radial menu (Android) |

A row that used the same selector on both would be testing this shell's sameness, not MetaTrader's
parity.

## The gap this found

**A phone trader could not create a graphical object.** The desktop object rail is
`{phone ? null : <DrawRail .../>}` in `CandleChart.tsx`, and the phone's indicator sheet carried
only the Objects **list** — so the phone listed objects it had no way to produce. The rail was
dropped deliberately (it took 40 of 360 pixels, and MetaTrader's Android chart has no rail either),
but the thing that replaces it on MetaTrader was never built.

What MetaTrader actually does, from the researched facts in
[04-mobile-app.md](./04-mobile-app.md):

* §3 — *"iOS has a dedicated Objects button in the top bar; Android does not — on Android,
  graphical objects are reached through the radial menu only."*
* §5 — the iOS chart context menu is **Trade · Indicators · Objects · Settings · Cancel**; the
  Android radial menu's documented capabilities are *change the timeframe · attach indicators ·
  **apply objects** · enable crosshairs · open chart settings*.

So **both** phone platforms can apply an object; only the route differs. This shell now carries
iOS's route, which is the one that fits a top bar it already has: an **Objects** button beside
Indicators, opening MetaTrader's 44-object Insert tree as a sheet in its own eight groups. Picking
one arms the tool and closes the sheet, so the next tap lands on the chart — the same `setTool` the
desktop rail drives, into the same `ChartDrawings` surface, which was already rendered on the phone
and simply had nothing to arm it. The sheet also carries Cursor (a phone has no Esc to cancel a
pending object with) and the Objects list.

## Not gaps, and why

* **Pending order.** Present on the phone bar and DISABLED, with the reason on it: every contract
  here is market execution. Absent on the desktop ticket, which states `Market Execution` instead.
  Both are honest about the same fact.
* **Zoom buttons.** Desktop only, and correctly: they are `[@media(pointer:coarse)]:hidden`, and
  MetaTrader's phone chart zooms by pinch, which is documented verbatim in §6.
* **Measure.** Desktop rail only. MetaTrader's phone measures through the crosshair instead: *"tap a
  second point to measure"* (§6), which this shell's crosshair does.
* **The desktop top bar.** It is the brand's `colorPrimary` blue strip. On a phone that is right —
  MetaTrader's mobile app has a blue navigation bar. On the desktop terminal MetaTrader uses dark
  chrome with a File/View/Insert menu. A shell-structure question, carried forward.

## Probes

* `scratchpad/parity.mjs` — the reachability matrix above, both shells.
* `scratchpad/phoneobjects.mjs` — 6/6. Opens the Objects button on a 360x800 touch screen, picks
  Trendline, taps twice on the plot, and reads MetaTrader's own
  `Objects on XAUUSD,M1 (1)` heading back off the Objects list.
