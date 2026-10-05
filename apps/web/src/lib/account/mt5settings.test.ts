import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ABOUT_ROWS, aboutRows, kycSub, kycTone } from './mt5settings.js';

test('About: a player sees every row', () => {
  assert.deepEqual(aboutRows(false).map((r) => r.id), ABOUT_ROWS.map((r) => r.id));
});

test('About: a marketer screen drops every gambling row, and keeps the rest', () => {
  const ids = aboutRows(true).map((r) => r.id);
  assert.deepEqual(ids, ['terms', 'privacy']);
  // Stated as the property rather than the list, so a row added later is covered too.
  assert.ok(aboutRows(true).every((r) => !r.gambling));
  assert.ok(ABOUT_ROWS.filter((r) => !r.gambling).every((r) => ids.includes(r.id)));
});

test('About: every row points somewhere and says what it is', () => {
  for (const r of ABOUT_ROWS) {
    assert.ok(r.href.startsWith('/'), `${r.id} href`);
    assert.ok(r.label.length > 0 && r.sub.length > 0, `${r.id} text`);
  }
});

test('Identity: each KYC status reads as a state, never as a raw code', () => {
  assert.equal(kycSub('approved'), 'Verified');
  assert.equal(kycSub('pending'), 'In review');
  assert.equal(kycSub('rejected'), 'Not approved: try again');
  assert.equal(kycSub('none'), 'Not verified');
  assert.equal(kycSub(null), 'Not verified');
  assert.equal(kycSub(undefined), 'Not verified');
});

test('Identity: only approved is green and only rejected is red', () => {
  assert.equal(kycTone('approved'), 'ok');
  assert.equal(kycTone('rejected'), 'bad');
  for (const s of ['pending', 'none', null, undefined]) assert.equal(kycTone(s), 'neutral', String(s));
});
