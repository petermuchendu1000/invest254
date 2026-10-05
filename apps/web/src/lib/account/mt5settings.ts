/**
 * What MetaTrader's Settings screen lists here, and what it must not.
 *
 * The screen itself is chrome; these are the two rules behind it that are worth pinning down, so
 * they are here as pure functions with tests rather than as conditions buried in JSX.
 */

/** A row in the About group. */
export interface AboutRow {
  id: string;
  label: string;
  sub: string;
  href: string;
  /**
   * True when the row only exists because this is a real-money gambling product: a licence, a
   * responsible-gaming page, a problem-gambling helpline.
   */
  gambling: boolean;
}

export const ABOUT_ROWS: readonly AboutRow[] = [
  { id: 'terms', label: 'Terms of service', sub: 'The agreement you trade under', href: '/legal#terms', gambling: false },
  { id: 'privacy', label: 'Privacy policy', sub: 'What we store and why', href: '/legal#privacy', gambling: false },
  { id: 'responsible', label: 'Responsible gaming', sub: 'Limits, self-exclusion and support', href: '/legal#responsible-gaming', gambling: true },
  { id: 'licence', label: 'Licence', sub: 'Who this service is operated by', href: '/legal#licence', gambling: true },
];

/**
 * The About rows for this screen.
 *
 * A marketer screen is recorded and posted, and the whole point of the marketer skin is that a
 * recording carries no sign of a gambling product — which is exactly what a licence line, a
 * responsible-gaming page or a problem-gambling helpline is. The footer already drops them for the
 * same reason; this keeps the two in step. Terms and Privacy stay, because every app has those.
 */
export function aboutRows(isMarketer: boolean): AboutRow[] {
  return ABOUT_ROWS.filter((r) => !(isMarketer && r.gambling));
}

/** The sub-label under Identity verification, from the KYC status the API reports. */
export function kycSub(status: string | null | undefined): string {
  switch (status) {
    case 'approved': return 'Verified';
    case 'pending': return 'In review';
    case 'rejected': return 'Not approved: try again';
    default: return 'Not verified';
  }
}

/** Tone for that sub-label: approved reads green, rejected red, anything else neutral. */
export function kycTone(status: string | null | undefined): 'ok' | 'bad' | 'neutral' {
  if (status === 'approved') return 'ok';
  if (status === 'rejected') return 'bad';
  return 'neutral';
}
