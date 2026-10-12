import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connBadge, dataPhaseOf, phaseCopy, phaseIsBlocking, tradeDisabledReason, valueIsStale } from './dataPhase.js';

/**
 * Dead states. Every shell mounted its chart as a bare container and waited, so a brand whose socket
 * was still connecting showed a full-height void — indistinguishable from a broken page, on a
 * product where "broken" reads as "my money is gone". These pin the rules that replace it.
 */

test('first load: the surface says what it is doing, never nothing', () => {
  assert.equal(dataPhaseOf('connecting', false), 'connecting');
  assert.equal(dataPhaseOf('open', false), 'waiting');
  assert.equal(dataPhaseOf('closed', false), 'offline');
  // All three must render a placeholder rather than an empty box.
  for (const p of ['connecting', 'waiting', 'offline'] as const) {
    assert.equal(phaseIsBlocking(p), true, p);
    assert.ok(phaseCopy(p).title.length > 0, p);
    assert.ok(phaseCopy(p).detail.length > 0, p);
  }
});

test('once data has arrived the chart is never blanked again', () => {
  // The whole point of `hasData`: a one-second drop must not wipe a trader's chart.
  assert.equal(dataPhaseOf('open', true), 'ready');
  assert.equal(dataPhaseOf('closed', true), 'reconnecting');
  assert.equal(dataPhaseOf('connecting', true), 'reconnecting');
  assert.equal(phaseIsBlocking('reconnecting'), false);
  assert.equal(phaseIsBlocking('ready'), false);
});

test('reconnecting says it is still showing the last prices, so a stale chart is not a silent lie', () => {
  assert.match(phaseCopy('reconnecting').detail, /last prices/i);
});

test('no phase blames the user or says "error" on a money screen', () => {
  for (const p of ['connecting', 'waiting', 'reconnecting', 'offline'] as const) {
    const { title, detail } = phaseCopy(p);
    assert.ok(!/error|failed|problem|wrong/i.test(`${title} ${detail}`), `${p}: ${title} ${detail}`);
  }
  // Even offline is framed as what it is doing next.
  assert.match(phaseCopy('offline').detail, /retry/i);
});

test('the subject is substitutable, so a non-chart surface can borrow the same copy', () => {
  assert.match(phaseCopy('waiting', 'your trades').title, /Fetching your trades/);
});

test('ready renders nothing — the placeholder must get out of the way', () => {
  assert.equal(phaseCopy('ready').title, '');
  assert.equal(phaseCopy('ready').detail, '');
});

test('the badge never says LIVE unless the socket is open', () => {
  // The candlestick quote band hardcoded a pulsing "LIVE" and never read the status, so a closed
  // socket advertised live prices. This is the regression that must not come back.
  assert.equal(connBadge('open').label, 'LIVE');
  assert.notEqual(connBadge('connecting').label, 'LIVE');
  assert.notEqual(connBadge('closed').label, 'LIVE');
  for (const s of ['connecting', 'closed'] as const) {
    assert.ok(!/live/i.test(connBadge(s).label), s);
  }
});

test('a dead feed does not pulse — motion reads as "working"', () => {
  assert.equal(connBadge('open').pulse, true);
  assert.equal(connBadge('connecting').pulse, true); // it IS doing something
  assert.equal(connBadge('closed').pulse, false);
});

test('each badge state has its own tone and a spelled-out hint for the 6px dot', () => {
  const tones = (['open', 'connecting', 'closed'] as const).map((s) => connBadge(s).tone);
  assert.deepEqual(tones, ['up', 'warn', 'down']);
  for (const s of ['open', 'connecting', 'closed'] as const) {
    assert.ok(connBadge(s).hint.length > 0, s);
  }
});

test('a figure is stale whenever the socket is not open, because the tick buffer outlives the drop', () => {
  assert.equal(valueIsStale('open'), false);
  assert.equal(valueIsStale('connecting'), true);
  assert.equal(valueIsStale('closed'), true);
});

test('a disabled BUY/SELL always says WHY', () => {
  assert.equal(tradeDisabledReason('ready'), null);
  for (const p of ['connecting', 'waiting', 'reconnecting', 'offline'] as const) {
    const reason = tradeDisabledReason(p);
    assert.ok(reason && reason.length > 0, p);
  }
  assert.match(tradeDisabledReason('waiting')!, /live prices/i);
  assert.match(tradeDisabledReason('offline')!, /reconnect/i);
});
