/**
 * Whether this request gets a MetaTrader screen off the trade surface.
 *
 * Two places have to agree: the screen itself, and the shell, which has to drop the centred reading
 * column and the marketing footer for it (a MetaTrader screen fills the window and ends at the
 * toolbar). Keeping the rule in one place is what stops them drifting apart — a terminal screen
 * inside a centred container with a footer under it is neither one thing nor the other.
 *
 * A marketer screen never qualifies: trading-terminal chrome is exactly what the marketer skin
 * exists to remove.
 */
export const isTerminalScreen = (terminalBrand: boolean, isMarketer: boolean): boolean =>
  terminalBrand && !isMarketer;

/** Routes that render a full-bleed MetaTrader screen outside the trade surface. */
export const TERMINAL_ROUTES: ReadonlySet<string> = new Set(['/history', '/account', '/wallet']);

export const isTerminalRoute = (pathname: string | null | undefined): boolean =>
  pathname !== null && pathname !== undefined && TERMINAL_ROUTES.has(pathname);
