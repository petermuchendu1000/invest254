'use client';

import { useEffect, useState } from 'react';
import { useSession } from '@/lib/auth/session';
import { useWallet } from '@/lib/wallet/hooks';

/**
 * PREVIEW override (presentation only). `?preview=marketer` forces the marketer SKIN on for anyone —
 * so the neutralised marketer UI can be reviewed without a marketer account — and `?preview=off`
 * (or `player`) clears it. Persisted in sessionStorage so it survives in-app navigation but not a new
 * tab/session. This is SAFE: `useIsMarketer` only drives presentation (points/labels/chart); every
 * marketer ENDPOINT is still gated server-side by `requireMarketer`, so the flag can never read
 * marketer data or move money — it just repaints the current account's own board.
 */
function readMarketerPreview(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const q = new URLSearchParams(window.location.search).get('preview');
    if (q === 'marketer') { sessionStorage.setItem('pp:previewMarketer', '1'); return true; }
    if (q === 'off' || q === 'player') { sessionStorage.removeItem('pp:previewMarketer'); return false; }
    return sessionStorage.getItem('pp:previewMarketer') === '1';
  } catch {
    return false;
  }
}

/**
 * Is this account a MARKETER, for client-side routing purposes?
 *
 * The JWT `role` claim is not enough, and the server already says so: `requireMarketer` resolves the
 * marketer from the DATABASE — "the DB is the source of truth for access (NOT the JWT role claim)".
 * The client was the only layer still trusting the claim, and it locked real marketers out of their
 * own app: three accounts on `madolar` carry `role='player'` while their money identity is marketer
 * (a `marketers` row on their brand and a funded `marketer_wallets` balance). They were demo-locked
 * by the money layer with no way to reach the dashboard they withdraw from.
 *
 * `wallet.modeLocked` is the server's own authoritative answer — it is `fn_is_marketer_account`, the
 * same predicate that routes their stakes to the demo bucket. Gating on it makes the client agree
 * with the money layer.
 *
 * This is a ROUTING hint, never an authorisation: every marketer endpoint is still gated server-side
 * by `requireMarketer`, so a false positive lands on a page whose calls return 403 — it cannot leak
 * anything. The covert entry (an invisible hotspot, no visible button) is unchanged.
 */
export function useIsMarketer(): { isMarketer: boolean; resolved: boolean } {
  const role = useSession((s) => s.user?.role);
  const { data: wallet, isPending } = useWallet();
  // Read the preview override AFTER mount so server and first client render agree (no hydration flip).
  const [preview, setPreview] = useState(false);
  useEffect(() => { setPreview(readMarketerPreview()); }, []);
  if (preview || role === 'marketer') return { isMarketer: true, resolved: true };
  if (isPending || !wallet) return { isMarketer: false, resolved: false };
  return { isMarketer: wallet.modeLocked === true, resolved: true };
}

/**
 * OWNER POLICY: the marketer app must be TikTok-safe — it must NOT read as a binary-options / trading
 * terminal. So the full P1–P3 neutral skin is ON: money shown as game points, Buy/Sell as wordless
 * arrows, neutral nav, neutral trade-type/instrument names, and the 18+/licence/responsible-gaming
 * footer hidden. `useMarketerSkin()` reports a marketer to every shared player surface.
 *
 * What is NOT neutralised (handled elsewhere, by design): the candlestick/bars/area CHART, which
 * `GameCurve` renders as a real TradingView view for candle brands (TikTok should not read a candle
 * chart as binary). The classic line wave stays the neutral game wave (GameCurve passes the real
 * marketer flag to `CurveCanvas`). So "chart neutralisation = the line wave only"; every OTHER
 * gambling/trading tell is still neutralised here.
 *
 * This is a presentation policy only. Marketer ROLE (routing, the marketer HUD, referral earnings,
 * admin) uses `useIsMarketer()`, and every marketer endpoint stays gated server-side.
 */
const NEUTRALISE_SHARED_UI: boolean = true;

export function useMarketerSkin(): { isMarketer: boolean; resolved: boolean } {
  const { isMarketer, resolved } = useIsMarketer();
  return { isMarketer: NEUTRALISE_SHARED_UI && isMarketer, resolved };
}
