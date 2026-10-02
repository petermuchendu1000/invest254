'use client';

import { useSyncExternalStore } from 'react';

/**
 * Terminal journal — the real log behind MetaTrader's Journal tab.
 *
 * MT5's Journal records what the terminal itself did: connecting, authorising, sending an order,
 * the server's answer, errors. Every line here is an event that genuinely happened on this session's
 * socket; nothing is synthesised to fill the tab.
 *
 * It lives outside React on purpose. These events arrive on the socket, often several a second
 * during a round, and routing each through component state would re-render the trade screen for a
 * log that is usually not even on screen. Components subscribe through `useJournal`, which reads a
 * snapshot and only re-renders when the buffer actually changes.
 *
 * The buffer is per session and per tab: it is not persisted, because a journal that survived a
 * reload would describe a terminal that is no longer running.
 */

export type JournalLevel = 'info' | 'ok' | 'warn' | 'error';

export interface JournalEntry {
  id: number;
  atMs: number;
  level: JournalLevel;
  /** Short source tag, as MT5 prints one ('Network', 'Trade', 'Chart'). */
  tag: string;
  text: string;
}

/** Ring size. Deep enough to cover a long session, bounded so a tab left open cannot grow forever. */
const MAX_ENTRIES = 500;

let seq = 0;
let entries: JournalEntry[] = [];
const subscribers = new Set<() => void>();

/** Record a terminal event. Safe to call from anywhere, including outside React. */
export function logJournal(level: JournalLevel, tag: string, text: string): void {
  const entry: JournalEntry = { id: ++seq, atMs: Date.now(), level, tag, text };
  // A new array each time so `useSyncExternalStore` sees a changed snapshot; mutating in place
  // would leave subscribers rendering stale content.
  entries = entries.length >= MAX_ENTRIES ? [...entries.slice(1), entry] : [...entries, entry];
  for (const cb of subscribers) cb();
}

export function getJournal(): JournalEntry[] {
  return entries;
}

export function subscribeJournal(cb: () => void): () => void {
  subscribers.add(cb);
  return () => { subscribers.delete(cb); };
}

/** Server snapshot: the log is client-only, so SSR renders an empty journal. */
const EMPTY: JournalEntry[] = [];

export function useJournal(): JournalEntry[] {
  return useSyncExternalStore(subscribeJournal, getJournal, () => EMPTY);
}

/** Test seam: drop everything and reset the counter. */
export function resetJournal(): void {
  entries = [];
  seq = 0;
  for (const cb of subscribers) cb();
}
