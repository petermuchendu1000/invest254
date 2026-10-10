/**
 * The gateway codes players are allowed to see. Paynicorn is a confidential supplier: everything a
 * player's browser receives (the deposit-methods list, the deposit route, transaction history) names it
 * `payx`, so neither the network tab nor the shipped web bundle reveals who processes the payment.
 * Operator-only surfaces (/platform, /admin) keep the real code. docs/53.
 */
const TO_PUBLIC: Readonly<Record<string, string>> = { paynicorn: "payx" };

export function publicProviderCode(code: string): string {
  return TO_PUBLIC[code] ?? code;
}

/** Rewrites `provider` (and an id prefixed with it, e.g. `paynicorn-stk`) to the public code. */
export function publicProvider<T extends { provider: string; id?: string }>(row: T): T {
  const pub = publicProviderCode(row.provider);
  if (pub === row.provider) return row;
  const out: T = { ...row, provider: pub };
  if (typeof row.id === "string" && row.id.startsWith(`${row.provider}-`)) out.id = `${pub}${row.id.slice(row.provider.length)}`;
  return out;
}
