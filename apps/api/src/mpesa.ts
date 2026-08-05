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
  /** Total already sent today (cents) — used for the daily-limit line on sent messages. */
  dailySpentCents?: number;
}

/** Full "money received" SMS text (used for credits into the marketer wallet). */
export function mpesaReceivedMessage(i: MpesaMessageInput): string {
  // Receiving is free on M-PESA: no "Transaction cost" line, no daily-limit line. The message
  // ends with the OneApp promo + short link, exactly like the real Safaricom SMS.
  return `${i.code} Confirmed.You have received ${ksh(i.amountCents)} from ${i.party} on ${mpesaDate(i.atMs)}` +
    ` at ${mpesaTime(i.atMs)}  New M-PESA balance is ${ksh(i.balanceCents)}. Download My OneApp on ${ONEAPP_LINK}`;
}

/** Full "money sent / withdrawn" SMS text (used for debits from the marketer wallet). */
export function mpesaSentMessage(i: MpesaMessageInput): string {
  // Real send SMS: "Transaction cost, KshX.XX. Amount you can transact within the day is
  // YYY,YYY.YY." (Safaricom cap: KES 500,000/day). The cost is computed from the P2P tariff.
  const cost = p2pCostCents(i.amountCents);
  const remaining = Math.max(0, DAILY_LIMIT_CENTS - (i.dailySpentCents ?? 0) - i.amountCents);
  return `${i.code} Confirmed. ${ksh(i.amountCents)} sent to ${i.party} on ${mpesaDate(i.atMs)}` +
    ` at ${mpesaTime(i.atMs)}. New M-PESA balance is ${ksh(i.balanceCents)}. Transaction cost, ${ksh(cost)}.` +
    ` Amount you can transact within the day is ${formatAmount(remaining)}. Download My OneApp on ${ONEAPP_LINK}`;
}

/** Safaricom short link appended to every M-PESA SMS (varies per message in production). */
export const ONEAPP_LINK = "https://saf.cx/lPKcC";

/** M-PESA daily transaction limit (KES 500,000) in cents. */
export const DAILY_LIMIT_CENTS = 50_000_000;

/**
 * M-PESA send-money (P2P) transaction-cost tariff, integer cents. Mirrors the published
 * Safaricom band table for "Transfer to M-PESA users".
 */
export function p2pCostCents(amountCents: number): number {
  const k = Math.trunc(amountCents); // work in cents
  const bands: Array<[number, number, number]> = [
    // [minCents, maxCents, costCents]
    [1, 4_900, 0],            // 1 - 49: free
    [5_000, 10_000, 0],       // 50 - 100: free
    [10_100, 50_000, 700],    // 101 - 500: 7
    [50_100, 100_000, 1_300], // 501 - 1,000: 13
    [100_100, 150_000, 2_300],// 1,001 - 1,500: 23
    [150_100, 250_000, 3_300],// 1,501 - 2,500: 33
    [250_100, 350_000, 5_100],// 2,501 - 3,500: 51
    [350_100, 500_000, 5_700],// 3,501 - 5,000: 57
    [500_100, 750_000, 7_800],// 5,001 - 7,500: 78
    [750_100, 1_000_000, 9_800],   // 7,501 - 10,000: 98
    [1_000_100, 1_500_000, 10_800],// 10,001 - 15,000: 108
    [1_500_100, 2_000_000, 11_800],// 15,001 - 20,000: 118
    [2_000_100, 3_500_000, 12_800],// 20,001 - 35,000: 128
    [3_500_100, 5_000_000, 15_000],// 35,001 - 50,000: 150
    [5_000_100, 25_000_000, 18_200],// 50,001 - 250,000: 182
  ];
  for (const [lo, hi, c] of bands) if (k >= lo && k <= hi) return c;
  return 18_200;
}

/**
 * Paybill/business-payment tariff (C2B "sent to X for account Y"). Higher than P2P in the
 * mid bands — e.g. KES 6,044 costs Ksh42.00 (per the real SMS in the wild).
 */
export function paybillCostCents(amountCents: number): number {
  const k = Math.trunc(amountCents);
  const bands: Array<[number, number, number]> = [
    [1, 4_900, 0],
    [5_000, 10_000, 0],
    [10_100, 50_000, 700],
    [50_100, 100_000, 1_300],
    [100_100, 150_000, 2_300],
    [150_100, 250_000, 3_300],
    [250_100, 350_000, 5_100],
    [350_100, 500_000, 5_700],
    [500_100, 750_000, 4_200],   // 5,001 - 7,500: 42 (per real C2B SMS: KES 6,044 -> Ksh42.00)
    [750_100, 1_000_000, 5_500], // 7,501 - 10,000: 55
    [1_000_100, 1_500_000, 6_500],
    [1_500_100, 2_000_000, 7_500],
    [2_000_100, 3_500_000, 8_500],
    [3_500_100, 5_000_000, 10_000],
    [5_000_100, 25_000_000, 12_000],
  ];
  for (const [lo, hi, c] of bands) if (k >= lo && k <= hi) return c;
  return 25_000;
}
