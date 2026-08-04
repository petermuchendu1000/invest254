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
  let local: string;
  if (/^0(7|1)\d{8}$/.test(raw)) local = raw;                       // 0712345678 (already local)
  else if (/^254(7|1)\d{8}$/.test(raw)) local = `0${raw.slice(3)}`; // 254712345678 -> 0712345678
  else if (/^(7|1)\d{8}$/.test(raw)) local = `0${raw}`;             // 712345678 -> 0712345678
  else throw new Error(`INVALID_PHONE: ${input}`);
  if (!/^0(7|1)\d{8}$/.test(local)) throw new Error(`INVALID_PHONE: ${input}`);
  return local;
}

/**
 * Convert a Kenyan phone to E.164 MSISDN (254XXXXXXXXX) for the Safaricom / Daraja edge ONLY.
 * The whole app uses the local 0XXXXXXXXX form as the canonical identity; Safaricom's STK/B2C
 * APIs require the 254 form, so we convert right before hitting them (see daraja.ts).
 */
export function msisdnToE164(input: string): string {
  const local = normalizeMsisdn(input);
  return `254${local.slice(1)}`;
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
