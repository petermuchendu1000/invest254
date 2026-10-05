/**
 * MetaTrader's Toolbox tabs, as data.
 *
 * Twelve tabs, in MetaTrader's order and under its own labels, read off its current-build
 * screenshots (see docs/mt5/09-toolbox.md). "Code Base" is two words. The window itself is called
 * `Toolbox` and opens on Ctrl+T; Ctrl+F9 opens the Trade tab and focuses it, and no other tab has a
 * shortcut.
 *
 * Six of the twelve were missing here, and they are not all the same kind of missing:
 *
 *   Exposure    REAL. It is computed from the contracts that are open (see `exposureRows` in the
 *               shared package), so it carries true numbers rather than a placeholder.
 *   Company     HIDDEN, which is MetaTrader's own behaviour: "This tab is hidden if the web page is
 *               disabled by the broker." No brand here publishes one, so the tab is not drawn. That
 *               is fidelity, not omission.
 *   Calendar    present and DISABLED. MetaTrader fills it from an economic-calendar feed. There is
 *               no such feed behind this platform, and inventing releases would be worse than
 *               saying so.
 *   Articles    present and DISABLED. MQL5.com's article library.
 *   Code Base   present and DISABLED. MQL5.com's code library.
 *   Experts     present and DISABLED. The Expert Advisor log; this platform runs no Expert
 *               Advisors, which is the same reason seven of MetaTrader's objects are disabled.
 *
 * MetaTrader also puts four right-aligned BUTTONS beside the tabs, not tabs: Market, Signals, VPS
 * and Tester. All four are MetaQuotes' own services, so none is drawn here.
 */

export type ToolboxTab =
  | 'trade' | 'exposure' | 'history' | 'news' | 'mailbox' | 'calendar' | 'company'
  | 'alerts' | 'articles' | 'codebase' | 'experts' | 'journal';

export interface ToolboxTabDef {
  id: ToolboxTab;
  /** Exactly as MetaTrader's tab strip writes it. */
  label: string;
  /** Set where MetaTrader has the tab and this platform cannot fill it. */
  unavailable?: string;
  /**
   * MetaTrader hides a tab outright rather than disabling it, which it does for Company alone.
   */
  hidden?: boolean;
}

const NO_CALENDAR =
  'MetaTrader fills this from an economic calendar feed. This platform has none, and inventing releases would be worse than leaving it empty.';
const NO_MQL5 = (what: string) =>
  `MetaTrader reads this from MQL5.com's ${what}. This platform is not connected to MQL5.com.`;
const NO_EA =
  'The Expert Advisor log. This platform runs no Expert Advisors, so there is nothing for it to report.';
const NO_COMPANY =
  'MetaTrader hides this tab when the broker publishes no web page, and no brand here publishes one.';

export const TOOLBOX_TABS: readonly ToolboxTabDef[] = [
  { id: 'trade', label: 'Trade' },
  { id: 'exposure', label: 'Exposure' },
  { id: 'history', label: 'History' },
  { id: 'news', label: 'News' },
  { id: 'mailbox', label: 'Mailbox' },
  { id: 'calendar', label: 'Calendar', unavailable: NO_CALENDAR },
  { id: 'company', label: 'Company', unavailable: NO_COMPANY, hidden: true },
  { id: 'alerts', label: 'Alerts' },
  { id: 'articles', label: 'Articles', unavailable: NO_MQL5('article library') },
  { id: 'codebase', label: 'Code Base', unavailable: NO_MQL5('code library') },
  { id: 'experts', label: 'Experts', unavailable: NO_EA },
  { id: 'journal', label: 'Journal' },
];

/** MetaTrader's count, pinned so the strip can be checked against its own. */
export const MT5_TOOLBOX_TAB_COUNT = 12;

/** The tabs actually drawn: MetaTrader hides Company rather than disabling it. */
export const VISIBLE_TOOLBOX_TABS: readonly ToolboxTabDef[] =
  TOOLBOX_TABS.filter((t) => t.hidden !== true);

export const toolboxTab = (id: ToolboxTab): ToolboxTabDef | undefined =>
  TOOLBOX_TABS.find((t) => t.id === id);

/**
 * MetaTrader's column headers, per tab, exactly as its own grids write them.
 *
 * Two oddities are its, not typos here: the Trade tab carries TWO columns headed `Price` (the open
 * price, then the current one), and `S / L` and `T / P` are written with spaces around the slash.
 *
 * Code Base and Experts have no headers listed because MetaQuotes has never rendered either grid in
 * a screenshot and describes neither in prose. Guessing them would be the kind of invention this
 * whole exercise exists to avoid; docs/mt5/09-toolbox.md records both as unverified.
 */
export const TOOLBOX_COLUMNS: Partial<Record<ToolboxTab, readonly string[]>> = {
  trade: ['Symbol', 'Ticket', 'Time', 'Type', 'Volume', 'Price', 'S / L', 'T / P', 'Price', 'Profit'],
  // The fourth column is headed with the deposit currency's own code, so it is filled in at render.
  exposure: ['Assets', 'Volume', 'Rate', '', 'Graph'],
  history: ['Time', 'Symbol', 'Deal', 'Type', 'Direction', 'Volume', 'Price', 'S / L', 'T / P', 'Commission', 'Profit', 'Change'],
  news: ['Subject', 'Category', 'Time'],
  mailbox: ['Subject', 'From', 'To', 'Time'],
  calendar: ['Time', 'Currency', 'Event', 'Priority', 'Period', 'Actual', 'Forecast', 'Previous'],
  alerts: ['Symbol', 'Condition', 'Counter', 'Limit', 'Timeout', 'Expiration', 'Event'],
  articles: ['Name', 'Category', 'Date'],
  journal: ['Time', 'Source', 'Message'],
};
