'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Direction } from '@invest254/shared';
import { valueOfRate } from '@invest254/shared/candles';
import { LOT_STAKE_CENTS } from '@invest254/shared/account';
import { useGameSocket, useGameSocketApi } from '@/lib/game/GameSocketProvider';
import { useChartSymbolStore } from '@/lib/game/chartSymbol';
import { useStakeLimits } from '@/lib/game/useStakeLimits';
import { useSession } from '@/lib/auth/session';
import { useWallet } from '@/lib/wallet/hooks';
import { useDepositUi } from '@/lib/wallet/depositUi';
import { useHydrated } from '@/lib/useHydrated';
import { useBrand } from '@/lib/brand/BrandProvider';
import { useVolumeStore, useRestoreVolume } from '@/lib/game/volume';
import { api } from '@/lib/api/endpoints';
import type { ActivePosition } from '@/lib/game/betting';
import type { Tick } from '@/lib/game/types';
import type { LocalRefusal } from '@/lib/game/orderResult';

/**
 * Everything an order-entry surface needs, in one place.
 *
 * MetaTrader has two of them, and so does this terminal: the full order ticket (desktop, and the
 * phone's own New Order screen) and the chart's one-click panel. They are the same order — the same
 * volume, the same limits, the same deposit routing, the same `openPosition` call — wearing
 * different controls, so the logic is here rather than written twice.
 *
 * It was written twice for about an hour, which is how this hook came to exist: `place()` carries
 * the rule that a tap by a logged-out or short-funded player is buying intent and must open the
 * deposit sheet seeded with the stake rather than fail, and two copies of that rule would drift.
 */
export interface OrderEntry {
  /** False until the client has mounted; a surface renders a skeleton rather than a wrong stake. */
  ready: boolean;

  /** The symbol the CHART is on, which is the one the surface names. */
  symbol: string;
  /** The symbol this brand settles, which is the only one an order can be placed on. */
  settledSymbol: string;
  digits: number;
  /** The live price of `symbol`, or null before the first quote. */
  price: number | null;
  /** True when the chart is on a symbol this brand will not accept an order on. */
  tradeDisabled: boolean;
  connecting: boolean;

  lots: number;
  minLots: number;
  maxLots: number;
  /** Decimals the volume prints to: 3 where the brand's minimum is not a whole 0.01 lots. */
  volDigits: number;
  setLots: (lots: number) => void;
  /** Add to the volume and clamp it to the brand's limits. */
  bump: (delta: number) => void;
  stakeCents: number;
  /** Signed in, and the stake is more than the wallet holds. */
  overBalance: boolean;
  /** Whether there is a session at all, which decides whether `overBalance` is worth reporting. */
  signedIn: boolean;

  durationS: number;
  setDurationS: (s: number) => void;
  durations: readonly number[];

  /** Place the order, or route to the deposit sheet. A no-op where trade is disabled. */
  /**
   * Send the order, and say what happened to it.
   *
   * `'sent'` means a frame went to the engine and the window should wait for the result;
   * `'deposit'` means the tap was routed to the deposit sheet, which is its own surface and needs
   * no rejection in the window; anything else is a refusal with its reason.
   */
  place: (dir: Direction) => 'sent' | 'deposit' | LocalRefusal;

  activePosition: ActivePosition | null;
  earlyCloseEnabled: boolean;
  tick: Tick | null;
  /** The display price of a raw engine rate, on the CURRENT day's anchor. */
  priceOfRate: (rate: number | null | undefined) => number | null;
  market: ReturnType<ReturnType<typeof useGameSocketApi>['getMarket']>;
  /** Back to the brand's own symbol, which is how a surface offers the way out of Disabled. */
  chartSettled: () => void;
}

/** The contract terms a ticket offers, in seconds. The Specification states them as Expiration. */
export const DURATION_OPTIONS = [10, 30, 60, 120];

/** "10s", "1m", "2m" — the labels the Expiry row prints. */
export const durationLabel = (s: number): string => (s < 60 ? `${s}s` : `${s / 60}m`);

export function useOrderEntry(): OrderEntry {
  const hydrated = useHydrated();
  const brand = useBrand();
  const token = useSession((s) => s.token);
  const openDeposit = useDepositUi((s) => s.openDeposit);
  const limits = useStakeLimits();
  const { data: wallet } = useWallet();
  const { status, activePosition, openPosition, earlyCloseEnabled } = useGameSocket();
  const { getLastTick, getMarket, getSymbolQuote } = useGameSocketApi();
  const charted = useChartSymbolStore((st) => st.symbol);
  const setCharted = useChartSymbolStore((st) => st.set);
  const { data: config } = useQuery({
    queryKey: ['gameConfig', brand.slug],
    queryFn: () => api.gameConfig(brand.slug),
    staleTime: 5 * 60_000,
  });

  const defaultDurationS = config?.defaultDurationS ?? 10;
  const [durationS, setDurationS] = useState<number>(defaultDurationS);
  useEffect(() => { setDurationS(defaultDurationS); }, [defaultDurationS]);

  // Quote updates ride the tick stream, which does not re-render React on its own.
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => (n + 1) % 1_000_000), 250);
    return () => clearInterval(id);
  }, []);

  const market = getMarket();
  /**
   * The surface follows the CHART, as MetaTrader's order dialog does: it belongs to the symbol you
   * opened it on. This brand settles one of them, so every other symbol is quoted and charted with
   * MetaTrader's own `Disabled` trade mode, and the surface says so rather than offering a button
   * that would open a position on a different instrument from the one on screen.
   */
  const quote = charted === null ? null : getSymbolQuote(charted);
  const tradeDisabled = charted !== null;
  const settledSymbol = market?.instrument.symbol ?? 'XAUUSD';
  const symbol = charted ?? settledSymbol;
  const digits = quote?.instrument.digits ?? market?.instrument.digits ?? 2;
  const tick = getLastTick();
  const priceOfRate = (rate: number | null | undefined): number | null =>
    market && rate !== null && rate !== undefined
      ? market.anchor.base + market.instrument.scale * (valueOfRate(rate) - market.anchor.openValue)
      : null;
  const price = charted === null ? (tick ? priceOfRate(tick.rate) : null) : quote?.price ?? null;

  // ── Volume ─────────────────────────────────────────────────────────────────────────────────────
  // Lots are the stake divided by the contract size. The brand's MINIMUM is the floor, so the
  // smallest selectable volume is whatever that minimum is worth — exactly how MetaTrader derives a
  // symbol's minimum volume — rather than a round number that would sit under it.
  const minLots = limits.minCents / LOT_STAKE_CENTS;
  // A brand may set no ceiling; the wallet is then the only limit, so volume is left open.
  const maxLots = (limits.maxCents ?? Number.MAX_SAFE_INTEGER) / LOT_STAKE_CENTS;
  // If the minimum is not a whole number of 0.01 lots, show the extra decimal rather than print a
  // rounded volume that does not match the stake actually sent.
  const volDigits = Math.abs(minLots * 100 - Math.round(minLots * 100)) < 1e-9 ? 2 : 3;
  /**
   * The volume lives in a shared store, not in this hook's own state.
   *
   * Two surfaces can place an order — the chart's one-click panel and the order ticket — and
   * MetaTrader treats them as one order: step the panel to 0.10, tap BUY, and the dialog opens on
   * 0.10. With a `useState` per hook instance it opened on the brand's minimum and the volume the
   * trader had chosen was dropped. See lib/game/volume.
   */
  const stored = useVolumeStore((st) => st.lots);
  const setStored = useVolumeStore((st) => st.set);
  useRestoreVolume();

  const clampLots = (v: number): number => {
    const snapped = Number(v.toFixed(volDigits));
    return Math.min(maxLots, Math.max(minLots, snapped));
  };
  /**
   * Clamped on READ as well as on write, so a volume remembered from a session when the brand
   * allowed more cannot survive the brand lowering its ceiling, and a stake below a raised minimum
   * cannot be sent.
   */
  const lots = stored === null ? minLots : clampLots(stored);
  // The first surface to learn the brand's limits seeds the store with the minimum, which is what
  // MetaTrader opens a fresh ticket on.
  useEffect(() => {
    if (!limits.ready || useVolumeStore.getState().lots !== null) return;
    useVolumeStore.setState({ lots: minLots });
  }, [limits.ready, minLots]);

  const bump = (delta: number) => setStored(clampLots(lots + delta));
  const setLots = (v: number) => setStored(clampLots(v));

  const stakeCents = Math.round(lots * LOT_STAKE_CENTS);
  const spendable = (wallet?.real ?? 0) + (wallet?.bonus ?? 0);
  const overBalance = !!token && stakeCents > spendable;
  const connecting = status !== 'open';

  const durations = useMemo(
    () => Array.from(new Set([...DURATION_OPTIONS, defaultDurationS])).sort((a, b) => a - b),
    [defaultDurationS],
  );

  function place(dir: Direction): 'sent' | 'deposit' | LocalRefusal {
    if (connecting) return 'OFFLINE';
    // Defence in depth behind the disabled buttons: this brand settles one symbol, and an order
    // raised while the chart is on another would open a position on an instrument the trader is
    // not looking at.
    if (tradeDisabled) return 'WRONG_SYMBOL';
    // A logged-out or short-funded tap is real buying intent: route it to the deposit sheet seeded
    // with this stake, which then resumes the trade. Same behaviour as the classic panel.
    if (!token || overBalance) {
      openDeposit({ amountCents: stakeCents, pending: { direction: dir, stakeCents } });
      return 'deposit';
    }
    // Null means it went. Anything else is the engine's rule, refused here, and the order window
    // says so: this used to be a silent return and a tap that did nothing.
    return openPosition({ stakeCents, direction: dir, durationS }) ?? 'sent';
  }

  return {
    ready: hydrated,
    symbol, settledSymbol, digits, price, tradeDisabled, connecting,
    lots, minLots, maxLots, volDigits, setLots, bump, stakeCents, overBalance, signedIn: !!token,
    durationS, setDurationS, durations,
    place,
    activePosition, earlyCloseEnabled, tick, priceOfRate, market,
    chartSettled: () => setCharted(null),
  };
}
