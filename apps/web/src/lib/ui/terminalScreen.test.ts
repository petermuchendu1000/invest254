import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTerminalRoute, isTerminalScreen, isBrokerTerminalBrand, TERMINAL_ROUTES } from './terminalScreen.js';

/**
 * Which routes wear MetaTrader's chrome.
 *
 * This was an exact-match Set of four paths, so `/history` was a terminal screen and
 * `/history/digits` was not, and every other page a trader can reach rendered in the generic house
 * style whatever brand it belonged to — the affiliate screen put the terminal's blue bar on top of
 * an invest254 reading column with the gaming footer underneath.
 */

test('a terminal route covers its children, which is what the Set could not do', () => {
  assert.equal(isTerminalRoute('/history'), true);
  assert.equal(isTerminalRoute('/history/digits'), true);
  assert.equal(isTerminalRoute('/legal'), true);
  assert.equal(isTerminalRoute('/legal#risk'), false, 'a fragment is not part of a pathname');
  assert.equal(isTerminalRoute('/r/ABC123'), true, 'a referral landing is a first impression of the brand');
});

test('a prefix matches a SEGMENT, never a word that merely starts the same way', () => {
  // `/accounts-payable` is not `/account`. Matching on `startsWith` alone would sweep it in.
  assert.equal(isTerminalRoute('/account'), true);
  assert.equal(isTerminalRoute('/account/security'), true);
  assert.equal(isTerminalRoute('/accounts-payable'), false);
  assert.equal(isTerminalRoute('/walletx'), false);
  assert.equal(isTerminalRoute('/historian'), false);
});

test('the operator consoles are never terminal screens', () => {
  // They are staff tools with their own sidebar shells and are not reached from the terminal.
  for (const p of ['/admin', '/admin/users', '/admin/users/42', '/platform', '/platform/billing', '/console']) {
    assert.equal(isTerminalRoute(p), false, p);
  }
});

test('the trade surface itself is not in the list: it is the shell, not a screen off it', () => {
  assert.equal(isTerminalRoute('/'), false);
});

test('nothing, and nothing-shaped, is refused rather than throwing', () => {
  assert.equal(isTerminalRoute(null), false);
  assert.equal(isTerminalRoute(undefined), false);
  assert.equal(isTerminalRoute(''), false);
});

test('every listed prefix is an absolute path with no trailing slash', () => {
  // A trailing slash would make the segment test below it never fire.
  for (const p of TERMINAL_ROUTES) {
    assert.match(p, /^\/[a-z0-9-]*$/, p);
  }
});

test('the brand half is unchanged: a candlestick brand, and never a Basic skin', () => {
  assert.equal(isTerminalScreen(true, false), true);
  assert.equal(isTerminalScreen(true, true), false, 'MetaTrader chrome is the opposite of what Basic is for');
  assert.equal(isTerminalScreen(false, false), false);
});

test('isBrokerTerminalBrand: named outright, or reached by a TradingView chart as it always was', () => {
  // The name selects the terminal whatever the chart is — that is the point of giving it one.
  assert.equal(isBrokerTerminalBrand('broker', false), true);
  assert.equal(isBrokerTerminalBrand('broker', true), true);

  // The route every candlestick brand live today arrives by: no trade_ui set, a TradingView chart.
  assert.equal(isBrokerTerminalBrand(undefined, true), true);
  assert.equal(isBrokerTerminalBrand(null, true), true);
  assert.equal(isBrokerTerminalBrand('classic', true), true);

  // A line brand is not a terminal, however it is asked.
  assert.equal(isBrokerTerminalBrand('classic', false), false);
  assert.equal(isBrokerTerminalBrand(undefined, false), false);

  // The two screens that are emphatically NOT the terminal keep their own layout even on a
  // candlestick chart — which is exactly the case the new screen runs in, and the regression that
  // would otherwise hand it MetaTrader's chrome.
  assert.equal(isBrokerTerminalBrand('candlestick', true), false);
  assert.equal(isBrokerTerminalBrand('digits', true), false);
});
