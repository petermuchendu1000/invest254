import type { CSSProperties } from 'react';
import { MT5 } from '@/lib/ui/mt5';

/**
 * The app's theme tokens, re-pointed at MetaTrader's palette.
 *
 * Every surface in this app paints from `--pp-*` custom properties (see globals.css and the Tailwind
 * config, where `bg-surface`, `text-muted`, `bg-accent` and the rest all resolve through them). Set
 * these on a container and everything inside it renders in MetaTrader's colours — without editing the
 * components themselves.
 *
 * That matters most for the money surfaces. The deposit and withdrawal forms are ~1,100 lines of
 * payment logic across four components: STK push, Pay Bill claim, hosted checkout, withdrawal
 * limits, throttles, polling. Restyling them by hand would mean a thousand lines of diff through
 * code that moves real money, for a change that is entirely cosmetic. Re-pointing the tokens gets
 * the same screen with the payment path untouched.
 *
 * `up`/`down` keep MetaTrader's own pairing. Only ACCENT differs between the two sets below.
 */
const SHARED = {
  '--pp-bg': MT5.surface,
  '--pp-surface': MT5.surface,
  '--pp-surface-2': MT5.raised,
  '--pp-border': MT5.border,
  '--pp-fg': MT5.text,
  '--pp-muted': MT5.muted,
  '--pp-up': MT5.green,
  '--pp-down': MT5.red,
  '--pp-accent-fg': MT5.text,
  '--pp-info': MT5.blue,
  // The brand hue skins links and soft chips; on a MetaTrader surface those read blue.
  '--pp-brand': MT5.blueLink,
} as const;

/**
 * The default set. Accent is MetaTrader's BLUE, which is its identity colour: the title bar, the
 * active control, the buy side, and your own voice in a chat thread.
 */
export const MT5_TOKENS: CSSProperties = { ...SHARED, '--pp-accent': MT5.blue } as CSSProperties;

/**
 * For a surface whose primary action CONFIRMS something — a deposit, a withdrawal. MetaTrader puts
 * green on a confirming action and keeps blue for chrome, so a green Deposit button is right where a
 * green chat bubble would not be.
 */
export const MT5_CONFIRM_TOKENS: CSSProperties = { ...SHARED, '--pp-accent': MT5.green } as CSSProperties;
