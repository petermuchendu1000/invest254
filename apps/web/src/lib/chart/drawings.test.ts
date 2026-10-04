import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANCHORS_NEEDED, FIB_LEVELS, TOOLS, distanceToSegment, fibLines, hitTest, humanDuration,
  measure, parseDrawings, pitchforkLines, serializeDrawings, storageKey, type Anchor, type Drawing,
} from './drawings.js';

/**
 * The drawing tools are geometry, and geometry is where a chart tool quietly lies: a Fibonacci level
 * at the wrong ratio or a pitchfork whose tines are not parallel looks plausible and is useless.
 * Every number a tool puts on screen is checked here against the definition it comes from.
 */

const at = (time: number, price: number): Anchor => ({ time, price });
const near = (a: number, b: number, eps = 1e-9, msg = '') => assert.ok(Math.abs(a - b) < eps, `${msg} got ${a}, want ${b}`);

test('every tool on the rail is either a drawing with a known anchor count, or an action', () => {
  for (const t of TOOLS) {
    const isAction = t.id === 'cursor' || t.id === 'crosshair';
    assert.ok(isAction || t.id in ANCHORS_NEEDED, `${t.id} draws nothing and is not an action`);
    assert.ok(t.label.length > 0 && t.icon.length > 0, `${t.id} has no label or icon`);
  }
});

// ───────────────────────────── Fibonacci ─────────────────────────────

test('fib: 0% lands where the drag ENDED and 100% where it began', () => {
  // Dragging a low→high puts 0% at the high, which is the direction a retracement is read in.
  const lines = fibLines(at(0, 100), at(10, 200));
  near(lines.find((l) => l.ratio === 0)!.price, 200, 1e-9, '0%');
  near(lines.find((l) => l.ratio === 1)!.price, 100, 1e-9, '100%');
});

test('fib: the midpoint really is the midpoint, and every ratio is proportional', () => {
  const lines = fibLines(at(0, 0), at(1, 100));
  near(lines.find((l) => l.ratio === 0.5)!.price, 50);
  near(lines.find((l) => l.ratio === 0.618)!.price, 38.2, 1e-9);
  near(lines.find((l) => l.ratio === 0.236)!.price, 76.4, 1e-9);
});

test('fib: works downward too — the tool does not assume which way you dragged', () => {
  const lines = fibLines(at(0, 200), at(10, 100));
  near(lines.find((l) => l.ratio === 0)!.price, 100);
  near(lines.find((l) => l.ratio === 1)!.price, 200);
  near(lines.find((l) => l.ratio === 0.5)!.price, 150);
});

test('fib: the published ratio set, labelled as MetaTrader labels them', () => {
  assert.deepEqual([...FIB_LEVELS], [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]);
  const labels = fibLines(at(0, 0), at(1, 1)).map((l) => l.label);
  assert.deepEqual(labels, ['0%', '23.6%', '38.2%', '50%', '61.8%', '78.6%', '100%']);
});

// ───────────────────────────── pitchfork ─────────────────────────────

test('pitchfork: the handle runs to the MIDPOINT of the second and third pivots', () => {
  const { median } = pitchforkLines(at(0, 0), at(10, 10), at(10, 20));
  // Midpoint of (10,10) and (10,20) is (10,15); the handle starts at the first pivot.
  assert.deepEqual(median.from, at(0, 0));
  near(median.to.time, 30, 1e-9);   // extended 3× by default
  near(median.to.price, 45, 1e-9);
});

test('pitchfork: the tines are PARALLEL to the handle — the defining property', () => {
  const { median, upper, lower } = pitchforkLines(at(100, 5), at(200, 9), at(240, 3));
  const slope = (l: { from: Anchor; to: Anchor }) => (l.to.price - l.from.price) / (l.to.time - l.from.time);
  near(slope(upper), slope(median), 1e-9, 'upper tine');
  near(slope(lower), slope(median), 1e-9, 'lower tine');
});

test('pitchfork: each tine starts on its own pivot, and all three extend forward', () => {
  const a = at(0, 0), b = at(10, 10), c = at(10, 20);
  const { median, upper, lower } = pitchforkLines(a, b, c);
  assert.deepEqual(upper.from, b);
  assert.deepEqual(lower.from, c);
  for (const [name, l] of [['median', median], ['upper', upper], ['lower', lower]] as const) {
    assert.ok(l.to.time > c.time, `${name} stops at or before the last pivot, so it forecasts nothing`);
  }
});

// ───────────────────────────── measure ─────────────────────────────

test('measure: reports the move, the percentage, and the time — signed by direction', () => {
  const m = measure(at(1000, 200), at(1600, 250));
  near(m.delta, 50);
  near(m.percent, 25);
  assert.equal(m.seconds, 600);
  assert.equal(m.up, true);

  const down = measure(at(1000, 200), at(1600, 150));
  near(down.delta, -50);
  near(down.percent, -25);
  assert.equal(down.up, false);
  assert.equal(down.seconds, 600, 'duration is a magnitude, never negative');
});

test('measure: counts bars when the timeframe is known, and declines to guess when it is not', () => {
  assert.equal(measure(at(0, 1), at(600, 1), 60).bars, 10);
  assert.equal(measure(at(0, 1), at(600, 1)).bars, null);
  assert.equal(measure(at(0, 1), at(600, 1), 0).bars, null, 'a zero timeframe is not a timeframe');
});

test('measure: a zero start price reports 0% rather than Infinity', () => {
  assert.equal(measure(at(0, 0), at(60, 5)).percent, 0);
});

test('humanDuration: the unit a trader would say out loud', () => {
  assert.equal(humanDuration(45), '45s');
  assert.equal(humanDuration(600), '10m');
  assert.equal(humanDuration(7200), '2h');
  assert.equal(humanDuration(5400), '1.5h');
  assert.equal(humanDuration(172_800), '2d');
});

// ───────────────────────────── selection ─────────────────────────────

test('distanceToSegment: perpendicular when alongside, to the nearer END when past it', () => {
  const a = { x: 0, y: 0 }, b = { x: 10, y: 0 };
  near(distanceToSegment({ x: 5, y: 3 }, a, b), 3, 1e-9, 'alongside');
  near(distanceToSegment({ x: -4, y: 0 }, a, b), 4, 1e-9, 'before the start');
  near(distanceToSegment({ x: 14, y: 0 }, a, b), 4, 1e-9, 'past the end');
  // A degenerate segment is a point, not a division by zero.
  near(distanceToSegment({ x: 3, y: 4 }, a, a), 5, 1e-9, 'zero-length');
});

test('hitTest: picks the NEAREST drawing within tolerance, and nothing outside it', () => {
  const segs = [
    { id: 'far', a: { x: 0, y: 50 }, b: { x: 100, y: 50 } },
    { id: 'near', a: { x: 0, y: 10 }, b: { x: 100, y: 10 } },
  ];
  assert.equal(hitTest({ x: 50, y: 12 }, segs), 'near');
  assert.equal(hitTest({ x: 50, y: 45 }, segs), 'far');
  assert.equal(hitTest({ x: 50, y: 30 }, segs), null, 'a tap in open space selects nothing');
  // Tolerance is in PIXELS, so a tap is forgiving enough for a finger.
  assert.equal(hitTest({ x: 50, y: 17 }, segs, 8), 'near');
  assert.equal(hitTest({ x: 50, y: 17 }, segs, 2), null);
});

// ───────────────────────────── persistence ─────────────────────────────

const drawing = (over: Partial<Drawing> = {}): Drawing =>
  ({ id: 'd1', kind: 'trend', points: [at(1, 2), at(3, 4)], color: '#fff', ...over });

test('drawings survive a reload, per symbol', () => {
  assert.notEqual(storageKey('XAUUSD'), storageKey('EURUSD'));
  const round = parseDrawings(serializeDrawings([drawing()]));
  assert.deepEqual(round, [drawing()]);
});

test('a corrupt or hostile stored value yields no drawings, never a crash', () => {
  for (const raw of [null, '', 'not json', '{}', '[1,2,3]', '["x"]', 'null']) {
    assert.deepEqual(parseDrawings(raw), [], JSON.stringify(raw));
  }
});

test('a drawing missing its geometry is discarded, not half-rendered', () => {
  const bad = JSON.stringify([
    { id: 'a', kind: 'trend', color: '#fff' },                              // no points
    { id: 'b', kind: 'trend', points: [], color: '#fff' },                  // empty points
    { id: 'c', kind: 'nope', points: [at(1, 2)], color: '#fff' },           // unknown tool
    { id: 'd', kind: 'trend', points: [{ time: 1 }], color: '#fff' },       // no price
    { id: 'e', kind: 'trend', points: [{ time: NaN, price: 1 }], color: '#fff' },
    drawing({ id: 'good' }),
  ]);
  assert.deepEqual(parseDrawings(bad).map((d) => d.id), ['good']);
});

test('storage is capped, so a long session cannot grow the key without bound', () => {
  const many = Array.from({ length: 500 }, (_, i) => drawing({ id: `d${i}` }));
  const kept = parseDrawings(serializeDrawings(many));
  assert.equal(kept.length, 200);
  // The cap keeps the NEWEST, because the ones just drawn are the ones in use.
  assert.equal(kept.at(-1)!.id, 'd499');
});
