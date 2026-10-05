import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SYMBOLS, SYMBOL_GROUPS, DEFAULT_SYMBOL, CURVE_DAY_TRAVEL,
  instrumentFor, marketSymbolOf, scaleFor, symbolDef, symbolsInGroup,
} from "./symbols.js";
import { XAUUSD } from "./candles.js";

/**
 * The catalogue. The tests that matter are the ones that would catch a symbol being WRONG rather
 * than merely absent: a digit count against market convention, a derived scale that does not
 * reproduce the instrument this platform already shipped, or two symbols that would collide on one
 * seed domain.
 */

test("the catalogue reproduces the instrument that already shipped, exactly", () => {
  // XAUUSD's scale was tuned by eye long before this catalogue existed. The derivation has to land
  // on the same number, or every chart and every settled position on the live brand would move.
  const gold = instrumentFor("XAUUSD");
  assert.deepEqual(gold, XAUUSD);
  assert.equal(gold?.scale, 85);
  assert.equal(DEFAULT_SYMBOL, XAUUSD.symbol);
});

test("scale is derived, not hand-picked", () => {
  // The rule, back-solved from gold: anchor * dayRange / 0.25.
  assert.equal(CURVE_DAY_TRAVEL, 0.25);
  for (const d of SYMBOLS) {
    if (d.scale === undefined) {
      assert.equal(marketSymbolOf(d).scale, scaleFor(d.anchor, d.dayRange), d.symbol);
    }
    // A scale of zero would pin the chart to a flat line. Rounding the derivation to an integer
    // did exactly that to every FX major before this test caught it: EURUSD derives 0.026.
    assert.ok(marketSymbolOf(d).scale > 0, d.symbol);
  }
  assert.ok(scaleFor(1.085, 0.006) > 0.02, "a major's scale must survive the derivation");
});

test("exactly one symbol overrides the derivation, and it is the one that predates it", () => {
  const overridden = SYMBOLS.filter((d) => d.scale !== undefined).map((d) => d.symbol);
  assert.deepEqual(overridden, ["XAUUSD"]);
});

test("digits follow market convention, which is what makes a quote readable", () => {
  const digitsOf = (s: string) => symbolDef(s)?.digits;
  // Majors quote to five places.
  for (const s of ["EURUSD", "GBPUSD", "AUDUSD", "NZDUSD", "USDCHF", "USDCAD"]) {
    assert.equal(digitsOf(s), 5, s);
  }
  // Yen pairs to three. This is the one that looks like a typo and is not.
  assert.equal(digitsOf("USDJPY"), 3);
  // Metals: gold two, silver three.
  assert.equal(digitsOf("XAUUSD"), 2);
  assert.equal(digitsOf("XAGUSD"), 3);
  // Indices to two.
  for (const s of ["US30", "US500", "USTEC", "GER40", "UK100", "JP225"]) {
    assert.equal(digitsOf(s), 2, s);
  }
  // Every symbol quotes to somewhere between two and five places.
  for (const d of SYMBOLS) assert.ok(d.digits >= 2 && d.digits <= 5, `${d.symbol} ${d.digits}`);
});

test("every symbol is unique, because the symbol IS the seed domain", () => {
  // Two symbols sharing a name would share a curve, which is the exact failure multi-symbol exists
  // to avoid.
  const names = SYMBOLS.map((s) => s.symbol);
  assert.equal(new Set(names).size, names.length);
  // And no name is empty or padded, since it goes into a seed string verbatim.
  for (const n of names) assert.equal(n, n.trim(), n);
  for (const n of names) assert.ok(n.length > 0);
});

test("the four groups are all populated, and every symbol is in one", () => {
  assert.deepEqual([...SYMBOL_GROUPS], ["Forex\\Majors", "Metals", "Crypto", "Indices"]);
  for (const g of SYMBOL_GROUPS) assert.ok(symbolsInGroup(g).length > 0, g);
  assert.equal(
    SYMBOL_GROUPS.reduce((n, g) => n + symbolsInGroup(g).length, 0),
    SYMBOLS.length,
  );
  // The seven majors that carry USD on one side.
  assert.equal(symbolsInGroup("Forex\\Majors").length, 7);
});

test("volatility is ordered the way these markets actually are", () => {
  // This is what stops every chart looking the same with a different number on the axis: crypto has
  // to move more than a metal, and a metal more than a major.
  const range = (s: string) => symbolDef(s)!.dayRange;
  assert.ok(range("BTCUSD") > range("XAUUSD"), "bitcoin over gold");
  assert.ok(range("XAUUSD") > range("EURUSD"), "gold over the euro");
  assert.ok(range("XAGUSD") > range("XAUUSD"), "silver over gold");
  // No symbol is implausibly still or implausibly wild.
  for (const d of SYMBOLS) {
    assert.ok(d.dayRange >= 0.004 && d.dayRange <= 0.06, `${d.symbol} ${d.dayRange}`);
  }
});

test("every symbol carries a description, which MetaTrader prints beside it", () => {
  for (const d of SYMBOLS) {
    assert.ok(d.description.length > 3, d.symbol);
    // The Specification header reads "XAUUSD, Gold vs US Dollar", so the description must not
    // repeat the symbol back.
    assert.ok(!d.description.startsWith(d.symbol), d.symbol);
  }
  assert.equal(symbolDef("XAUUSD")?.description, "Gold vs US Dollar");
});

test("anchors are plausible starting levels, not placeholders", () => {
  for (const d of SYMBOLS) assert.ok(d.anchor > 0, d.symbol);
  // A symbol quoted to five places sits near 1, one quoted to two can sit anywhere.
  assert.ok(symbolDef("EURUSD")!.anchor < 10);
  assert.ok(symbolDef("BTCUSD")!.anchor > 1000);
  // The anchor must survive rounding to the symbol's own tick: an anchor finer than the tick could
  // not be printed.
  for (const d of SYMBOLS) {
    const tick = 10 ** -d.digits;
    assert.ok(Math.abs(d.anchor / tick - Math.round(d.anchor / tick)) < 1e-6, `${d.symbol} ${d.anchor}`);
  }
});

test("an unknown symbol resolves to nothing rather than to a default", () => {
  // Silently falling back to gold would mean a typo traded a different instrument.
  assert.equal(instrumentFor("NOPE"), undefined);
  assert.equal(symbolDef("NOPE"), undefined);
});
