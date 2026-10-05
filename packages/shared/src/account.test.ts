import { test } from "node:test";
import assert from "node:assert/strict";
import { accountSummary, exposureRows, lotsOfStake, LOT_STAKE_CENTS, accountStripFields, mtAmount } from "./account.js";

test("a flat account: equity is the balance and there is no margin level", () => {
  const a = accountSummary({ balanceCents: 500_000, openStakeCents: 0, floatingPnlCents: 0 });
  assert.equal(a.equityCents, 500_000);
  assert.equal(a.marginCents, 0);
  assert.equal(a.freeMarginCents, 500_000);
  // Not 0 and not Infinity: with nothing open the ratio is undefined, and printing a number here
  // would read as a margin call on an account that holds no position at all.
  assert.equal(a.marginLevelPct, null);
});

test("a winning position lifts equity and free margin, leaving the balance alone", () => {
  // Balance is the SETTLED wallet, so it must not move until the contract settles.
  const a = accountSummary({ balanceCents: 500_000, openStakeCents: 100_000, floatingPnlCents: 40_000 });
  assert.equal(a.balanceCents, 500_000, "balance moves only on settlement");
  assert.equal(a.equityCents, 540_000);
  assert.equal(a.marginCents, 100_000);
  assert.equal(a.freeMarginCents, 440_000);
  assert.equal(a.marginLevelPct, 540);
});

test("a losing position lowers equity by exactly the engine's floating loss", () => {
  const a = accountSummary({ balanceCents: 500_000, openStakeCents: 100_000, floatingPnlCents: -100_000 });
  assert.equal(a.equityCents, 400_000);
  assert.equal(a.freeMarginCents, 300_000);
  assert.equal(a.marginLevelPct, 400);
});

test("margin level is Equity/Margin x 100 — MetaTrader's formula, not an approximation", () => {
  for (const [balance, stake, floating] of [[250_000, 50_000, 0], [1_000_000, 300_000, -120_000], [75_000, 25_000, 60_000]] as const) {
    const a = accountSummary({ balanceCents: balance, openStakeCents: stake, floatingPnlCents: floating });
    assert.equal(a.marginLevelPct, (a.equityCents / a.marginCents) * 100);
  }
});

test("equity can fall below the stake without going negative on a total loss", () => {
  // The worst a contract can do is lose its whole stake, so equity bottoms out at balance - stake.
  const a = accountSummary({ balanceCents: 120_000, openStakeCents: 120_000, floatingPnlCents: -120_000 });
  assert.equal(a.equityCents, 0);
  assert.equal(a.freeMarginCents, -120_000);
  assert.equal(a.marginLevelPct, 0);
});

test("volume: a stake renders as lots at the documented contract size", () => {
  assert.equal(lotsOfStake(LOT_STAKE_CENTS), "1.00");
  assert.equal(lotsOfStake(LOT_STAKE_CENTS / 2), "0.50");
  assert.equal(lotsOfStake(25_000), "0.03");       // the KES 250 minimum stake
  assert.equal(lotsOfStake(5_000_000), "5.00");    // the KES 50,000 maximum stake
  // Presentation only: it must never round a stake to zero and so imply a free trade.
  assert.notEqual(lotsOfStake(25_000), "0.00");
});

test("exposure nets opposite contracts on one symbol, as MetaTrader's Exposure does", () => {
  // A buy is positive and a sell negative, so one of each in the same size is flat in volume.
  const rows = exposureRows([
    { symbol: "XAUUSD", direction: "buy", stakeCents: LOT_STAKE_CENTS },
    { symbol: "XAUUSD", direction: "sell", stakeCents: LOT_STAKE_CENTS },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.netLots, 0);
  // But the money committed is NOT flat: both stakes are still at risk.
  assert.equal(rows[0]!.valueCents, 2 * LOT_STAKE_CENTS);
  assert.equal(rows[0]!.share, 1);
});

test("exposure reports each symbol once, largest first", () => {
  const rows = exposureRows([
    { symbol: "EURUSD", direction: "buy", stakeCents: 100_000 },
    { symbol: "XAUUSD", direction: "buy", stakeCents: 300_000 },
    { symbol: "EURUSD", direction: "buy", stakeCents: 100_000 },
  ]);
  assert.deepEqual(rows.map((r) => r.symbol), ["XAUUSD", "EURUSD"]);
  assert.equal(rows[0]!.valueCents, 300_000);
  assert.equal(rows[1]!.valueCents, 200_000);
  // The shares are the bar MetaTrader draws, and they account for the whole account.
  assert.equal(rows[0]!.share + rows[1]!.share, 1);
  assert.ok(Math.abs(rows[0]!.share - 0.6) < 1e-9);
});

test("a short position is a negative volume and a positive value", () => {
  const rows = exposureRows([
    { symbol: "XAUUSD", direction: "sell", stakeCents: 2 * LOT_STAKE_CENTS },
  ]);
  assert.equal(rows[0]!.netLots, -2);
  // Money at risk has no direction.
  assert.equal(rows[0]!.valueCents, 2 * LOT_STAKE_CENTS);
});

test("a flat account has no exposure rows, as MetaTrader shows none", () => {
  assert.deepEqual(exposureRows([]), []);
});

/**
 * MetaTrader's account summary strip, against the strings read off its own screenshots in
 * docs/mt5/09-toolbox.md section 4. Reproducing a published line exactly is the only test here that
 * can catch a format that merely looks right.
 */

test("the strip reproduces MetaTrader's own published line, character for character", () => {
  // en/position_manage.png, floating:
  // Balance: 3 370.75 USD  Equity: 4 004.07  Margin: 371.89  Free Margin: 3 632.18  Margin Level: 1 076.68 %
  const fields = accountStripFields({
    balance: 3370.75, equity: 4004.07, margin: 371.89, freeMargin: 3632.18,
    marginLevelPct: 1076.68, currency: 'USD',
  });
  assert.equal(fields.map((f) => `${f.label} ${f.value}`).join('  '),
    'Balance: 3 370.75 USD  Equity: 4 004.07  Margin: 371.89  Free Margin: 3 632.18  Margin Level: 1 076.68 %');
});

test('a second published line, to prove the first was not a coincidence', () => {
  // en/interface_overview.png
  const fields = accountStripFields({
    balance: 7796.40, equity: 8508.03, margin: 2016.60, freeMargin: 6491.43,
    marginLevelPct: 421.90, currency: 'USD',
  });
  assert.equal(fields.map((f) => `${f.label} ${f.value}`).join('  '),
    'Balance: 7 796.40 USD  Equity: 8 508.03  Margin: 2 016.60  Free Margin: 6 491.43  Margin Level: 421.90 %');
});

test('the two labels this platform had wrong carry their capital second word', () => {
  // They read "Free margin" and "Margin level" before the screenshots were read off at 8x.
  const labels = accountStripFields({
    balance: 1, equity: 1, margin: 0, freeMargin: 1, marginLevelPct: null, currency: 'KES',
  }).map((f) => f.label);
  assert.deepEqual(labels, ['Balance:', 'Equity:', 'Margin:', 'Free Margin:', 'Margin Level:']);
});

test('the currency code appears once, after the balance, and nowhere else', () => {
  const fields = accountStripFields({
    balance: 1000, equity: 1200, margin: 100, freeMargin: 1100, marginLevelPct: 1200, currency: 'KES',
  });
  assert.equal(fields[0]!.value, '1 000.00 KES');
  for (const f of fields.slice(1)) assert.ok(!f.value.includes('KES'), `${f.label} ${f.value}`);
});

test('margin level has a space before its percent sign, and a dash when nothing is open', () => {
  const open = accountStripFields({ balance: 1, equity: 1, margin: 1, freeMargin: 0, marginLevelPct: 100, currency: 'USD' });
  assert.equal(open[4]!.value, '100.00 %');
  // Nothing open means dividing by a zero margin. MetaTrader has no screenshot of that state, and a
  // number here would be a claim about an account with no position in it.
  const flat = accountStripFields({ balance: 1, equity: 1, margin: 0, freeMargin: 1, marginLevelPct: null, currency: 'USD' });
  assert.equal(flat[4]!.value, '-');
});

test('the thousands separator is a space at every magnitude, and survives a negative', () => {
  assert.equal(mtAmount(0), '0.00');
  assert.equal(mtAmount(999.5), '999.50');
  assert.equal(mtAmount(1000), '1 000.00');
  assert.equal(mtAmount(1234567.891), '1 234 567.89');
  // A floating loss is a real strip value: the trailing total goes negative.
  assert.equal(mtAmount(-1234.5), '-1 234.50');
  // Not a locale's separator: `Intl` would give a comma here on en and a point on de, and the
  // Russian build of MetaTrader uses the same space the English one does.
  assert.ok(!mtAmount(1000).includes(','));
});
