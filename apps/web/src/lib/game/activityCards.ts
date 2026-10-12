import type { BrandActivityDto } from '@/lib/api/types';

/**
 * WHICH activity rows earn a notification card, and WHICH of them actually get one.
 *
 * Extracted from `ActivityNotice` and kept pure because this is precisely the logic that failed in
 * production. The component walked the feed with `.reverse()`, under a comment asserting the server
 * sends oldest-first. It does not — `recent()` sorts ascending by age, so index 0 is the freshest
 * row — and the reversal meant the three OLDEST eligible events were the ones shown. On a brand
 * whose newest real activity was a fortnight old, that was the same prolific trader's wins, over
 * and over, while genuinely fresh rows sat unused at the top of the array.
 *
 * None of that was visible to a type checker and none of it was reachable from a test while it
 * lived inside a `useEffect`. It is a function now.
 */

/** KES 1,000 — see `eligible`. */
export const MIN_WITHDRAWAL_CENTS = 100_000;

/**
 * WHICH ROWS EARN A CARD.
 *
 *  - `win`: all of them. A winning trade on this screen's own game is what the card is for.
 *  - `withdrawal`: above a floor. Money actually leaving for a player's phone is the strongest
 *    proof this product can show, and the server only reports withdrawals that were PAID — but the
 *    minimum withdrawal is a few hundred shillings and popping a card for one devalues every other
 *    card. The threshold is in KES cents because that is the money of record on every brand,
 *    foreign ones included; a display-currency threshold would drift with the FX rate.
 *  - `deposit`: never. Money going IN is not a win, and a deposit notice over a deposit button is
 *    an advert dressed as news.
 */
export function eligible(it: BrandActivityDto): boolean {
  if (it.kind === 'win') return true;
  if (it.kind === 'withdrawal') return it.amountCents >= MIN_WITHDRAWAL_CENTS;
  return false;
}

/**
 * Identity for "have I shown this already?".
 *
 * The DTO carries no id — `activity.pg.ts` deliberately withholds transaction ids from a public
 * feed — and `agoSeconds` is recomputed on every poll, so neither can be part of the key. Name +
 * kind + amount is what is left. Two separate wins of the same amount by the same trader collide
 * and the second is dropped, which is the right way to be wrong: a card too few is unnoticeable,
 * the same card twice looks fabricated.
 */
export function keyOf(it: BrandActivityDto): string {
  return `${it.kind}|${it.name}|${it.amountCents}`;
}

export interface CardSelection {
  /** The rows to show, freshest first. */
  take: BrandActivityDto[];
  /**
   * Every eligible row considered, INCLUDING the ones diversity passed over.
   *
   * They are marked seen so a row held back because its trader was already on screen does not come
   * back as news on the next poll — it was declined, not deferred.
   */
  seenKeys: string[];
}

/**
 * Choose the next cards.
 *
 * @param items       the feed, freshest first, exactly as `recent()` returns it.
 * @param seen        keys already shown or declined.
 * @param recentNames names the last few cards carried, lower-cased.
 * @param max         how many to take (the first-load burst cap; Infinity afterwards).
 */
export function selectCards(
  items: readonly BrandActivityDto[],
  seen: ReadonlySet<string>,
  recentNames: readonly string[],
  max: number,
): CardSelection {
  const fresh = items.filter(eligible).filter((it) => !seen.has(keyOf(it)));

  /**
   * ONE CARD PER TRADER.
   *
   * Reading the feed in the right order is not enough on its own: an account that trades in bursts
   * owns the TOP of the window as legitimately as it owned the bottom, so the freshest rows can
   * still be three wins by one person. A feed meant to read as a room cannot keep naming one of
   * its people. The server caps a name at two rows per window as well — belt and braces, since the
   * two layers fail independently.
   */
  const used = new Set(recentNames.map((n) => n.trim().toLowerCase()));
  const take: BrandActivityDto[] = [];
  for (const it of fresh) {
    if (take.length >= max) break;
    const n = it.name.trim().toLowerCase();
    if (used.has(n)) continue;
    used.add(n);
    take.push(it);
  }

  return { take, seenKeys: fresh.map(keyOf) };
}
