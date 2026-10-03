import type { PositionDto, TransactionDto } from '../api/types.js';

/**
 * The data model behind MetaTrader 5's History screen.
 *
 * MetaTrader splits one trade into three records, and shows each on its own tab:
 *
 *   ORDERS     the REQUEST — "buy 1.00 XAUUSD", which was either filled or cancelled
 *   DEALS      the EXECUTIONS — one `in` deal when the contract opens, one `out` deal when it
 *              settles, plus `balance` deals for deposits and withdrawals
 *   POSITIONS  the round trip — entry, exit, and what it paid
 *
 * That is not a presentation trick: a contract here really does have a placement, two executions and
 * a settled round trip, each with its own time, and this module derives all three from the records
 * the API already serves. Nothing is invented — a field we do not have is not drawn (see
 * `EXECUTION_PRICE` below).
 *
 * Every function here is pure so the screen's arithmetic can be tested without a browser.
 */

/** Deals and positions of a contract are both reported against the one instrument we quote. */
export type Side = 'buy' | 'sell';

export type HistoryTab = 'positions' | 'orders' | 'deals';

/**
 * What a price slot reads when there is no price to print.
 *
 * MetaTrader prints an execution price on a deal and an entry→exit pair on a position. Those are
 * prices on the chart's axis, and the axis is re-anchored every UTC day by the engine, so a trade's
 * curve rate cannot be turned back into the number the player saw — only the engine's day chain
 * knows each day's anchor. So the engine stamps the price at execution time
 * (`PositionDto.entryPrice` / `exitPrice`, migration 0180) and these screens print it.
 *
 * A trade placed before that column existed has no price, and rather than map its old rate through
 * TODAY's anchor and print a number that never happened, its slots fall back to this — which is
 * both true (every contract here is market-executed) and MetaTrader's own wording for it.
 */
export const EXECUTION_PRICE = 'at market';

/**
 * A price as the symbol quotes it: fixed to the instrument's digits, thousands grouped.
 *
 * Falls back to EXECUTION_PRICE for an unstamped trade, so every caller gets a printable string and
 * none of them has to decide what a missing price looks like.
 */
export function priceText(price: number | null | undefined, digits: number): string {
  if (typeof price !== 'number' || !Number.isFinite(price)) return EXECUTION_PRICE;
  return price.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** The UTC trade date a timestamp falls on — the day the chart's price axis is anchored to. */
export const tradeDateOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/**
 * May a rate recorded at `atMs` be rendered as a price against an axis anchored on `anchorDate`?
 *
 * Only when they are the same UTC day. The engine re-anchors the axis at every UTC midnight, so a
 * rate from an earlier day mapped through today's anchor yields a price that never happened —
 * silently, and plausibly enough that nobody would notice. Anywhere this says no, the surface shows
 * EXECUTION_PRICE instead of a number it cannot know.
 */
export const priceKnown = (atMs: number, anchorDate: string | null | undefined): boolean =>
  typeof anchorDate === 'string' && anchorDate.length > 0 && tradeDateOf(atMs) === anchorDate;

// ───────────────────────────────── period ─────────────────────────────────

/** MetaTrader's period menu, in its order. */
export type PeriodKey = 'today' | 'week' | 'month' | 'quarter' | 'custom';

export const PERIODS: ReadonlyArray<{ key: PeriodKey; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Last week' },
  { key: 'month', label: 'Last month' },
  { key: 'quarter', label: 'Last 3 months' },
  { key: 'custom', label: 'Custom period' },
];

export interface Range {
  fromMs: number;
  toMs: number;
}

const DAY_MS = 86_400_000;

/** Local midnight at the start of the day containing `ms`. */
function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * The window a period covers, as [fromMs, toMs).
 *
 * MetaTrader's presets run back from the start of today and include today, so "Last week" is the
 * seven days ending now — which is what its own subtitle (2017.08.11 - 2017.08.18) spells out.
 */
export function periodRange(key: PeriodKey, nowMs: number, custom?: Partial<Range>): Range {
  const today = startOfDay(nowMs);
  const toMs = today + DAY_MS;
  switch (key) {
    case 'today':
      return { fromMs: today, toMs };
    case 'week':
      return { fromMs: today - 6 * DAY_MS, toMs };
    case 'month':
      return { fromMs: today - 29 * DAY_MS, toMs };
    case 'quarter':
      return { fromMs: today - 89 * DAY_MS, toMs };
    case 'custom': {
      // An unset end means "up to now"; an unset start means "from the beginning". A range entered
      // backwards is read in the order the player meant, not dropped.
      const a = custom?.fromMs ?? 0;
      const b = custom?.toMs ?? toMs;
      return a <= b ? { fromMs: a, toMs: b } : { fromMs: b, toMs: a };
    }
  }
}

/** The subtitle MetaTrader prints under each period name. */
export function periodSubtitle(r: Range): string {
  const last = r.toMs - 1;
  const from = dateOnly(r.fromMs);
  const to = dateOnly(last);
  return from === to ? from : `${from} - ${to}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** MetaTrader's date format: 2017.06.07 */
export function dateOnly(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

/** MetaTrader's timestamp format: 2017.06.07 11:51:19 */
export function stamp(ms: number): string {
  const d = new Date(ms);
  return `${dateOnly(ms)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ───────────────────────────────── rows ─────────────────────────────────

/** A row on the ORDERS tab: the request, and whether it was filled. */
export interface OrderRow {
  id: string;
  ticket: string;
  symbol: string;
  side: Side;
  /** Requested volume and filled volume, which differ only on a cancelled order. */
  lots: string;
  filledLots: string;
  atMs: number;
  state: 'FILLED' | 'CANCELED';
  /** The price it filled at; null on a cancelled order, and on a trade placed before 0180. */
  price: number | null;
}

/** A row on the DEALS tab. `balance` deals are deposits and withdrawals, as in MetaTrader. */
export interface DealRow {
  id: string;
  ticket: string;
  kind: 'trade' | 'balance';
  symbol: string;
  side: Side | null;
  entry: 'in' | 'out' | null;
  lots: string | null;
  label: string | null;
  atMs: number;
  /** Set on `out` deals and on balance deals; an `in` deal has no result yet. */
  amountCents: number | null;
  /** The price this execution happened at — entry on an `in` deal, exit on an `out` one. */
  price: number | null;
}

/**
 * A row on the POSITIONS tab: the settled round trip.
 *
 * MetaTrader paints a coloured stripe down a row that closed on a stop loss or a take profit. No row
 * here earns one: a contract settles at expiry, which is neither, and a stripe on every win and loss
 * would turn a specific signal into decoration.
 */
export interface PositionRow {
  id: string;
  ticket: string;
  kind: 'trade' | 'balance';
  symbol: string;
  side: Side | null;
  lots: string | null;
  label: string | null;
  atMs: number;
  amountCents: number | null;
  /** The round trip's two prices. Both null on a balance operation, which has no price at all. */
  entryPrice: number | null;
  exitPrice: number | null;
}

/** MetaTrader shows a ticket as a plain number; ours are uuids, so the leading block stands in. */
export const ticketOf = (id: string): string => id.replace(/-/g, '').slice(0, 8);

const inRange = (ms: number, r: Range) => ms >= r.fromMs && ms < r.toMs;

/** Only money that actually moved counts: a pending or failed deposit is not a balance operation. */
export const isCompleted = (t: TransactionDto): boolean => {
  const s = t.status.toLowerCase();
  return s === 'completed' || s === 'success' || s === 'succeeded' || s === 'credited' || s === 'paid';
};

/** Signed effect of a transaction on the balance. */
export const signedCents = (t: TransactionDto): number =>
  t.kind === 'withdrawal' ? -Math.abs(t.amountCents) : Math.abs(t.amountCents);

export function orderRows(
  positions: readonly PositionDto[],
  range: Range,
  symbol: string,
  lotsOf: (stakeCents: number) => string,
): OrderRow[] {
  const out: OrderRow[] = [];
  for (const p of positions) {
    if (!inRange(p.openedAt, range)) continue;
    // A void contract is a request that never became a trade — MetaTrader's CANCELED, which fills
    // nothing. Everything else was executed in full the moment it was placed.
    const canceled = p.result === 'void';
    out.push({
      id: p.id,
      ticket: ticketOf(p.id),
      symbol,
      side: p.direction,
      lots: lotsOf(p.stakeCents),
      filledLots: canceled ? lotsOf(0) : lotsOf(p.stakeCents),
      atMs: p.openedAt,
      state: canceled ? 'CANCELED' : 'FILLED',
      price: canceled ? null : p.entryPrice ?? null,
    });
  }
  return out;
}

export function dealRows(
  positions: readonly PositionDto[],
  transactions: readonly TransactionDto[],
  range: Range,
  symbol: string,
  lotsOf: (stakeCents: number) => string,
): DealRow[] {
  const out: DealRow[] = [];
  for (const p of positions) {
    if (p.result === 'void') continue; // never executed, so there is no deal
    const lots = lotsOf(p.stakeCents);
    if (inRange(p.openedAt, range)) {
      out.push({
        id: `${p.id}:in`, ticket: ticketOf(p.id), kind: 'trade', symbol,
        side: p.direction, entry: 'in', lots, label: null, atMs: p.openedAt, amountCents: null,
        price: p.entryPrice ?? null,
      });
    }
    // Closing a BUY is a sell execution, and vice versa — MetaTrader reports the deal's own
    // direction, not the position's.
    if (p.settledAt !== null && inRange(p.settledAt, range)) {
      out.push({
        id: `${p.id}:out`, ticket: ticketOf(p.id), kind: 'trade', symbol,
        side: p.direction === 'buy' ? 'sell' : 'buy', entry: 'out', lots, label: null,
        atMs: p.settledAt, amountCents: p.pnlCents, price: p.exitPrice ?? null,
      });
    }
  }
  for (const t of transactions) {
    if (!isCompleted(t) || !inRange(t.ts, range)) continue;
    out.push({
      id: `tx:${t.id}`, ticket: ticketOf(t.id), kind: 'balance', symbol: 'Balance',
      side: null, entry: null, lots: null,
      label: t.kind === 'withdrawal' ? 'Withdrawal' : 'Deposit',
      atMs: t.ts, amountCents: signedCents(t), price: null,
    });
  }
  return out;
}

export function positionRows(
  positions: readonly PositionDto[],
  transactions: readonly TransactionDto[],
  range: Range,
  symbol: string,
  lotsOf: (stakeCents: number) => string,
): PositionRow[] {
  const out: PositionRow[] = [];
  for (const p of positions) {
    // A position exists once it has closed; an open contract lives on the Trade tab, as in
    // MetaTrader, and a void one never opened at all.
    if (p.settledAt === null || p.result === 'void') continue;
    if (!inRange(p.settledAt, range)) continue;
    out.push({
      id: p.id, ticket: ticketOf(p.id), kind: 'trade', symbol,
      side: p.direction, lots: lotsOf(p.stakeCents), label: null,
      atMs: p.settledAt, amountCents: p.pnlCents,
      entryPrice: p.entryPrice ?? null, exitPrice: p.exitPrice ?? null,
    });
  }
  for (const t of transactions) {
    if (!isCompleted(t) || !inRange(t.ts, range)) continue;
    out.push({
      id: `tx:${t.id}`, ticket: ticketOf(t.id), kind: 'balance', symbol: 'Balance',
      side: null, lots: null, label: t.kind === 'withdrawal' ? 'Withdrawal' : 'Deposit',
      atMs: t.ts, amountCents: signedCents(t), entryPrice: null, exitPrice: null,
    });
  }
  return out;
}

// ───────────────────────────────── summaries ─────────────────────────────────

export interface OrdersSummary {
  filled: number;
  canceled: number;
  total: number;
}

export function ordersSummary(rows: readonly OrderRow[]): OrdersSummary {
  let filled = 0;
  for (const r of rows) if (r.state === 'FILLED') filled++;
  return { filled, canceled: rows.length - filled, total: rows.length };
}

/**
 * MetaTrader's money summary: Profit, Deposit, Balance.
 *
 * Its Swap and Commission lines are omitted, exactly as MetaTrader omits them when they are zero —
 * and here they are STRUCTURALLY zero: a contract settles at expiry so it is never held overnight
 * (no swap), and the house margin is inside the payout rather than charged per trade (no
 * commission). `balance` is the period's net effect, which is what MetaTrader totals there — not the
 * wallet's current figure.
 */
export interface MoneySummary {
  profitCents: number;
  depositCents: number;
  balanceCents: number;
}

export function moneySummary(rows: ReadonlyArray<{ kind: 'trade' | 'balance'; amountCents: number | null }>): MoneySummary {
  let profitCents = 0;
  let depositCents = 0;
  for (const r of rows) {
    if (r.amountCents === null) continue;
    if (r.kind === 'balance') depositCents += r.amountCents;
    else profitCents += r.amountCents;
  }
  return { profitCents, depositCents, balanceCents: profitCents + depositCents };
}

// ───────────────────────────────── sorting ─────────────────────────────────

/** MetaTrader's sort menu. "Open time" and "Close time" collapse to one time per row here. */
export type SortKey = 'symbol' | 'ticket' | 'time' | 'profit';

export const SORTS: ReadonlyArray<{ key: SortKey; label: string }> = [
  { key: 'symbol', label: 'Symbol' },
  { key: 'ticket', label: 'Ticket' },
  { key: 'time', label: 'Time' },
  { key: 'profit', label: 'Profit' },
];

interface Sortable {
  symbol: string;
  ticket: string;
  atMs: number;
  amountCents?: number | null;
}

/**
 * Sorted copy. `ascending` is MetaTrader's arrow direction; the default view is newest first, which
 * is time DESCENDING. Ties fall back to time so the order is stable and reproducible.
 */
export function sortRows<T extends Sortable>(rows: readonly T[], key: SortKey, ascending: boolean): T[] {
  const dir = ascending ? 1 : -1;
  const out = rows.slice();
  out.sort((a, b) => {
    let d = 0;
    if (key === 'symbol') d = a.symbol.localeCompare(b.symbol);
    else if (key === 'ticket') d = a.ticket.localeCompare(b.ticket);
    else if (key === 'profit') d = (a.amountCents ?? 0) - (b.amountCents ?? 0);
    else d = a.atMs - b.atMs;
    if (d !== 0) return dir * d;
    return b.atMs - a.atMs;
  });
  return out;
}
