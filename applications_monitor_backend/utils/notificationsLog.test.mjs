// Run with the rest of the suite: npm test (node --test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDeliveryQuery, buildHistoryAggregation, buildRowMatch, computeScheduled, filterScheduled,
  toCounts, istDayStart, istTodayRange, rangeOf, escapeRegex, computeCoverage,
  reminderPipeline, onboardingPipeline, inboxAlertPipeline, milestonePipeline,
  MAX_PAGE_SIZE, MAX_SEARCH_LENGTH,
} from './notificationsLog.js';

const ist = (s) => new Date(`${s}+05:30`);

test('defaults: every kind, every status, every date, page 1 of 25', () => {
  const q = parseDeliveryQuery({});
  assert.equal(q.page, 1);
  assert.equal(q.pageSize, 25);
  assert.equal(q.status, 'all');
  assert.deepEqual(q.filters, { kind: '', trigger: '', search: '' });
});

test('paging is clamped and validated', () => {
  assert.equal(parseDeliveryQuery({ pageSize: '5000' }).pageSize, MAX_PAGE_SIZE);
  assert.match(parseDeliveryQuery({ page: '0' }).error, /page/);
  assert.match(parseDeliveryQuery({ page: 'abc' }).error, /page/);
  assert.match(parseDeliveryQuery({ pageSize: '-1' }).error, /pageSize/);
  assert.equal(parseDeliveryQuery({ page: ['3', '9'] }).page, 3, 'repeated params take the first');
});

test('enum filters reject unknown values, including the retired Mattermost ones', () => {
  assert.match(parseDeliveryQuery({ status: 'partial' }).error, /status/);
  assert.match(parseDeliveryQuery({ status: 'delivered' }).error, /status/);
  assert.match(parseDeliveryQuery({ kind: 'weekly_report' }).error, /kind/);
  assert.match(parseDeliveryQuery({ trigger: 'cron' }).error, /trigger/);
  assert.equal(parseDeliveryQuery({ status: 'scheduled' }).status, 'scheduled');
  assert.equal(parseDeliveryQuery({ kind: 'onboarding' }).filters.kind, 'onboarding');
  assert.equal(parseDeliveryQuery({ trigger: 'manual' }).filters.trigger, 'manual');
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
  const r = rangeOf(parseDeliveryQuery({ from: '2026-03-10', to: '2026-03-10' }).filters);
  assert.equal(r.start.toISOString(), '2026-03-09T18:30:00.000Z');
  assert.equal(r.end.toISOString(), '2026-03-10T18:30:00.000Z');
  assert.deepEqual(rangeOf({}), { start: null, end: null });
});

test('today range follows the IST day, not UTC', () => {
  // 20:00 UTC on Mar 9 is 01:30 IST on Mar 10.
  const r = istTodayRange(new Date('2026-03-09T20:00:00Z'));
  assert.equal(r.start.toISOString(), '2026-03-09T18:30:00.000Z');
  assert.equal(r.end.toISOString(), '2026-03-10T18:30:00.000Z');
});

test('search is escaped, trimmed, capped, and also matches clients found by name', () => {
  assert.equal(escapeRegex('a.b*c(d)'), 'a\\.b\\*c\\(d\\)');
  const m = buildRowMatch(parseDeliveryQuery({ search: '  a.b+  ' }).filters, ['named@x.com']);
  const rx = m.$or[0].clientEmail;
  assert.ok(rx.test('A.B+@x.com'));
  assert.ok(!rx.test('axb@x.com'), 'dot must be literal');
  assert.deepEqual(m.$or[3], { clientEmail: { $in: ['named@x.com'] } });
  assert.doesNotThrow(() => buildRowMatch(parseDeliveryQuery({ search: '(((' }).filters));
  assert.equal(parseDeliveryQuery({ search: 'x'.repeat(500) }).filters.search.length, MAX_SEARCH_LENGTH);
});

test('the merged query unions every source, and a kind filter keeps only its source', () => {
  const all = buildHistoryAggregation({ filters: {} });
  assert.equal(all.coll, 'reminderdeliveries');
  assert.deepEqual(
    all.pipeline.filter((s) => s.$unionWith).map((s) => s.$unionWith.coll),
    ['clientemaillogs', 'onboardingmailstates', 'maildigests'],
  );
  const onb = buildHistoryAggregation({ filters: { kind: 'onboarding' } });
  assert.equal(onb.coll, 'onboardingmailstates');
  assert.equal(onb.pipeline.some((s) => s.$unionWith), false);
  const facet = onb.pipeline.at(-1).$facet;
  assert.deepEqual(facet.rows.at(-1), { $limit: 25 });
});

test('status narrows rows and total but never the per-status counts', () => {
  const { pipeline } = buildHistoryAggregation({ filters: {}, status: 'failed', page: 3, pageSize: 10 });
  const facet = pipeline.at(-1).$facet;
  assert.deepEqual(facet.rows[0], { $match: { status: 'failed' } });
  assert.deepEqual(facet.rows.find((s) => s.$skip), { $skip: 20 });
  assert.deepEqual(facet.total[0], { $match: { status: 'failed' } });
  assert.equal(facet.counts.some((s) => s.$match), false);
});

test('every source is date-bounded on the field that dates its row', () => {
  const range = rangeOf({ from: '2026-11-14', to: '2026-11-14' });
  assert.ok(reminderPipeline(range)[0].$match.at.$gte);
  assert.ok(milestonePipeline(range)[0].$match.createdAt.$lt);
  const onb = onboardingPipeline(range).find((s) => s.$match?.$or).$match.$or;
  assert.ok(onb[0]['steps.sentAt'].$gte, 'a sent step by when it was sent');
  assert.ok(onb[1]['steps.sendAt'].$gte, 'a failed step by when it was due');
  const inbox = inboxAlertPipeline(range)[0].$match;
  assert.equal(inbox.clientNotifyEligible, true);
  assert.ok(inbox.$or[0].clientNotifiedAt.$gte);
  assert.ok(inbox.$or[1].updatedAt.$gte);
});

test('legacy partial reminder rows fold into sent or failed by their email', () => {
  const status = reminderPipeline({})[1].$project.status;
  assert.deepEqual(status.$cond[1], { $cond: [{ $eq: ['$email.ok', true] }, 'sent', 'failed'] });
});

test('milestone test sends to staff are not client notifications', () => {
  assert.deepEqual(milestonePipeline({})[0].$match.type, { $not: /^test_/ });
});

test('toCounts always returns the fixed shape', () => {
  assert.deepEqual(toCounts([]), { sent: 0, failed: 0, skipped: 0, scheduled: 0 });
  assert.deepEqual(toCounts([{ _id: 'sent', n: 4 }, { _id: 'weird', n: 9 }, { _id: 'failed', n: 1 }], 7),
    { sent: 4, failed: 1, skipped: 0, scheduled: 7 });
});

// ---- scheduled ------------------------------------------------------------------

const active = [
  { email: 'New@x.com', name: 'New', paymentEmail: 'pay-new@x.com' },
  { email: 'done@x.com', name: 'Done', paymentEmail: 'pay-done@x.com' },
  { email: 'off@x.com', name: 'Off', paymentEmail: 'pay-off@x.com' },
  { email: 'gone@x.com', name: 'Gone', paymentEmail: 'pay-gone@x.com' },
  { email: 'mm@x.com', name: 'Legacy', paymentEmail: '' },
];
const configs = [
  { clientEmail: 'done@x.com', items: [{ key: 'daily_summary', enabled: true, channels: { email: true }, sendAtIST: '20:00', lastPeriodKey: 'daily_summary:2026-11-14' }] },
  { clientEmail: 'off@x.com', items: [{ key: 'daily_summary', enabled: false, channels: { email: true } }] },
  { clientEmail: 'gone@x.com', items: [], updatedBy: 'unsubscribe-link' },
  { clientEmail: 'mm@x.com', items: [{ key: 'daily_summary', enabled: true, channels: { mattermost: true, email: false }, sendAtIST: '21:30' }] },
];

test('scheduled: every active client gets the daily summary unless switched off or unsubscribed', () => {
  const now = ist('2026-11-14T12:00:00');
  const rows = computeScheduled({ clients: active, configs, now });
  const by = Object.fromEntries(rows.map((r) => [r.clientEmail, r]));
  assert.deepEqual(Object.keys(by).sort(), ['done@x.com', 'mm@x.com', 'new@x.com']);
  // No config yet: the worker seeds the defaults, so 21:30 IST today.
  assert.equal(by['new@x.com'].at.toISOString(), ist('2026-11-14T21:30:00').toISOString());
  assert.equal(by['new@x.com'].to, 'pay-new@x.com');
  assert.equal(by['new@x.com'].reason, 'only_if_roles_added');
  // Today already decided: tomorrow at the client's own time.
  assert.equal(by['done@x.com'].at.toISOString(), ist('2026-11-15T20:00:00').toISOString());
  // A Mattermost-only row now goes by email, but there is no address to send to.
  assert.equal(by['mm@x.com'].reason, 'no_payment_email');
  assert.ok(rows.every((r) => r.status === 'scheduled' && r.trigger === 'auto'));
});

test('scheduled: onboarding steps waiting for their time, not sent or given up on', () => {
  const now = ist('2026-11-14T12:00:00');
  const onboarding = [{
    clientEmail: 'o@x.com', clientName: 'O', paymentEmail: 'pay-o@x.com', status: 'scheduled',
    steps: [
      { key: 'base_resume', sendAt: ist('2026-11-14T10:00:00'), sentAt: ist('2026-11-14T10:00:05') },
      { key: 'cover_letter', sendAt: ist('2026-11-14T11:30:00'), attempts: 1, error: 'smtp 421' },
      { key: 'linkedin', sendAt: ist('2026-11-14T13:00:00') },
    ],
  }, { clientEmail: 'dead@x.com', status: 'scheduled', steps: [{ key: 'linkedin', sendAt: now, attempts: 4 }] },
  { clientEmail: 'skip@x.com', status: 'skipped', steps: [{ key: 'linkedin', sendAt: now }] }];
  const rows = computeScheduled({ onboarding, now });
  assert.deepEqual(rows.map((r) => r.item), ['cover_letter', 'linkedin']);
  assert.equal(rows[0].dueNow, true);
  assert.equal(rows[0].reason, 'retrying: smtp 421');
  assert.equal(rows[1].dueNow, false);
});

test('scheduled rows honour the date, kind, trigger and search filters', () => {
  const now = ist('2026-11-14T12:00:00');
  const rows = computeScheduled({ clients: active, configs, now });
  assert.equal(filterScheduled(rows, { from: '2026-11-14', to: '2026-11-14' }).length, 2, 'tomorrow is out');
  assert.equal(filterScheduled(rows, { kind: 'onboarding' }).length, 0);
  assert.equal(filterScheduled(rows, { trigger: 'manual' }).length, 0);
  assert.deepEqual(filterScheduled(rows, { search: 'legacy' }).map((r) => r.clientEmail), ['mm@x.com']);
  assert.deepEqual(filterScheduled(rows, { search: 'zzz' }, ['done@x.com']).map((r) => r.clientEmail), ['done@x.com']);
});

// ---- coverage --------------------------------------------------------------------

test('coverage: on with an address is covered; the rest say why', () => {
  const clients = [
    { email: 'A@x.com', name: 'A', clientNumber: 1, paymentEmail: 'pa@x.com' },
    { email: 'b@x.com', name: 'B', clientNumber: 2, paymentEmail: 'pb@x.com' },
    { email: 'c@x.com', name: 'C', paymentEmail: 'pc@x.com' },
    { email: 'd@x.com', name: 'D', paymentEmail: '' },
    { email: 'e@x.com', name: 'E', paymentEmail: 'pe@x.com' },
    { email: 'f@x.com', name: 'F', paymentEmail: '' },
    { email: 'a@x.com', name: 'A dup' },
  ];
  const on = (ch) => [{ key: 'daily_summary', enabled: true, channels: ch }];
  const configs = [
    { clientEmail: 'a@x.com', items: on({ email: true }) },
    { clientEmail: 'B@X.com', items: [{ key: 'daily_summary', enabled: false, channels: { email: true } }] },
    { clientEmail: 'c@x.com', items: on({ email: false, mattermost: true }) },
    { clientEmail: 'd@x.com', items: on({ email: true }) },
    { clientEmail: 'f@x.com', items: on({ email: true }), paymentEmailOverride: 'override@x.com' },
  ];
  const cov = computeCoverage(clients, configs);
  assert.equal(cov.activeClients, 6);
  // a (on), c (legacy Mattermost-only now means email), e (no config yet: the
  // worker seeds it), f (override address).
  assert.equal(cov.covered, 4);
  const reasons = Object.fromEntries(cov.notCovered.map((n) => [n.email, n.reason]));
  assert.deepEqual(reasons, { 'b@x.com': 'switched_off', 'd@x.com': 'no_payment_email' });
});

test('a client who used the unsubscribe link is reported as unsubscribed', () => {
  const clients = [{ email: 'gone@x.com', name: 'Gone', paymentEmail: 'p@x.com' }, { email: 'off@x.com', name: 'Off', paymentEmail: 'q@x.com' }];
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
