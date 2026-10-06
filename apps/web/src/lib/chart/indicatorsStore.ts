'use client';

import { useSyncExternalStore } from 'react';
import { INDICATOR_BY_ID } from './indicatorCatalog.js';
import { logExperts } from '@/lib/game/journal';

/**
 * Which of MetaTrader's indicators are applied to the chart.
 *
 * This used to be component state inside `CandleChart`, which was fine while the chart's own
 * Indicators menu was the only way to switch one on. It is not any more: the Toolbox's Code Base
 * tab lists the same library and applies from there, and two components cannot share a `useState`.
 * So the set lives here, outside React, and both read it through `useEnabledIndicators`.
 *
 * It is persisted under the key the chart has always used, so a trader's switched-on indicators
 * survive this refactor as well as a reload.
 *
 * Applying and removing an indicator is also written to the Experts journal, because that is the
 * log MetaTrader keeps of what the programs on the chart are doing.
 */

const STORAGE_KEY = 'pp-chart-indicators';

let enabled: ReadonlySet<string> = new Set<string>();
const subscribers = new Set<() => void>();

/** SSR snapshot: localStorage does not exist on the server, so the server renders none applied. */
const EMPTY: ReadonlySet<string> = new Set<string>();

let restored = false;

/**
 * Read the last session's set back. Called once, lazily, from the first hook subscription rather
 * than at module load: the module is imported during SSR, where `window` does not exist.
 *
 * Unknown ids are dropped. A catalogue entry can be renamed or retired between deployments, and a
 * stored id that no longer resolves would otherwise sit in the set forever, counted but never drawn.
 */
function restore(): void {
  if (restored) return;
  restored = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const ids = JSON.parse(raw) as unknown;
    if (!Array.isArray(ids)) return;
    const next = ids.filter((x): x is string => typeof x === 'string' && INDICATOR_BY_ID.has(x));
    if (next.length === 0) return;
    enabled = new Set(next);
    // MetaTrader's Experts journal opens with an initialisation line per program already attached to
    // the chart, which is exactly what these are: indicators the trader left switched on.
    for (const id of next) {
      const def = INDICATOR_BY_ID.get(id);
      if (def) logExperts('ok', def.name, `initialised${def.params ? ` ${def.params}` : ''}`);
    }
  } catch { /* private mode / corrupt value — no indicators is a fine default */ }
}

function publish(next: ReadonlySet<string>): void {
  enabled = next;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next])); } catch { /* blocked storage */ }
  for (const cb of subscribers) cb();
}

/** Switch an indicator on or off, and log it the way MetaTrader logs a program on the chart. */
export function toggleIndicator(id: string): void {
  const def = INDICATOR_BY_ID.get(id);
  if (!def || def.unavailable !== undefined) return;
  const next = new Set(enabled);
  const on = !next.has(id);
  if (on) next.add(id); else next.delete(id);
  publish(next);
  logExperts('info', def.name, on
    ? `indicator applied to the chart${def.params ? ` ${def.params}` : ''}`
    : 'indicator removed from the chart');
}

/** Remove every indicator, which is what the chart's own "Delete Indicator Window" sweep needs. */
export function clearIndicators(): void {
  if (enabled.size === 0) return;
  for (const id of enabled) {
    const def = INDICATOR_BY_ID.get(id);
    if (def) logExperts('info', def.name, 'indicator removed from the chart');
  }
  publish(new Set<string>());
}

export function getEnabledIndicators(): ReadonlySet<string> {
  return enabled;
}

export function subscribeIndicators(cb: () => void): () => void {
  restore();
  subscribers.add(cb);
  return () => { subscribers.delete(cb); };
}

export function useEnabledIndicators(): ReadonlySet<string> {
  return useSyncExternalStore(subscribeIndicators, getEnabledIndicators, () => EMPTY);
}

/** Test seam. */
export function resetIndicators(): void {
  enabled = new Set<string>();
  restored = true;
  for (const cb of subscribers) cb();
}
