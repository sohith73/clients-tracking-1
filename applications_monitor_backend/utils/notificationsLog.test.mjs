// Run with the rest of the suite: npm test (node --test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDeliveryQuery, buildBaseMatch, withStatus, toCounts, istDayStart, istTodayRange,
  escapeRegex, computeCoverage, MAX_PAGE_SIZE, MAX_SEARCH_LENGTH,
} from './notificationsLog.js';

test('defaults', () => {
  const q = parseDeliveryQuery({});
  assert.equal(q.page, 1);
  assert.equal(q.pageSize, 25);
  assert.equal(q.status, 'all');
  assert.deepEqual(q.filters, { itemKey: '', trigger: '', channel: '', search: '' });
});

test('page and pageSize validation and cap', () => {
  assert.match(parseDeliveryQuery({ page: '0' }).error, /page/);
  assert.match(parseDeliveryQuery({ page: '-1' }).error, /page/);
  assert.match(parseDeliveryQuery({ page: 'abc' }).error, /page/);
  assert.match(parseDeliveryQuery({ pageSize: '0' }).error, /pageSize/);
  assert.equal(parseDeliveryQuery({ pageSize: '5000' }).pageSize, MAX_PAGE_SIZE);
  assert.equal(parseDeliveryQuery({ page: '3', pageSize: '10' }).page, 3);
});

test('enum params reject unknown values', () => {
  for (const [k, v] of [['status', 'bogus'], ['itemKey', 'x'], ['trigger', 'y'], ['channel', 'sms_failed']]) {
    assert.match(parseDeliveryQuery({ [k]: v }).error, new RegExp(k));
  }
  assert.equal(parseDeliveryQuery({ status: 'delivered' }).status, 'delivered');
  assert.equal(parseDeliveryQuery({ trigger: 'auto-threshold' }).filters.trigger, 'auto-threshold');
});

test('IST day boundaries', () => {
  assert.equal(istDayStart('2026-03-10').toISOString(), '2026-03-09T18:30:00.000Z');
  assert.equal(istDayStart('2026-01-01').toISOString(), '2025-12-31T18:30:00.000Z');
  assert.equal(istDayStart('2024-02-29').toISOString(), '2024-02-28T18:30:00.000Z');
});

test('impossible or malformed dates are rejected', () => {
  for (const bad of ['2026-02-31', '2026-13-01', '2026-00-10', '2025-02-29', '26-01-01', 'yesterday', '2026-1-1']) {
    assert.equal(istDayStart(bad), null, bad);
    assert.match(parseDeliveryQuery({ from: bad }).error, /from/);
    assert.match(parseDeliveryQuery({ to: bad }).error, /to/);
  }
  assert.match(parseDeliveryQuery({ from: '2026-03-10', to: '2026-03-09' }).error, /after/);
});

test('date range is inclusive of the whole "to" day in IST', () => {
  const m = buildBaseMatch(parseDeliveryQuery({ from: '2026-03-10', to: '2026-03-10' }).filters);
  assert.equal(m.at.$gte.toISOString(), '2026-03-09T18:30:00.000Z');
  assert.equal(m.at.$lt.toISOString(), '2026-03-10T18:30:00.000Z');
});

test('today range follows the IST day, not UTC', () => {
  // 20:00 UTC on Mar 9 is 01:30 IST on Mar 10.
  const r = istTodayRange(new Date('2026-03-09T20:00:00Z'));
  assert.equal(r.start.toISOString(), '2026-03-09T18:30:00.000Z');
  assert.equal(r.end.toISOString(), '2026-03-10T18:30:00.000Z');
});

test('search is escaped, trimmed and capped', () => {
  assert.equal(escapeRegex('a.b*c(d)'), 'a\\.b\\*c\\(d\\)');
  const m = buildBaseMatch(parseDeliveryQuery({ search: '  a.b+  ' }).filters);
  const rx = m.$or[0].clientEmail;
  assert.ok(rx.test('A.B+@x.com'));
  assert.ok(!rx.test('axb@x.com'), 'dot must be literal');
  assert.doesNotThrow(() => buildBaseMatch(parseDeliveryQuery({ search: '(((' }).filters));
  assert.equal(parseDeliveryQuery({ search: 'x'.repeat(500) }).filters.search.length, MAX_SEARCH_LENGTH);
});

test('channel filters', () => {
  const e = buildBaseMatch({ channel: 'email_failed' });
  assert.equal(e['email.attempted'], true);
  assert.deepEqual(e['email.ok'], { $ne: true });
  const m = buildBaseMatch({ channel: 'mattermost_failed' });
  assert.equal(m['mattermost.attempted'], true);
});

test('status chips', () => {
  assert.deepEqual(withStatus({ a: 1 }, 'all'), { a: 1 });
  assert.deepEqual(withStatus({}, 'delivered'), { status: { $in: ['sent', 'partial'] } });
  assert.deepEqual(withStatus({}, 'failed'), { status: 'failed' });
});

test('toCounts always returns the fixed shape', () => {
  assert.deepEqual(toCounts([]), { sent: 0, partial: 0, failed: 0, skipped: 0 });
  assert.deepEqual(toCounts([{ _id: 'sent', n: 4 }, { _id: 'weird', n: 9 }, { _id: 'failed', n: 1 }]),
    { sent: 4, partial: 0, failed: 1, skipped: 0 });
});

test('coverage: covered, switched off, no config, case-insensitive', () => {
  const clients = [
    { email: 'A@x.com', name: 'A', clientNumber: 1 },
    { email: 'b@x.com', name: 'B', clientNumber: 2 },
    { email: 'c@x.com', name: 'C' },
    { email: 'd@x.com', name: 'D' },
    { email: 'e@x.com', name: 'E' },
    { email: 'a@x.com', name: 'A dup' },
  ];
  const on = (ch) => [{ key: 'daily_summary', enabled: true, channels: ch }];
  const configs = [
    { clientEmail: 'a@x.com', items: on({ email: true, mattermost: false }) },
    { clientEmail: 'B@X.com', items: [{ key: 'daily_summary', enabled: false, channels: { email: true } }] },
    { clientEmail: 'c@x.com', items: on({ email: false, mattermost: false }) },
    { clientEmail: 'd@x.com', items: [{ key: 'inactivity_alert', enabled: true, channels: { email: true } }] },
  ];
  const cov = computeCoverage(clients, configs);
  assert.equal(cov.activeClients, 5);
  assert.equal(cov.covered, 1);
  const reasons = Object.fromEntries(cov.notCovered.map((n) => [n.email, n.reason]));
  assert.deepEqual(reasons, { 'b@x.com': 'switched_off', 'c@x.com': 'switched_off', 'd@x.com': 'no_config', 'e@x.com': 'no_config' });
  assert.equal(cov.notCovered.find((n) => n.email === 'c@x.com').clientNumber, null);
});

test('a client who used the unsubscribe link is reported as unsubscribed, not as missing settings', () => {
  const clients = [{ email: 'gone@x.com', name: 'Gone' }, { email: 'off@x.com', name: 'Off' }];
  const configs = [
    // The unsubscribe link writes an empty items array for a client with no config...
    { clientEmail: 'gone@x.com', items: [], updatedBy: 'unsubscribe-link' },
    // ...and switches every item off for one that had a config.
    { clientEmail: 'off@x.com', updatedBy: 'unsubscribe-link',
      items: [{ key: 'daily_summary', enabled: false, channels: { email: true } }] },
  ];
  const reasons = Object.fromEntries(computeCoverage(clients, configs).notCovered.map((n) => [n.email, n.reason]));
  assert.deepEqual(reasons, { 'gone@x.com': 'unsubscribed', 'off@x.com': 'unsubscribed' });
});
