import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quoteTone, QUOTE_TONE_COLOUR, STALE_AFTER_MS } from './quoteTone.js';

/**
 * MetaQuotes' rule, verbatim: "Blue — the current price is higher than the previous one; Red — the
 * current price is lower than the previous one; Gray — the price has not changed for the last 15
 * seconds."
 */

test('a quote that just ticked up is blue, and one that ticked down is red', () => {
  const now = 1_000_000;
  assert.equal(quoteTone({ up: true, changedAt: now, now }), 'up');
  assert.equal(quoteTone({ up: false, changedAt: now, now }), 'down');
  assert.equal(QUOTE_TONE_COLOUR.up, '#3183ff');
  assert.equal(QUOTE_TONE_COLOUR.down, '#f23645');
});

test("the stale state is the window's foreground, not a grey", () => {
  // MetaQuotes writes "Gray", and its own screenshots disagree: the unchanged price samples at
  // #000000 on the white Market Watch and #FFFFFF on the black Popup Prices. Only the gutter glyph
  // is literally grey. Painting a current-but-unmoved quote grey would dim it for no reason.
  assert.equal(QUOTE_TONE_COLOUR.stale, 'currentColor');
});

test('the third state is staleness, not an unchanged tick', () => {
  const now = 1_000_000;
  // Fourteen seconds since the last CHANGE: still coloured.
  assert.equal(quoteTone({ up: true, changedAt: now - 14_000, now }), 'up');
  // Fifteen: stale. MetaTrader's own timeout, to the second.
  assert.equal(quoteTone({ up: true, changedAt: now - STALE_AFTER_MS, now }), 'stale');
  assert.equal(quoteTone({ up: false, changedAt: now - 60_000, now }), 'stale');
  assert.equal(STALE_AFTER_MS, 15_000);
});

test('a quote that keeps arriving at the same number still goes stale', () => {
  // This is the case the rule is actually about, and the one a naive reading misses: identical
  // quotes arriving every second are not a CHANGE, so the timer keeps running.
  const changedAt = 0;
  assert.equal(quoteTone({ up: true, changedAt, now: 10_000 }), 'up');
  assert.equal(quoteTone({ up: true, changedAt, now: 15_001 }), 'stale');
});

test('a going-stale quote comes back the moment it changes again', () => {
  assert.equal(quoteTone({ up: true, changedAt: 0, now: 20_000 }), 'stale');
  // A fresh change at 20s restores the colour.
  assert.equal(quoteTone({ up: false, changedAt: 20_000, now: 20_000 }), 'down');
});

test('before any quote has arrived there is no tone at all', () => {
  // Not one of MetaTrader's three: there is nothing to colour yet, which is distinct from stale.
  assert.equal(quoteTone({ up: null, changedAt: null, now: 1 }), null);
  assert.equal(quoteTone({ up: true, changedAt: null, now: 1 }), null);
  assert.equal(quoteTone({ up: null, changedAt: 1, now: 1 }), null);
});
