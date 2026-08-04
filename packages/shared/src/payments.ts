import { assertCents, type Cents } from "./money.js";

/**
 * Payment input rules (M-Pesa / KES). Pure and deterministic so they can be unit-tested
 * and shared by the engine and any HTTP transport. Money is integer cents of KES.
 *
 * Defaults (docs/07 §5): min deposit KES 200, min withdrawal KES 200.
 */
export const MIN_DEPOSIT_CENTS: Cents = 20_000;     // KES 200
export const MIN_WITHDRAWAL_CENTS: Cents = 20_000;  // KES 200

/**
 * Normalize a Kenyan mobile number to MSISDN form `2547XXXXXXXX` / `2541XXXXXXXX`
 * (12 digits, no '+'), which is what Daraja STK/B2C expects as PartyA/PhoneNumber.
 * Accepts 07.., 01.., 7.., 1.., +254.., 254.. with spaces/dashes. Throws on anything else.
 */
export function normalizeMsisdn(input: string): string {
  const raw = String(input ?? "").replace(/[\s\-()]/g, "").replace(/^\+/, "");
  let msisdn: string;
  if (/^0(7|1)\d{8}$/.test(raw)) msisdn = `254${raw.slice(1)}`;        // 0712345678 -> 254712345678
  else if (/^254(7|1)\d{8}$/.test(raw)) msisdn = raw;                  // already MSISDN
  else if (/^(7|1)\d{8}$/.test(raw)) msisdn = `254${raw}`;            // 712345678 -> 254712345678
  else throw new Error(`INVALID_PHONE: ${input}`);
  if (!/^254(7|1)\d{8}$/.test(msisdn)) throw new Error(`INVALID_PHONE: ${input}`);
  return msisdn;
}

export interface AmountCheck { ok: boolean; reason?: string }

/** Validate a deposit amount (integer cents, positive, >= min). */
export function validateDeposit(amountCents: number, min: Cents = MIN_DEPOSIT_CENTS): AmountCheck {
  if (!Number.isInteger(amountCents)) return { ok: false, reason: "NOT_INTEGER_CENTS" };
  if (amountCents <= 0) return { ok: false, reason: "INVALID_AMOUNT" };
  if (amountCents < min) return { ok: false, reason: "BELOW_MIN" };
  return { ok: true };
}

/** Validate a withdrawal amount against the min and the withdrawable balance. */
export function validateWithdrawal(amountCents: number, balanceCents: Cents, min: Cents = MIN_WITHDRAWAL_CENTS): AmountCheck {
  assertCents(balanceCents, "balance");
  if (!Number.isInteger(amountCents)) return { ok: false, reason: "NOT_INTEGER_CENTS" };
  if (amountCents <= 0) return { ok: false, reason: "INVALID_AMOUNT" };
  if (amountCents < min) return { ok: false, reason: "BELOW_MIN" };
  if (amountCents > balanceCents) return { ok: false, reason: "INSUFFICIENT_FUNDS" };
  return { ok: true };
}
