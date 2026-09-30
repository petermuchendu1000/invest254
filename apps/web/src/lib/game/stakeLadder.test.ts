import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMultipleOf5, pillLabel, resolveStakeUnits, stakeLadder } from './stakeLadder.js';

test('owner example: $5 → 5, 10, 20, 25, 50, 100', () => {
  assert.deepEqual(stakeLadder(5, null), [5, 10, 20, 25, 50, 100]);
});

test('follows the minimum; every pill a multiple of 5', () => {
  assert.deepEqual(stakeLadder(250, 50_000), [250, 500, 1000, 1250, 2500, 5000]);
  assert.deepEqual(stakeLadder(15, null), [15, 30, 60, 75, 150, 300]);
  for (const m of [5, 10, 15, 20, 35, 250, 1000]) assert.ok(stakeLadder(m, null).every(isMultipleOf5));
});

test('capped by the maximum', () => {
  assert.deepEqual(stakeLadder(5, 30), [5, 10, 20, 25]);
  assert.deepEqual(stakeLadder(5, 5), [5]);
});

test('native admin values win when the enforced cents agree', () => {
  // $5 set; enforced cents carry a 10% FX margin, so they read $4.50 / $1,100 at today's rate
  assert.deepEqual(resolveStakeUnits({ nativeMin: 5, nativeMax: 1000, minDisplay: 4.5, maxDisplay: 1100, floor: 5 }), { min: 5, max: 1000, ladder: [5, 10, 20, 25, 50, 100] });
});

test('never below what the server enforces (stale rate / global override), rounded to a whole unit', () => {
  assert.equal(resolveStakeUnits({ nativeMin: 5, minDisplay: 7.75, floor: 5 }).min, 8);  // whole unit, not 10
  assert.equal(resolveStakeUnits({ minDisplay: 250 }).min, 250);           // KES brand, no native value
  assert.equal(resolveStakeUnits({ minDisplay: 1.94, floor: 5 }).min, 5);   // USD brand on KES 250
});

test('max never above the enforced max, never below min; any positive native value applies', () => {
  assert.equal(resolveStakeUnits({ nativeMax: 5000, minDisplay: 5, maxDisplay: 387.4 }).max, 387); // whole unit, not 385
  assert.equal(resolveStakeUnits({ nativeMin: 50, nativeMax: 20, minDisplay: 5 }).max, 50);
  assert.equal(resolveStakeUnits({ nativeMin: 7, minDisplay: 5 }).min, 7);  // non-multiple-of-5 native now honoured
});

test('sub-$5 minimums: a $1 floor yields a 1·2·4·5·10·20 ladder', () => {
  assert.deepEqual(stakeLadder(1, null), [1, 2, 4, 5, 10, 20]);
  assert.equal(resolveStakeUnits({ nativeMin: 1, minDisplay: 0.9, floor: 1 }).min, 1);
  assert.deepEqual(resolveStakeUnits({ nativeMin: 1, minDisplay: 0.9, floor: 1 }).ladder, [1, 2, 4, 5, 10, 20]);
});

test('labels', () => {
  assert.deepEqual([5, 250, 1000, 1250, 2500, 10_000].map(pillLabel), ['5', '250', '1k', '1.25k', '2.5k', '10k']);
});
