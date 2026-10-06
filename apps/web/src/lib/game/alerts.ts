'use client';

import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { logJournal } from '@/lib/game/journal';

/**
 * Alerts — the real mechanism behind MetaTrader's Alerts tab and its Alert Editor.
 *
 * An alert is a condition on this symbol plus MetaTrader's four repeat controls: a counter, a
 * maximum number of iterations, a timeout between firings and an expiration. The watcher checks
 * them against the same live price the chart draws and fires genuinely: the counter advances, a
 * Journal line is written and the caller is handed the alert so it can raise a toast.
 *
 * THE CONDITION LIST IS SHORTER THAN METATRADER'S, AND THAT IS THE DOCUMENTED ANSWER.
 * 09-toolbox.md 933-935 lists nine: `Bid < Bid > Ask < Ask > Last < Last > Volume < Volume > Time =`.
 * This platform quotes ONE price per symbol, and docs/mt5/10-market-watch.md 417-419 settles what a
 * one-price platform does with that: it "keeps `Symbol`, `Time`, `Daily Change`, `Last`-family and
 * the volume family unchanged, and must delete `Bid`, `Ask` and `Spread` outright rather than fold
 * them. There is no MetaTrader precedent for a merged price column." So the Bid and Ask families
 * are deleted, not renamed and not drawn four times over one number, and the surviving price
 * family is `Last`, which is also what Market Watch heads its one quote column here.
 * `Volume <` / `Volume >` go too, for a different reason: the feed carries no volume at all (a tick
 * is `{ t, rate, delta }`), so there is nothing to compare. `Time =` stays, because it never needed
 * a second price — "an alert triggers at the specified time ... the local computer time in the
 * format HH:MM" (09-toolbox.md 937-938).
 *
 * ONE HONEST LIMIT. MetaTrader runs alerts on the broker's server, so they fire with the app shut.
 * These are stored in the browser and checked by the open tab, so an alert only fires while the
 * terminal is open. The UI says so rather than letting a player assume otherwise.
 *
 * Alerts are per browser, persisted, and never touch money: nothing here can open, close or price
 * a position.
 */

export type AlertCondition = 'last<' | 'last>' | 'time=';

/** The conditions this platform can genuinely evaluate, in MetaTrader's own order and wording. */
export const ALERT_CONDITIONS: ReadonlyArray<{ key: AlertCondition; label: string }> = [
  { key: 'last<', label: 'Last <' },
  { key: 'last>', label: 'Last >' },
  { key: 'time=', label: 'Time =' },
];

export const conditionLabel = (c: AlertCondition): string =>
  ALERT_CONDITIONS.find((x) => x.key === c)?.label ?? c;

export interface PriceAlert {
  id: string;
  /** MetaTrader's `Enable` checkbox: a disabled alert is kept and never checked. */
  enabled: boolean;
  symbol: string;
  condition: AlertCondition;
  /** The level a `Last` condition compares against. Unused by `Time =`. */
  price: number;
  /** Local computer time `HH:MM` for `Time =`, as MetaTrader specifies it. Unused otherwise. */
  timeHHMM: string;
  /** `Maximum iterations`: how many times this alert may fire before it stops itself. */
  limit: number;
  /** `Timeout`, in seconds: the quiet period after a firing. MetaTrader's rows read `10 sec`. */
  timeoutS: number;
  /** `Expiration`: epoch ms after which it is no longer checked. Null is MetaTrader's blank cell. */
  expiresAtMs: number | null;
  /** `Counter`: how many times it has fired. */
  counter: number;
  createdAtMs: number;
  /** Epoch ms it last fired, or null while it never has. */
  triggeredAtMs: number | null;
}

/** What the Alert Editor hands the store. Everything else is bookkeeping the store owns. */
export type AlertDraft = Pick<
  PriceAlert, 'enabled' | 'symbol' | 'condition' | 'price' | 'timeHHMM' | 'limit' | 'timeoutS' | 'expiresAtMs'
>;

interface AlertsState {
  alerts: PriceAlert[];
  /** MetaTrader's `Create`. */
  add: (draft: AlertDraft) => void;
  /** MetaTrader's `Modify` — the editor reopened on an existing row. */
  update: (id: string, draft: AlertDraft) => void;
  remove: (id: string) => void;
  /** MetaTrader's `Enable`, which is a toggle on the selected row. */
  toggle: (id: string) => void;
  markTriggered: (id: string, atMs: number) => void;
  /** Re-arm a spent alert: the counter back to zero and enabled again. */
  rearm: (id: string) => void;
  clearTriggered: () => void;
}

/** Bound so a persisted list cannot grow without limit. */
const MAX_ALERTS = 50;

/** MetaTrader's own defaults, read off the example rows at 09-toolbox.md 906-908. */
export const ALERT_DEFAULTS = { limit: 10, timeoutS: 10 } as const;

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export const useAlertsStore = create<AlertsState>()(
  persist(
    (set) => ({
      alerts: [],
      add: (draft) =>
        set((s) => ({
          alerts: [
            { id: newId(), ...draft, counter: 0, createdAtMs: Date.now(), triggeredAtMs: null },
            ...s.alerts,
          ].slice(0, MAX_ALERTS),
        })),
      update: (id, draft) =>
        set((s) => ({ alerts: s.alerts.map((a) => (a.id === id ? { ...a, ...draft } : a)) })),
      remove: (id) => set((s) => ({ alerts: s.alerts.filter((a) => a.id !== id) })),
      toggle: (id) =>
        set((s) => ({ alerts: s.alerts.map((a) => (a.id === id ? { ...a, enabled: !a.enabled } : a)) })),
      markTriggered: (id, atMs) =>
        set((s) => ({
          alerts: s.alerts.map((a) => {
            if (a.id !== id) return a;
            const counter = a.counter + 1;
            // MetaTrader's `Maximum iterations` is a stop, not a suggestion: a spent alert is kept
            // on the tab with the disabled gutter icon rather than deleted behind the trader's back.
            return { ...a, counter, triggeredAtMs: atMs, enabled: counter < a.limit };
          }),
        })),
      rearm: (id) =>
        set((s) => ({
          alerts: s.alerts.map((a) => (a.id === id ? { ...a, counter: 0, triggeredAtMs: null, enabled: true } : a)),
        })),
      clearTriggered: () => set((s) => ({ alerts: s.alerts.filter((a) => a.counter === 0) })),
    }),
    {
      name: 'pp-price-alerts',
      version: 1,
      /**
       * Alerts saved before the Alert Editor existed carried `{ above, price }` and nothing else.
       * `above` was this product's own wording for a direction; it maps onto the condition list
       * exactly, so an old alert keeps working instead of being silently dropped or, worse, read
       * back with an undefined limit and never firing again.
       */
      migrate: (persisted: unknown, version: number): { alerts: PriceAlert[] } => {
        const alerts = (persisted as { alerts?: unknown })?.alerts;
        if (version >= 1 || !Array.isArray(alerts)) return { alerts: Array.isArray(alerts) ? alerts as PriceAlert[] : [] };
        return {
          alerts: (alerts as Array<Record<string, unknown>>).map((a) => ({
            id: typeof a.id === 'string' ? a.id : newId(),
            enabled: a.triggeredAtMs === null,
            symbol: String(a.symbol ?? ''),
            condition: a.above === false ? 'last<' : 'last>',
            price: Number(a.price ?? 0),
            timeHHMM: '',
            limit: ALERT_DEFAULTS.limit,
            timeoutS: ALERT_DEFAULTS.timeoutS,
            expiresAtMs: null,
            counter: a.triggeredAtMs === null ? 0 : 1,
            createdAtMs: Number(a.createdAtMs ?? Date.now()),
            triggeredAtMs: typeof a.triggeredAtMs === 'number' ? a.triggeredAtMs : null,
          })),
        };
      },
    },
  ),
);

/** `HH:MM` on the LOCAL computer clock, which is the zone `Time =` is specified in. */
const localHHMM = (ms: number): string => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/**
 * Is this alert due right now?
 *
 * Pure, so the rule is one expression rather than a nest of guards inside the interval: disabled,
 * expired and spent alerts are not checked at all, a firing is held off until the timeout has run,
 * and a `Time =` alert may fire only once inside the minute it names — otherwise a ten-second
 * timeout would fire it six times over that minute.
 */
export function alertDue(a: PriceAlert, price: number | null, nowMs: number): boolean {
  if (!a.enabled || a.counter >= a.limit) return false;
  if (a.expiresAtMs !== null && nowMs > a.expiresAtMs) return false;
  if (a.triggeredAtMs !== null && nowMs - a.triggeredAtMs < a.timeoutS * 1000) return false;
  if (a.condition === 'time=') {
    if (a.timeHHMM !== localHHMM(nowMs)) return false;
    return a.triggeredAtMs === null || localHHMM(a.triggeredAtMs) !== a.timeHHMM;
  }
  if (price === null || !Number.isFinite(price)) return false;
  // Strict, because the row says `Last < 3071.82` and not `Last ≤ 3071.82`.
  return a.condition === 'last<' ? price < a.price : price > a.price;
}

/**
 * Watch the live price and the clock, and fire whatever is due.
 *
 * `getPrice` is polled rather than subscribed to, because the price arrives on an animation-frame
 * tick loop and alerting does not need that resolution — twice a second is well inside what a
 * person perceives, and keeps this off the render path.
 */
export function useAlertWatch(
  getPrice: () => number | null,
  symbol: string,
  onFire?: (alert: PriceAlert, price: number | null) => void,
): void {
  const onFireRef = useRef(onFire);
  onFireRef.current = onFire;

  useEffect(() => {
    const id = setInterval(() => {
      const price = getPrice();
      const now = Date.now();
      const { alerts, markTriggered } = useAlertsStore.getState();
      for (const a of alerts) {
        if (a.symbol !== symbol || !alertDue(a, price, now)) continue;
        markTriggered(a.id, now);
        logJournal(
          'warn',
          'Alert',
          a.condition === 'time='
            ? `${a.symbol} ${conditionLabel(a.condition)} ${a.timeHHMM}`
            : `${a.symbol} ${conditionLabel(a.condition)} ${a.price}${price === null ? '' : ` (last ${price})`}`,
        );
        onFireRef.current?.(a, price);
      }
    }, 500);
    return () => clearInterval(id);
  }, [getPrice, symbol]);
}
