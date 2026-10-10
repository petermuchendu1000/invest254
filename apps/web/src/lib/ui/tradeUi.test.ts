import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTradeUi, isTradeUi, TRADE_UIS } from './tradeUi.js';

/**
 * The screen and the shell around it both resolve this. They disagreed once — the override was read
 * only inside the screen — and the result was the new layout rendered inside the old header, which
 * is why the rule is pure and tested rather than written out twice.
 */
test('resolveTradeUi: the override wins, then the brand, then the default', () => {
  assert.equal(resolveTradeUi('candlestick', 'classic'), 'candlestick');
  assert.equal(resolveTradeUi(null, 'candlestick'), 'candlestick');
  assert.equal(resolveTradeUi(undefined, 'broker'), 'broker');
  assert.equal(resolveTradeUi(null, null), 'classic');
  assert.equal(resolveTradeUi(null, undefined), 'classic');
});

test('resolveTradeUi: anything the product does not have falls back rather than rendering nothing', () => {
  // `?ui=` is a URL anyone can type, and a brand row could carry a value a later migration removed.
  assert.equal(resolveTradeUi('nonsense', 'candlestick'), 'candlestick');
  assert.equal(resolveTradeUi('nonsense', 'also-nonsense'), 'classic');
  assert.equal(resolveTradeUi('', ''), 'classic');
});

test('isTradeUi accepts exactly the four layouts that exist', () => {
  assert.deepEqual([...TRADE_UIS], ['classic', 'digits', 'broker', 'candlestick']);
  for (const v of TRADE_UIS) assert.equal(isTradeUi(v), true);
  for (const v of [null, undefined, 1, 'Classic', 'mt5']) assert.equal(isTradeUi(v), false);
});
