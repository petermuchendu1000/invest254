'use client';

import { useState } from 'react';
import { accountSummary, mobileAccountRows, mtAmount, lotsOfStake } from '@invest254/shared/account';
import { useGameSocket, useGameSocketApi } from '@/lib/game/GameSocketProvider';
import { useWallet } from '@/lib/wallet/hooks';
import { useDisplayMoney } from '@/lib/money';
import { useOrderEntry } from '@/lib/game/useOrderEntry';
import { MT5PositionMenu } from '@/components/game/MT5PositionMenu';
import { MT5ClosePosition } from '@/components/game/MT5ClosePosition';
import { MT5ModifyPosition } from '@/components/game/MT5ModifyPosition';
import {
  MT5SwipeRow, SwipeCloseIcon, SwipeEditIcon, SwipePlusIcon, SwipeChartIcon, SwipeDepthIcon,
  type SwipeCommand,
} from '@/components/game/mobile/MT5SwipeRow';
import { ticketLabel } from '@/lib/game/betting';
import { cn } from '@/lib/cn';

/**
 * MetaTrader mobile's Trade screen.
 *
 * Top bar carrying the total floating profit in blue, then the account summary block, then a
 * `Positions` section of two-line rows (docs/mt5/04-mobile-app.md section 4). Every label, every
 * ordering and the number format are MetaTrader's own, read off `android/en/trade.png`:
 *
 *     Balance:            9 862.16
 *     Equity:             9 897.11
 *     Margin:             2 165.03
 *     Free margin:        7 732.08
 *     Margin Level (%):     457.14
 *
 * The rows themselves come from `mobileAccountRows` in the shared package, which is unit-tested
 * against that screenshot character for character — including the three things the phone does
 * differently from the desktop strip: no currency code anywhere, the per cent sign in the LABEL
 * rather than the value, and Android's lower-cased "Free margin:".
 *
 * ── The dotted leader ────────────────────────────────────────────────────────────────────────────
 * "Android draws a dotted leader between them; iOS does not." Android's is the build this shell
 * follows, so the leader is here, drawn as a repeating gradient rather than a row of full stops: a
 * literal run of dots cannot be made to end exactly where the value begins at every width.
 *
 * ── What is not here ─────────────────────────────────────────────────────────────────────────────
 * No `Orders` section. MetaTrader's Trade screen has one under Positions, and this engine has no
 * pending orders at all — every contract is market execution — so an empty section headed "Orders"
 * would be a promise of a feature rather than a view of one.
 */
export function MT5MobileTrade({ onNewOrder, onChart }: { onNewOrder: () => void; onChart: () => void }) {
  const money = useDisplayMoney();
  const { data: wallet } = useWallet();
  const { activePosition, status, sell, earlyCloseEnabled } = useGameSocket();
  const { getLastTick } = useGameSocketApi();
  // `volDigits` is the ORDER TICKET's own volume digits, so the row states the same lot size the
  // ticket that opened it showed (docs/mt5/09-toolbox.md 300, rows at 313-318). The row printed two
  // places whatever the symbol's step was, so a 0.025-lot position read 0.03 here.
  const { settledSymbol, digits, priceOfRate, volDigits } = useOrderEntry();

  // The floating figures ride the tick stream, which does not re-render React on its own.
  // `useOrderEntry` already drives that re-render on its own 250ms timer, and a second one here
  // only doubled the renders without showing a newer number.

  // MetaTrader reaches Close position and Modify position from the row's context menu, which is
  // what a press on the row opens. Same three sheets the desktop Toolbox uses.
  const [sheet, setSheet] = useState<null | 'menu' | 'close' | 'modify'>(null);

  // An optimistic open has no engine id yet; its stake is already committed, so it counts.
  const live = activePosition && activePosition.phase !== 'settling' ? activePosition : null;
  const floatingCents = live ? live.livePnlCents : 0;
  const summary = accountSummary({
    walletCents: (wallet?.real ?? 0) + (wallet?.bonus ?? 0),
    openStakeCents: live ? live.stakeCents : 0,
    floatingPnlCents: floatingCents,
  });
  const rows = mobileAccountRows({
    balance: money.toDisplay(summary.balanceCents),
    equity: money.toDisplay(summary.equityCents),
    margin: money.toDisplay(summary.marginCents),
    freeMargin: money.toDisplay(summary.freeMarginCents),
    marginLevelPct: summary.marginLevelPct,
  });

  const px = (rate: number | null | undefined): string => {
    const p = priceOfRate(rate);
    return p === null ? '-' : p.toFixed(digits);
  };

  /**
   * MetaTrader Android's six swipe icons on a position row, in its documented order:
   *
   *   1. Close By   2. Close position   3. Edit position   4. Increase position
   *   5. Open Chart   6. Depth of Market
   *
   * Five of them are here. `Close By` is not, and that is MetaTrader's own behaviour rather than a
   * cut: it shows that icon "hedging accounts only, and only if an opposite position on the same
   * symbol exists", and neither holds here, so MetaTrader would not draw it either.
   *
   * The two that cannot work are DIMMED and say why, not dropped. An icon bar is a map of what the
   * platform does; a short bar teaches the wrong map, and an icon that silently does nothing is
   * worse than one that says it cannot.
   *
   * `Chart` is last of the live ones, which makes it the command MetaTrader's "drag the menu
   * further to the left" fires on its own. That is the right one to land on: it navigates and
   * changes nothing, so a drag that goes further than intended cannot cost money.
   */
  const closeNote = !earlyCloseEnabled
    ? 'This brand settles every contract at expiry.'
    : live === null
      ? undefined
      : !live.sellable
        ? 'This contract settles at expiry and cannot be closed at a loss.'
        : live.phase !== 'open'
          ? 'This contract is already settling.'
          : undefined;
  const swipeCommands: readonly SwipeCommand[] = [
    { label: 'Close position', icon: SwipeCloseIcon, onPick: () => setSheet('close'), unavailable: closeNote },
    { label: 'Edit position', icon: SwipeEditIcon, onPick: () => setSheet('modify') },
    {
      label: 'Increase position',
      icon: SwipePlusIcon,
      unavailable: 'This engine holds one contract at a time, so there is no position to add to.',
    },
    { label: 'Open Chart', icon: SwipeChartIcon, onPick: onChart },
    {
      label: 'Depth of Market',
      icon: SwipeDepthIcon,
      unavailable: 'This engine quotes one price per symbol and keeps no order book, so there is no depth to show.',
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--mt5-surface)] text-white">
      {/* Android's top bar: the title small, with the total floating profit beneath it in blue, and
          the new-order button at the right. The hamburger is on the chart screen's own bar, so it
          is not repeated here. */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--mt5-border)] px-3 py-2">
        <div className="min-w-0">
          <div className="text-[11px] leading-none text-[var(--mt5-muted)]">Trade</div>
          <div
            className={cn(
              'pt-1 font-mono text-[18px] font-semibold leading-none tabular-nums',
              floatingCents > 0 ? 'text-[var(--mt5-blue)]' : floatingCents < 0 ? 'text-[var(--mt5-red)]' : 'text-[var(--mt5-blue)]',
            )}
          >
            {/* The ONE figure on this screen that names the currency: "the total floating profit
                beneath it in blue ("34.95 EUR")" (docs/mt5/04-mobile-app.md 211). The position
                rows below it are bare (242-248), and so is the account block (mobileAccountRows). */}
            {mtAmount(money.toDisplay(floatingCents))} {money.currency}
          </div>
        </div>
        <span
          className={cn('ml-auto h-1.5 w-1.5 shrink-0 rounded-full', status === 'open' ? 'bg-[var(--mt5-green)]' : status === 'connecting' ? 'bg-[#f0b90b]' : 'bg-[var(--mt5-red)]')}
          title={status === 'open' ? 'Live' : status === 'connecting' ? 'Syncing' : 'Offline'}
        />
        {/* MetaTrader's new-order button: a document with a plus. */}
        <button
          type="button"
          onClick={onNewOrder}
          aria-label="New order"
          className="grid h-9 w-9 shrink-0 place-items-center rounded text-[var(--mt5-blue)]"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
            <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" />
            <path d="M14 3v5h5" />
            <path d="M12 11v6M9 14h6" />
          </svg>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <dl className="px-3 py-2">
          {rows.map((r) => (
            <div key={r.label} className="flex items-baseline gap-1 py-[3px]">
              <dt className="shrink-0 text-[12px] text-[var(--mt5-muted)]">{r.label}</dt>
              {/* Android's dotted leader. A repeating radial gradient rather than a run of "."
                  characters: dots typed into the gap cannot be made to stop exactly where the
                  value starts at every screen width, and a leader that overruns reads as broken. */}
              <span
                aria-hidden
                className="min-w-4 flex-1 translate-y-[-3px] self-center"
                style={{
                  height: '1px',
                  backgroundImage: 'radial-gradient(circle, #2b3543 1px, transparent 1px)',
                  backgroundSize: '4px 1px',
                  backgroundRepeat: 'repeat-x',
                }}
              />
              <dd className="shrink-0 font-mono text-[13px] font-semibold tabular-nums">{r.value}</dd>
            </div>
          ))}
        </dl>

        {/* MetaTrader's section header band. */}
        <div className="border-y border-[var(--mt5-border)] bg-[var(--mt5-raised)] px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--mt5-muted)]">
          Positions
        </div>

        {live ? (
          /* MetaTrader Android's swipe-left quick commands, over the row's right side. The order is
             its documented one; what each icon does and does not do is argued below. */
          <MT5SwipeRow label={`${settledSymbol} ${live.direction}`} commands={swipeCommands}>
            <MobilePositionRow
              symbol={settledSymbol}
              direction={live.direction}
              lots={lotsOfStake(live.stakeCents, volDigits)}
              from={px(live.entryRate)}
              to={px(getLastTick()?.rate ?? null)}
              profit={money.mt(live.livePnlCents)}
              profitCents={live.livePnlCents}
              onOpenMenu={() => setSheet('menu')}
            />
          </MT5SwipeRow>
        ) : (
          <p className="px-3 py-6 text-center text-[11px] text-[var(--mt5-muted)]">No open positions.</p>
        )}
      </div>

      {/* MetaTrader's position menu and the two forms it leads to, the same three this terminal's
          desktop Toolbox opens from its own row. Its documented Android items are Close position,
          New order, Modify position and Chart; `New order` is absent because this engine holds one
          position at a time, so there is nothing to pre-fill a second one from. */}
      {live && sheet === 'menu' ? (
        <MT5PositionMenu
          title={`${settledSymbol}, ${live.direction} ${lotsOfStake(live.stakeCents, volDigits)}`}
          subtitle={`#${ticketLabel(live)} at ${px(live.entryRate)}`}
          onDismiss={() => setSheet(null)}
          items={[
            {
              id: 'close',
              label: 'Close position',
              onPick: () => setSheet('close'),
              disabled: !earlyCloseEnabled || !live.sellable || live.phase !== 'open',
              note: !earlyCloseEnabled
                ? 'This brand settles every contract at expiry.'
                : !live.sellable
                  ? 'This contract settles at expiry and cannot be closed at a loss.'
                  : undefined,
            },
            { id: 'modify', label: 'Modify position', onPick: () => setSheet('modify') },
            { id: 'chart', label: 'Chart', onPick: () => { setSheet(null); onChart(); } },
          ]}
        />
      ) : null}

      {live && sheet === 'close' ? (
        <MT5ClosePosition
          pos={live}
          symbol={settledSymbol}
          digits={digits}
          price={priceOfRate(getLastTick()?.rate ?? null)}
          openPrice={live.entryRate === null ? null : priceOfRate(live.entryRate)}
          busy={live.phase === 'settling'}
          onDismiss={() => setSheet(null)}
          onConfirm={() => { sell(); setSheet(null); }}
        />
      ) : null}

      {live && sheet === 'modify' ? (
        <MT5ModifyPosition
          pos={live}
          symbol={settledSymbol}
          digits={digits}
          openPrice={live.entryRate === null ? null : priceOfRate(live.entryRate)}
          canTakeProfit={earlyCloseEnabled}
          onDismiss={() => setSheet(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * One position, in MetaTrader's phone layout: two lines left, the profit right.
 *
 *     GBPUSD, buy 1.00                 46.91
 *     1.26622 → 1.26673
 *
 * Android's exact punctuation — a comma after the symbol, volume to two decimals — and its colour
 * rule: the side word is blue for a buy and red for a sell, and the profit is BLUE when positive,
 * not green. MT5 mobile uses blue for gains throughout, which is the single most recognisable thing
 * about its colour scheme and the easiest to get wrong.
 *
 * A press opens the context menu, which is Android's documented gesture for this row (its single
 * tap expands the row inline; there is nothing more to expand here, because this contract has no
 * swap, no comment and no stop level, so the press is the one that does something).
 */
function MobilePositionRow({
  symbol, direction, lots, from, to, profit, profitCents, onOpenMenu,
}: {
  symbol: string;
  direction: string;
  lots: string;
  from: string;
  to: string;
  profit: string;
  profitCents: number;
  onOpenMenu: () => void;
}) {
  const buy = direction === 'buy';
  return (
    <button
      type="button"
      onClick={onOpenMenu}
      aria-label={`Position menu for ${symbol} ${direction} ${lots}`}
      className="flex w-full items-start justify-between gap-3 border-b border-[var(--mt5-border)] px-3 py-2.5 text-left transition active:bg-[var(--mt5-raised)]"
    >
      <div className="min-w-0">
        <div className="text-[13px] font-bold text-white">
          {symbol},{' '}
          <span className={cn('font-semibold', buy ? 'text-[var(--mt5-blue)]' : 'text-[var(--mt5-red)]')}>{direction} {lots}</span>
        </div>
        <div className="pt-0.5 font-mono text-[12px] text-[var(--mt5-muted)] tabular-nums">{from} → {to}</div>
      </div>
      <div
        className={cn(
          'shrink-0 font-mono text-[13px] font-bold tabular-nums',
          profitCents > 0 ? 'text-[var(--mt5-blue)]' : profitCents < 0 ? 'text-[var(--mt5-red)]' : 'text-white',
        )}
      >
        {profit}
      </div>
    </button>
  );
}
