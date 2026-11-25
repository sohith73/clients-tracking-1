// node --test discordBot/paidNotice.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { notifyPaid, remindPaid } from './paidNotice.js';
import { loadOnboardingConfig } from './config.js';

const NOW = new Date('2026-11-25T03:00:00Z'); // 08:30 IST, IST day 2026-11-25
const IDS = ['111111111111111111', '222222222222222222'];

const cfg = (extra = {}) => ({ ...loadOnboardingConfig({ DISCORD_GUILD_ID: 'g1', DISCORD_PRANJAL_USER_IDS: IDS.join(',') }), ...extra });

function makeDeps({ dashboards = [], channels = [], postFails = false, missing = [] } = {}) {
  const rows = new Map();
  const calls = { createChannel: [], post: [], grant: [], category: [] };
  const deps = {
    discord: {
      listGuildChannels: async () => [...channels],
      createCategory: async (g, { name }) => { calls.category.push(name); return { id: `cat${calls.category.length}` }; },
      createTextChannel: async (g, body) => { calls.createChannel.push(body); return { id: `ch${calls.createChannel.length}` }; },
      getChannel: async (id) => { if (missing.includes(id)) throw Object.assign(new Error('Unknown Channel'), { status: 404 }); return { id }; },
      grantChannelAccess: async (id, ids) => { calls.grant.push({ id, ids }); },
      postMessage: async (id, body) => { if (postFails) throw new Error('discord down'); calls.post.push({ id, body }); return { id: `m${calls.post.length}` }; },
    },
    dashboardExists: async (e) => dashboards.includes(e),
    claim: async (r) => {
      const prev = rows.get(r.email);
      if (prev && prev.status !== 'failed') return false;
      rows.set(r.email, { ...r, status: 'claimed' });
      return true;
    },
    markPosted: async ({ email, channelId, messageId, day }) => Object.assign(rows.get(email), { status: 'posted', channelId, messageId, lastRemindedDay: day }),
    markFailed: async ({ email, error }) => Object.assign(rows.get(email), { status: 'failed', error }),
    markDone: async (email) => Object.assign(rows.get(email), { status: 'done' }),
    setChannel: async ({ email, channelId }) => Object.assign(rows.get(email), { channelId }),
    listPending: async () => [...rows.values()].filter((r) => r.status === 'posted').map((r) => ({ ...r })),
    claimReminder: async ({ email, day }) => { const r = rows.get(email); if (r.status !== 'posted' || r.lastRemindedDay === day) return false; r.lastRemindedDay = day; return true; },
    releaseReminder: async ({ email, day }) => { const r = rows.get(email); if (r.lastRemindedDay === day) r.lastRemindedDay = ''; },
  };
  return { deps, calls, rows };
}

const INPUT = { email: ' Shrinkhla@Example.com ', name: 'shrinkhala Singh', plan: 'PROFESSIONAL', amount: 420, currency: 'AUD', country: 'Australia', source: 'crm-paid' };

test('a paid client with no dashboard gets a private channel and one message tagging the dashboard people', async () => {
  const { deps, calls, rows } = makeDeps();
  const r = await notifyPaid({ deps, config: cfg(), input: INPUT, now: NOW });
  assert.equal(r.status, 'notified');
  assert.equal(calls.createChannel.length, 1);
  assert.match(calls.createChannel[0].name, /^shrinkhala-professional-australia-[a-f0-9]{4}$/);
  const ow = calls.createChannel[0].permissionOverwrites;
  assert.equal(ow[0].id, 'g1'); // @everyone denied
  assert.deepEqual(ow.slice(1).map((o) => o.id).sort(), IDS);
  const { body } = calls.post[0];
  assert.match(body.content, /Payment received\. Please create the dashboard for \*\*shrinkhala Singh\*\* \(shrinkhla@example\.com\)/);
  assert.match(body.content, /Plan: PROFESSIONAL\. Paid: AUD 420\. Country: Australia\. Source: CRM, lead marked paid/);
  assert.ok(IDS.every((id) => body.content.includes(`<@${id}>`)));
  assert.deepEqual(body.allowedUserIds, IDS);
  assert.deepEqual(body.components, []);
  assert.equal(rows.get('shrinkhla@example.com').status, 'posted');
  assert.equal(rows.get('shrinkhla@example.com').lastRemindedDay, '2026-11-25');
});

test('nothing is created for the client and a repeat or a second source never posts twice', async () => {
  const { deps, calls } = makeDeps();
  assert.equal((await notifyPaid({ deps, config: cfg(), input: INPUT, now: NOW })).status, 'notified');
  const again = await notifyPaid({ deps, config: cfg(), input: { ...INPUT, source: 'stripe' }, now: NOW });
  assert.deepEqual([again.status, again.reason], ['exists', 'already notified']);
  assert.equal(calls.post.length, 1);
  assert.equal(calls.createChannel.length, 1);
  assert.equal(Object.keys(deps).some((k) => /create(User|Client|Dashboard)/i.test(k)), false);
});

test('a client that already has a dashboard is not announced', async () => {
  const { deps, calls } = makeDeps({ dashboards: ['shrinkhla@example.com'] });
  const r = await notifyPaid({ deps, config: cfg(), input: INPUT, now: NOW });
  assert.deepEqual([r.status, r.reason], ['exists', 'dashboard']);
  assert.equal(calls.post.length + calls.createChannel.length, 0);
});

test('bad input is invalid, and brakes or missing setup are retryable failures that post nothing', async () => {
  const { deps, calls } = makeDeps();
  assert.equal((await notifyPaid({ deps, config: cfg(), input: { ...INPUT, email: 'nope' }, now: NOW })).status, 'invalid');
  assert.equal((await notifyPaid({ deps, config: cfg(), input: { ...INPUT, name: ' ' }, now: NOW })).status, 'invalid');
  for (const c of [cfg({ enabled: false }), cfg({ dryRun: true }), cfg({ linkedinCoverLetterUserIds: [] })]) {
    assert.equal((await notifyPaid({ deps, config: c, input: INPUT, now: NOW })).status, 'failed');
  }
  assert.equal(calls.post.length + calls.createChannel.length, 0);
});

test('a Discord failure is reported as failed, and the next try posts it', async () => {
  const bad = makeDeps({ postFails: true });
  const r = await notifyPaid({ deps: bad.deps, config: cfg(), input: INPUT, now: NOW });
  assert.deepEqual([r.status, r.error], ['failed', 'discord down']);
  assert.equal(bad.rows.get('shrinkhla@example.com').status, 'failed');
  // Same rows, Discord healthy again.
  const ok = makeDeps();
  ok.rows.set('shrinkhla@example.com', { ...bad.rows.get('shrinkhla@example.com') });
  assert.equal((await notifyPaid({ deps: ok.deps, config: cfg(), input: INPUT, now: NOW })).status, 'notified');
});

test('client data can never ping anyone', async () => {
  const { deps, calls } = makeDeps();
  await notifyPaid({ deps, config: cfg(), input: { ...INPUT, name: '@everyone <@999999999999999999>', plan: '@here' }, now: NOW });
  const { body } = calls.post[0];
  assert.ok(!/@everyone|@here|<@999999999999999999>/.test(body.content));
  assert.deepEqual(body.allowedUserIds, IDS);
});

test('reminders: once per IST day in the same channel, and none after the dashboard exists', async () => {
  const { deps, calls, rows } = makeDeps();
  await notifyPaid({ deps, config: cfg(), input: INPUT, now: NOW });
  // Same day: the 8:30 run adds nothing.
  assert.equal((await remindPaid({ deps, config: cfg(), now: NOW })).reminded, 0);
  // Next day: one reminder, in the same channel, tagging the same people.
  const next = new Date(NOW.getTime() + 24 * 3600_000);
  assert.equal((await remindPaid({ deps, config: cfg(), now: next })).reminded, 1);
  assert.equal(calls.createChannel.length, 1);
  assert.match(calls.post[1].body.content, /^Reminder: dashboard still not created/);
  assert.equal(calls.post[1].id, 'ch1');
  // Second run the same day: nothing.
  assert.equal((await remindPaid({ deps, config: cfg(), now: next })).reminded, 0);
  // The dashboard appears: marked done, no more reminders.
  deps.dashboardExists = async () => true;
  const later = new Date(next.getTime() + 24 * 3600_000);
  const r = await remindPaid({ deps, config: cfg(), now: later });
  assert.deepEqual([r.reminded, r.done], [0, 1]);
  assert.equal(rows.get('shrinkhla@example.com').status, 'done');
});

test('reminders: a deleted channel is recreated, a failed post gives the day back, brakes post nothing', async () => {
  const { deps, calls, rows } = makeDeps();
  await notifyPaid({ deps, config: cfg(), input: INPUT, now: NOW });
  deps.discord.getChannel = async () => { throw Object.assign(new Error('Unknown Channel'), { status: 404 }); };
  const next = new Date(NOW.getTime() + 24 * 3600_000);
  assert.equal((await remindPaid({ deps, config: cfg(), now: next })).reminded, 1);
  assert.equal(calls.createChannel.length, 2);
  assert.equal(rows.get('shrinkhla@example.com').channelId, 'ch2');
  deps.discord.getChannel = async (id) => ({ id });
  deps.discord.postMessage = async () => { throw new Error('discord down'); };
  const day3 = new Date(next.getTime() + 24 * 3600_000);
  const r = await remindPaid({ deps, config: cfg(), now: day3 });
  assert.deepEqual([r.reminded, r.failed], [0, 1]);
  assert.equal(rows.get('shrinkhla@example.com').lastRemindedDay, ''); // retried at the next run
  assert.equal((await remindPaid({ deps, config: cfg({ dryRun: true }), now: day3 })).checked, 0);
});
