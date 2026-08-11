// Referral-code capture shared between the /r/[code] landing and the auth modal.
// Stored in localStorage so a referral survives the journey to sign-up.
export const REF_KEY = 'pp-ref';

export function storeReferral(code: string): void {
  try {
    const v = code.trim().toUpperCase();
    if (v) window.localStorage.setItem(REF_KEY, v);
  } catch {
    /* ignore (private mode / disabled storage) */
  }
}

export function readReferral(): string | null {
  try {
    return window.localStorage.getItem(REF_KEY);
  } catch {
    return null;
  }
}

export function clearReferral(): void {
  try {
    window.localStorage.removeItem(REF_KEY);
  } catch {
    /* ignore */
  }
}
