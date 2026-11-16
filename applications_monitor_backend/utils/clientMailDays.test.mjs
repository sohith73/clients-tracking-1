// No client mail on Sundays (IST). Run with the rest of the suite: npm test.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { isClientMailOffDay, nextClientMailInstant, sameTimeNextClientMailDay } from './clientMailDays.js';
import { sendMilestoneEmail } from './clientMilestoneEmails.js';

const ist = (s) => new Date(`${s}+05:30`);

test('Sunday is decided on the IST clock, midnight to midnight', () => {
  assert.equal(isClientMailOffDay(ist('2026-11-14T23:59:00')), false);
  assert.equal(isClientMailOffDay(ist('2026-11-15T00:00:00')), true);
  assert.equal(isClientMailOffDay(ist('2026-11-15T23:59:00')), true);
  assert.equal(isClientMailOffDay(ist('2026-11-16T00:00:00')), false);
  // Saturday 20:00 UTC is already Sunday 01:30 in India.
  assert.equal(isClientMailOffDay(new Date('2026-11-14T20:00:00Z')), true);
});

test('moving a Sunday time: to Monday midnight, or to the same time Monday', () => {
  assert.equal(nextClientMailInstant(ist('2026-11-15T10:00:00')).toISOString(), ist('2026-11-16T00:00:00').toISOString());
  assert.equal(sameTimeNextClientMailDay(ist('2026-11-15T21:30:00')).toISOString(), ist('2026-11-16T21:30:00').toISOString());
  const sat = ist('2026-11-14T22:00:00');
  assert.equal(nextClientMailInstant(sat), sat);
  assert.equal(sameTimeNextClientMailDay(sat), sat);
});

test('a milestone email is held on Sunday before anything is sent or logged; a staff test is not', async (t) => {
  mock.timers.enable({ apis: ['Date'], now: ist('2026-11-15T12:00:00') });
  t.after(() => mock.timers.reset());
  const client = { email: 'c@x.com', paymentEmail: 'p@x.com' };
  assert.deepEqual(
    await sendMilestoneEmail({ client, type: 'started', milestoneKey: 'started' }),
    { skipped: true, reason: 'sunday_hold' }
  );
  // A staff test goes past the hold; with no paymentEmail it stops at the
  // next check, before any transport or database.
  assert.deepEqual(
    await sendMilestoneEmail({ client: { email: 'c@x.com' }, type: 'started', milestoneKey: 'test_started_0' }),
    { skipped: true, reason: 'no_payment_email' }
  );
});
