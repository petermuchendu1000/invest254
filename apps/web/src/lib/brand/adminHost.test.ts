import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAdminHost, ADMIN_HOSTS } from './adminHost.js';

/**
 * Which hosts are the OPERATOR console rather than a player brand.
 *
 * Two things depend on this agreeing with itself: the middleware's `/` → `/console` redirect, and
 * the brand path's decision not to ask the API about a host that has no brand. They used to be
 * separate pieces of code, which is how the brand path came to spend a failed cross-continent round
 * trip on every single request to the admin domain.
 */

test('the admin host matches with or without www, and with a port', () => {
  assert.equal(isAdminHost('triocodes.com'), true);
  assert.equal(isAdminHost('www.triocodes.com'), true);
  assert.equal(isAdminHost('TrioCodes.COM'), true, 'Host headers are not case-normalised for us');
  assert.equal(isAdminHost('triocodes.com:3000'), true, 'a dev port must not change the answer');
});

test('a player brand is NOT an admin host — this is the half that must never be wrong', () => {
  for (const h of ['invest254.com', 'cpfmarket.com', 'mpesapap.com', '1000wins.com', 'www.invest254.com']) {
    assert.equal(isAdminHost(h), false, h);
  }
  // A lookalike must not match: only the exact host or its www form.
  assert.equal(isAdminHost('nottriocodes.com'), false);
  assert.equal(isAdminHost('triocodes.com.evil.test'), false);
  assert.equal(isAdminHost('admin.triocodes.com'), false, 'a subdomain is not configured as one');
});

test('a missing or empty Host is not an admin host', () => {
  assert.equal(isAdminHost(''), false);
  assert.equal(isAdminHost(null), false);
  assert.equal(isAdminHost(undefined), false);
});

test('the default is the literal production runs on — ADMIN_HOST is set in no deploy config', () => {
  assert.ok(ADMIN_HOSTS.includes('triocodes.com'), ADMIN_HOSTS.join(','));
});
