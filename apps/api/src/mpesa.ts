/**
 * M-PESA confirmation formatting for the marketer wallet feed.
 *
 * When a marketer withdraws game winnings on invest254 the money is credited INSTANTLY into
 * their mpesa-app (marketer) wallet (see 0036_marketer_game_withdraw). The mpesa_2 Android app
 * renders that credit as a real M-PESA "money received" alert — both an OS notification and an
 * in-app entry — so this module produces text that mirrors the actual Safaricom SMS:
 *
 *   "UH4X7K2QAB Confirmed. You have received Ksh700.00 from INVEST254 on 4/8/26 at 6:45 PM.
 *    New M-PESA balance is Ksh1,614.88. Transaction cost, Ksh0.00."
 *
 * Receiving money on M-PESA is free, so the transaction cost is always Ksh0.00.
 * Timestamps are East Africa Time (UTC+3, no DST) — M-PESA always stamps in EAT.
 */

/** East Africa Time offset (UTC+3, no daylight saving). */
const EAT_OFFSET_MIN = 3 * 60;

/** Format integer cents (KES) as a grouped decimal string, e.g. 161488 -> "1,614.88". */
export function formatAmount(cents: number): string {
  const v = Math.abs(Math.trunc(cents)) / 100;
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "Ksh1,614.88" — the exact prefix M-PESA uses in-message (no space). */
export const ksh = (cents: number): string => `Ksh${formatAmount(cents)}`;

interface EatParts { year: number; month: number; day: number; hour: number; minute: number; }

function eatParts(ms: number): EatParts {
  const d = new Date(ms + EAT_OFFSET_MIN * 60_000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}

/** M-PESA date form "d/m/yy" in EAT, e.g. "4/8/26". */
export function mpesaDate(ms: number): string {
  const { year, month, day } = eatParts(ms);
  return `${day}/${month}/${String(year).slice(-2)}`;
}

/** M-PESA time form "h:mm AM/PM" in EAT, e.g. "6:45 PM". */
export function mpesaTime(ms: number): string {
  const { hour, minute } = eatParts(ms);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, "0")} ${ampm}`;
}

// Day-of-month char: 1..9 then A..V (A=10 … V=31) — exactly the real M-PESA code encoding.
const DAY_CODE = "123456789ABCDEFGHIJKLMNOPQRSTUV";
const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function letter(n: number): string {
  // Wrap into A..Z so codes stay valid past 2031.
  return String.fromCharCode("A".charCodeAt(0) + (((n % 26) + 26) % 26));
}

/**
 * A Safaricom-style 10-character transaction code.
 * The first three characters encode the transaction date exactly as real M-PESA codes do:
 *   - char 1: year letter — 2024=S, 2025=T, 2026=U, …
 *   - char 2: month A–L (Jan–Dec) — August = H
 *   - char 3: day 1–9, then A–V for 10–31
 * The trailing 7 characters are a deterministic function of `seq` (the ledger id), so the same
 * transaction always renders the same code across polls (stable for de-duplication and search).
 */
export function mpesaCode(ms: number, seq: number): string {
  const { year, month, day } = eatParts(ms);
  const yearChar = letter("S".charCodeAt(0) - "A".charCodeAt(0) + (year - 2024));
  const monthChar = letter(month - 1);
  const dayChar = DAY_CODE[Math.min(Math.max(day, 1), 31) - 1]!;

  // Deterministic 7-char tail from the ledger id (LCG — stable, not security-sensitive).
  let x = (Math.trunc(seq) * 2654435761) >>> 0;
  let tail = "";
  for (let i = 0; i < 7; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    tail += ALNUM[x % ALNUM.length];
  }
  return `${yearChar}${monthChar}${dayChar}${tail}`;
}

export interface MpesaMessageInput {
  code: string;
  amountCents: number;
  /** Counterparty name (uppercased by the caller to match M-PESA styling). */
  party: string;
  balanceCents: number;
  atMs: number;
}

/** Full "money received" SMS text (used for credits into the marketer wallet). */
export function mpesaReceivedMessage(i: MpesaMessageInput): string {
  return `${i.code} Confirmed. You have received ${ksh(i.amountCents)} from ${i.party} on ${mpesaDate(i.atMs)}` +
    ` at ${mpesaTime(i.atMs)}. New M-PESA balance is ${ksh(i.balanceCents)}. Transaction cost, Ksh0.00.`;
}

/** Full "money sent / withdrawn" SMS text (used for debits from the marketer wallet). */
export function mpesaSentMessage(i: MpesaMessageInput): string {
  return `${i.code} Confirmed. ${ksh(i.amountCents)} sent to ${i.party} on ${mpesaDate(i.atMs)}` +
    ` at ${mpesaTime(i.atMs)}. New M-PESA balance is ${ksh(i.balanceCents)}. Transaction cost, Ksh0.00.`;
}
