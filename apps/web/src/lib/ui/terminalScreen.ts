/**
 * Whether this request gets a MetaTrader screen off the trade surface.
 *
 * Two places have to agree: the screen itself, and the shell, which has to drop the centred reading
 * column and the marketing footer for it (a MetaTrader screen fills the window and ends at the
 * toolbar). Keeping the rule in one place is what stops them drifting apart — a terminal screen
 * inside a centred container with a footer under it is neither one thing nor the other.
 *
 * A BASIC-skin screen never qualifies: MetaTrader chrome is the opposite of what Basic is for. That
 * used to exclude every marketer, since a marketer was pinned to Basic; marketers now get the player
 * interface, so the only screen this turns away is a player who chose the simplified view.
 *
 * The parameter keeps its name because it is still what `useMarketerSkin()` returns — see the policy
 * note in lib/marketer/isMarketer.
 */
export const isTerminalScreen = (terminalBrand: boolean, isMarketer: boolean): boolean =>
  terminalBrand && !isMarketer;

/**
 * Routes that render a full-bleed MetaTrader screen outside the trade surface.
 *
 * `/dashboard` is the marketer's own page, and it belongs here for the same reason the rest do: it
 * is reached from inside the terminal, so arriving at a centred reading column with a marketing
 * footer under it would be the moment the illusion of one app breaks.
 */
export const TERMINAL_ROUTES: ReadonlySet<string> = new Set(['/history', '/account', '/wallet', '/dashboard']);

export const isTerminalRoute = (pathname: string | null | undefined): boolean =>
  pathname !== null && pathname !== undefined && TERMINAL_ROUTES.has(pathname);
