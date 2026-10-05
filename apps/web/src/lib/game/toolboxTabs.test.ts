import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TOOLBOX_TABS, TOOLBOX_COLUMNS, VISIBLE_TOOLBOX_TABS, MT5_TOOLBOX_TAB_COUNT, toolboxTab,
} from './toolboxTabs.js';

/**
 * MetaTrader's Toolbox, pinned BY LABEL, because a count of twelve passes just as happily with the
 * wrong twelve. Source: docs/mt5/09-toolbox.md, read off its current-build screenshots.
 */

test("the Toolbox carries MetaTrader's twelve tabs, in its order and under its labels", () => {
  assert.equal(TOOLBOX_TABS.length, MT5_TOOLBOX_TAB_COUNT);
  assert.deepEqual(TOOLBOX_TABS.map((t) => t.label), [
    'Trade', 'Exposure', 'History', 'News', 'Mailbox', 'Calendar', 'Company',
    'Alerts', 'Articles', 'Code Base', 'Experts', 'Journal',
  ]);
  // "Code Base" is two words in the tab strip. MQL5.com's own search sub-tab writes it as one,
  // which is MetaQuotes disagreeing with itself rather than a slip here.
  assert.equal(toolboxTab('codebase')?.label, 'Code Base');
});

test('Company is hidden rather than disabled, which is MetaTrader s own behaviour', () => {
  // "This tab is hidden if the web page is disabled by the broker." No brand here publishes one.
  assert.equal(toolboxTab('company')?.hidden, true);
  assert.equal(VISIBLE_TOOLBOX_TABS.length, 11);
  assert.ok(!VISIBLE_TOOLBOX_TABS.some((t) => t.id === 'company'));
  // It is the only tab MetaTrader hides.
  assert.equal(TOOLBOX_TABS.filter((t) => t.hidden).length, 1);
});

test('the tabs this platform cannot fill are present and say why', () => {
  const blocked = TOOLBOX_TABS.filter((t) => t.unavailable !== undefined).map((t) => t.label);
  assert.deepEqual(blocked, ['Calendar', 'Company', 'Articles', 'Code Base', 'Experts']);
  for (const t of TOOLBOX_TABS.filter((x) => x.unavailable)) {
    assert.ok(t.unavailable!.length > 30, t.label);
  }
  // Exposure is NOT among them: it is computed from the open contracts and carries real numbers.
  assert.equal(toolboxTab('exposure')?.unavailable, undefined);
});

test('the six tabs that already carried real data still do', () => {
  for (const id of ['trade', 'exposure', 'history', 'news', 'mailbox', 'alerts', 'journal'] as const) {
    assert.equal(toolboxTab(id)?.unavailable, undefined, id);
  }
});

test("the Trade grid is MetaTrader's ten columns, including its two headed Price", () => {
  assert.deepEqual(TOOLBOX_COLUMNS.trade, [
    'Symbol', 'Ticket', 'Time', 'Type', 'Volume', 'Price', 'S / L', 'T / P', 'Price', 'Profit',
  ]);
  // Two columns genuinely share the heading "Price": the open price, then the current one.
  assert.equal(TOOLBOX_COLUMNS.trade!.filter((c) => c === 'Price').length, 2);
  // MetaTrader spaces the slashes in S / L and T / P.
  assert.ok(TOOLBOX_COLUMNS.trade!.includes('S / L'));
  assert.ok(TOOLBOX_COLUMNS.trade!.includes('T / P'));
});

test("History's grid is MetaTrader's twelve deal columns", () => {
  assert.deepEqual(TOOLBOX_COLUMNS.history, [
    'Time', 'Symbol', 'Deal', 'Type', 'Direction', 'Volume', 'Price', 'S / L', 'T / P',
    'Commission', 'Profit', 'Change',
  ]);
});

test('Exposure has a column headed with the deposit currency, filled in at render', () => {
  // MetaTrader writes the account's own currency code there, literally "USD" on its screenshot.
  assert.deepEqual(TOOLBOX_COLUMNS.exposure, ['Assets', 'Volume', 'Rate', '', 'Graph']);
  assert.equal(TOOLBOX_COLUMNS.exposure![3], '');
});

test('Code Base and Experts carry no invented headers', () => {
  // MetaQuotes has never rendered either grid and describes neither, so neither is guessed at.
  assert.equal(TOOLBOX_COLUMNS.codebase, undefined);
  assert.equal(TOOLBOX_COLUMNS.experts, undefined);
});
