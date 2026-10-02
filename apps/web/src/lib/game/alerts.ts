'use client';

import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { logJournal } from '@/lib/game/journal';

/**
 * Price alerts — the real mechanism behind MetaTrader's Alerts tab.
 *
 * An alert is a price level and a direction. The watcher compares it against the same live price
 * the chart draws, and fires once when the price crosses it. Firing is genuine: the alert is marked
 * triggered, a Journal line is written, and the caller is handed the alert so it can raise a toast.
 *
 * ONE HONEST LIMIT. MetaTrader runs alerts on the broker's server, so they fire with the app shut.
 * These are stored in the browser and checked by the open tab, so an alert only fires while the
 * terminal is open. The UI says so rather than letting a player assume otherwise.
 *
 * Alerts are per browser, persisted, and never touch money: nothing here can open, close or price
 * a position.
 */

export interface PriceAlert {
  id: string;
  symbol: string;
  /** true = fire when price rises to or above `price`; false = at or below. */
  above: boolean;
  price: number;
  createdAtMs: number;
  /** Epoch ms it fired, or null while still armed. */
  triggeredAtMs: number | null;
}

interface AlertsState {
  alerts: PriceAlert[];
  add: (symbol: string, above: boolean, price: number) => void;
  remove: (id: string) => void;
  markTriggered: (id: string, atMs: number) => void;
  /** Re-arm a fired alert, as MT5 lets you re-enable one. */
  rearm: (id: string) => void;
  clearTriggered: () => void;
}

/** Bound so a persisted list cannot grow without limit. */
const MAX_ALERTS = 50;

export const useAlertsStore = create<AlertsState>()(
  persist(
    (set) => ({
      alerts: [],
      add: (symbol, above, price) =>
        set((s) => ({
          alerts: [
            { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, symbol, above, price, createdAtMs: Date.now(), triggeredAtMs: null },
            ...s.alerts,
          ].slice(0, MAX_ALERTS),
        })),
      remove: (id) => set((s) => ({ alerts: s.alerts.filter((a) => a.id !== id) })),
      markTriggered: (id, atMs) =>
        set((s) => ({ alerts: s.alerts.map((a) => (a.id === id ? { ...a, triggeredAtMs: atMs } : a)) })),
      rearm: (id) => set((s) => ({ alerts: s.alerts.map((a) => (a.id === id ? { ...a, triggeredAtMs: null } : a)) })),
      clearTriggered: () => set((s) => ({ alerts: s.alerts.filter((a) => a.triggeredAtMs === null) })),
    }),
    { name: 'pp-price-alerts' },
  ),
);

/**
 * Watch the live price and fire armed alerts.
 *
 * `getPrice` is polled rather than subscribed to, because the price arrives on an animation-frame
 * tick loop and alerting does not need that resolution — twice a second is well inside what a
 * person perceives, and keeps this off the render path.
 */
export function usePriceAlertWatch(
  getPrice: () => number | null,
  symbol: string,
  onFire?: (alert: PriceAlert, price: number) => void,
): void {
  const onFireRef = useRef(onFire);
  onFireRef.current = onFire;

  useEffect(() => {
    const id = setInterval(() => {
      const price = getPrice();
      if (price === null || !Number.isFinite(price)) return;
      const { alerts, markTriggered } = useAlertsStore.getState();
      for (const a of alerts) {
        if (a.triggeredAtMs !== null || a.symbol !== symbol) continue;
        const hit = a.above ? price >= a.price : price <= a.price;
        if (!hit) continue;
        markTriggered(a.id, Date.now());
        logJournal('warn', 'Alert', `${a.symbol} ${a.above ? 'rose to' : 'fell to'} ${a.price} (last ${price.toFixed(2)})`);
        onFireRef.current?.(a, price);
      }
    }, 500);
    return () => clearInterval(id);
  }, [getPrice, symbol]);
}
