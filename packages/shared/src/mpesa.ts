/**
 * M-Pesa (Daraja) STK Push result-code classification.
 *
 * Safaricom returns a numeric ResultCode on every STK callback / STKPushQuery. Code 0 is the only
 * success; every other code is a distinct failure with a very different meaning and remediation.
 * Historically the app surfaced Safaricom's raw ResultDesc (e.g. "System internal error.") directly
 * to players and blamed a provider-side outage on the user ("prompt wasn't approved in time or was
 * cancelled"). This pure helper maps codes to an honest, non-blaming category + user message and
 * tells callers whether a code is a transient PROVIDER fault (safe to invite an immediate retry) vs
 * a USER action (top up, re-enter PIN) vs terminal.
 *
 * No money ever moves on a non-zero code, so every message reassures "No money was deducted."
 * References: Safaricom Daraja STK result codes; field-observed codes in production callbacks.
 */
export type MpesaResultCategory =
  | "paid"            // 0 — the only success
  | "cancelled"       // user pressed Cancel on the STK prompt
  | "unreachable"     // phone off / no signal / DS timeout
  | "insufficient"    // M-Pesa balance too low
  | "wrong_pin"       // wrong M-Pesa PIN entered
  | "invalid_number"  // subscriber does not exist / not M-Pesa
  | "in_progress"     // a prior request for this subscriber is still locked
  | "provider_down"   // Safaricom-side internal/system error — transient, NOT the user's fault
  | "unknown";        // any code we haven't explicitly mapped

export interface MpesaResultInfo {
  code: number;
  category: MpesaResultCategory;
  /** True when an immediate user-initiated retry is reasonable (provider faults, timeouts, locks). */
  retriable: boolean;
  /** Honest, non-technical, non-blaming message for the player. Always reassures no debit occurred. */
  userMessage: string;
  /** True only for code 0. */
  paid: boolean;
}

const NO_DEBIT = "No money was deducted.";

/**
 * Classify a Safaricom STK ResultCode. Unknown codes fall back to a safe, honest generic message
 * and are treated as retriable (a benign default: the transaction did not succeed and no money moved,
 * so inviting a retry cannot double-charge).
 */
export function classifyMpesaResult(code: number): MpesaResultInfo {
  switch (code) {
    case 0:
      return { code, category: "paid", retriable: false, paid: true, userMessage: "Payment received." };
    case 1:
      return { code, category: "insufficient", retriable: true, paid: false,
        userMessage: `Your M-Pesa balance was too low to complete this deposit. Top up your M-Pesa and try again. ${NO_DEBIT}` };
    case 1032:
      return { code, category: "cancelled", retriable: true, paid: false,
        userMessage: `The M-Pesa prompt was cancelled. Tap “Try again” when you’re ready. ${NO_DEBIT}` };
    case 1037:
      return { code, category: "unreachable", retriable: true, paid: false,
        userMessage: `We couldn’t reach your phone. Make sure it’s on with M-Pesa active, then try again. ${NO_DEBIT}` };
    case 2001:
      return { code, category: "wrong_pin", retriable: true, paid: false,
        userMessage: `The M-Pesa PIN was incorrect. Try again and enter your correct PIN. ${NO_DEBIT}` };
    case 2035:
      return { code, category: "invalid_number", retriable: false, paid: false,
        userMessage: `That number isn’t a valid M-Pesa account. Check the phone number and try again. ${NO_DEBIT}` };
    case 1001:
      return { code, category: "in_progress", retriable: true, paid: false,
        userMessage: `You have another M-Pesa request still in progress. Wait a few seconds, then try again. ${NO_DEBIT}` };
    // Safaricom-side transient faults — NOT the user's fault.
    case 17:   // "System internal error."
    case 26:   // "System busy."
    case 1025: // "Error occurred while sending push request."
    case 9999: // "Error occurred while sending push request."
      return { code, category: "provider_down", retriable: true, paid: false,
        userMessage: `M-Pesa is temporarily unavailable on Safaricom’s side. Please wait a few minutes and try again. ${NO_DEBIT}` };
    default:
      return { code, category: "unknown", retriable: true, paid: false,
        userMessage: `The payment couldn’t be completed. Please try again shortly. ${NO_DEBIT}` };
  }
}

/** Convenience: transient provider faults where an automated reconciliation retry is worthwhile. */
export function isTransientProviderCode(code: number): boolean {
  return classifyMpesaResult(code).category === "provider_down";
}
