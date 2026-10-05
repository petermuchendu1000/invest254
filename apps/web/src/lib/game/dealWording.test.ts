import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dealResultLabel, dealsTabLabel, dealListCopy } from './dealWording.js';

/**
 * The terminal shell must not call a trade a bet, and the classic shell must keep the words it has.
 * Both halves matter: a change that neutered the classic copy would be a regression on the brands
 * that never asked to look like MetaTrader.
 */

test('a terminal says Closed and lets the signed P/L say whether it made money', () => {
  // MetaTrader's own Deals list has no "won" column: the Profit figure is signed and coloured, so a
  // word repeating it in another vocabulary would be noise.
  assert.equal(dealResultLabel({ status: 'settled', result: 'win', multiplier: 1.95 }, true), 'Closed');
  assert.equal(dealResultLabel({ status: 'settled', result: 'loss' }, true), 'Closed');
  assert.equal(dealResultLabel({ status: 'open' }, true), 'Open');
  // MetaTrader's word for an order that never became a deal.
  assert.equal(dealResultLabel({ status: 'settled', result: null }, true), 'Cancelled');
});

test('the classic shell keeps every word it had', () => {
  assert.equal(dealResultLabel({ status: 'settled', result: 'win', multiplier: 1.95 }, false), 'Won ×1.95');
  assert.equal(dealResultLabel({ status: 'settled', result: 'loss' }, false), 'Lost');
  assert.equal(dealResultLabel({ status: 'settled', result: null }, false), 'Void');
  assert.equal(dealResultLabel({ status: 'open' }, false), 'Open');
  // A win with no multiplier recorded still reads as a win rather than as NaN.
  assert.equal(dealResultLabel({ status: 'settled', result: 'win' }, false), 'Won ×1.00');
});

test('no terminal string contains the word bet', () => {
  const copy = dealListCopy(true);
  const all = [dealsTabLabel(true), copy.emptyTitle, copy.emptyBody, copy.loadError].join(' ');
  assert.ok(!/\bbets?\b/i.test(all), all);
  assert.equal(dealsTabLabel(true), 'Deals');
});

test('and every classic string still does, because that shell is not MetaTrader', () => {
  const copy = dealListCopy(false);
  assert.equal(dealsTabLabel(false), 'Bets');
  assert.ok(/bets/i.test(copy.emptyTitle));
  assert.ok(/bet history/i.test(copy.loadError));
});
