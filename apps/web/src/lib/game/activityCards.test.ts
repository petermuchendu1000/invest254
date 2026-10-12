import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectCards, eligible, keyOf, MIN_WITHDRAWAL_CENTS } from './activityCards.js';
import type { BrandActivityDto } from '@/lib/api/types';

/**
 * The notification's selection rules.
 *
 * These exist because of a production failure: the component walked the feed with `.reverse()`,
 * under a comment claiming the server sends oldest-first. It sends NEWEST-first, so the reversal
 * made the burst pick the three OLDEST eligible rows — which on a real brand were one prolific
 * trader's wins from fifteen days earlier, repeated on every card, while fresh activity sat unused
 * at the top of the array.
 */

const row = (over: Partial<BrandActivityDto> = {}): BrandActivityDto => ({
  kind: 'win', name: 'Someone', amountCents: 500_00, agoSeconds: 60, ...over,
}) as BrandActivityDto;

/** A feed exactly as `recent()` returns it: freshest first. */
const FEED: BrandActivityDto[] = [
  row({ name: 'Akinyi', agoSeconds: 60 }),
  row({ name: 'Barasa', agoSeconds: 120 }),
  row({ name: 'Chebet', agoSeconds: 180 }),
  row({ name: 'Mkeeee', agoSeconds: 1_300_000 }),
  row({ name: 'Mkeeee', agoSeconds: 1_300_100, amountCents: 600_00 }),
  row({ name: 'Mkeeee', agoSeconds: 1_300_200, amountCents: 700_00 }),
];

test('the burst takes the FRESHEST rows, not the oldest — the bug that shipped', () => {
  const { take } = selectCards(FEED, new Set(), [], 3);
  assert.deepEqual(take.map((t) => t.name), ['Akinyi', 'Barasa', 'Chebet']);
  // The fortnight-old rows at the bottom must not be what a player is shown.
  assert.ok(!take.some((t) => t.agoSeconds > 10_000), 'a stale row reached the card queue');
});

test('one card per trader, however many rows they hold', () => {
  // A feed where the freshest rows are all the same account, which is the other half of the fault.
  const burst = [
    row({ name: 'Mkeeee', agoSeconds: 10 }),
    row({ name: 'Mkeeee', agoSeconds: 20, amountCents: 900_00 }),
    row({ name: 'Mkeeee', agoSeconds: 30, amountCents: 800_00 }),
    row({ name: 'Wanjiku', agoSeconds: 40 }),
  ];
  const { take } = selectCards(burst, new Set(), [], 3);
  assert.deepEqual(take.map((t) => t.name), ['Mkeeee', 'Wanjiku']);
});

test('a trader shown recently does not open the next card either', () => {
  const { take } = selectCards(FEED, new Set(), ['akinyi', 'barasa'], 3);
  assert.deepEqual(take.map((t) => t.name), ['Chebet', 'Mkeeee']);
});

test('names are matched case- and space-insensitively, so padding cannot defeat the rule', () => {
  const feed = [row({ name: ' MKEEEE ' }), row({ name: 'Mkeeee', amountCents: 999_00 })];
  const { take } = selectCards(feed, new Set(), [], 5);
  assert.equal(take.length, 1);
});

test('rows passed over for diversity are marked SEEN, not saved up for the next poll', () => {
  const { take, seenKeys } = selectCards(FEED, new Set(), [], 3);
  assert.equal(take.length, 3);
  // Every eligible row is accounted for, including the three the rule declined.
  assert.equal(seenKeys.length, FEED.length);
  // Feeding those keys back yields nothing, so a declined row never returns as news.
  const second = selectCards(FEED, new Set(seenKeys), [], 3);
  assert.equal(second.take.length, 0);
});

test('what earns a card: every win, a withdrawal only above the floor, never a deposit', () => {
  assert.equal(eligible(row({ kind: 'win', amountCents: 1 })), true);
  assert.equal(eligible(row({ kind: 'deposit', amountCents: 10_000_00 })), false);
  assert.equal(eligible(row({ kind: 'withdrawal', amountCents: MIN_WITHDRAWAL_CENTS })), true);
  assert.equal(eligible(row({ kind: 'withdrawal', amountCents: MIN_WITHDRAWAL_CENTS - 1 })), false);
});

test('identity ignores age, which the server recomputes on every poll', () => {
  assert.equal(keyOf(row({ agoSeconds: 5 })), keyOf(row({ agoSeconds: 9_999 })));
  assert.notEqual(keyOf(row({ name: 'A' })), keyOf(row({ name: 'B' })));
  assert.notEqual(keyOf(row({ amountCents: 1 })), keyOf(row({ amountCents: 2 })));
});

test('an empty or all-seen feed queues nothing rather than throwing', () => {
  assert.deepEqual(selectCards([], new Set(), [], 3).take, []);
  const all = new Set(FEED.map(keyOf));
  assert.deepEqual(selectCards(FEED, all, [], 3).take, []);
});
