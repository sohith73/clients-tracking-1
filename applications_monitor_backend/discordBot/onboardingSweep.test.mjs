import test from 'node:test';
import assert from 'node:assert/strict';
import { runOnboardingSweep } from './onboardingSweep.js';
import { loadOnboardingConfig } from './config.js';

const NOW = new Date('2026-11-18T03:00:00Z'); // 08:30 IST
const PRANJAL = ['111111111111111111', '222222222222222222'];

function cfg(extra = {}) {
  return { ...loadOnboardingConfig({
    DISCORD_ONBOARDING_ENABLED: 'true', DISCORD_BOT_DRY_RUN: 'false', DISCORD_GUILD_ID: 'g1',
    DISCORD_CLIENTS_CHANNEL_ID: 'ch1', DISCORD_PRANJAL_USER_IDS: PRANJAL.join(','),
  }), ...extra };
}

function client(id, over = {}) {
  return {
    user: { _id: id, name: `Client ${id}`, email: `${id}@x.com`, planType: 'Prime', createdAt: new Date('2026-11-10T00:00:00Z'), resumeLink: [], ...over.user },
    onboardingJob: over.job ?? { clientNumber: 5, status: 'resume_in_progress', csmName: 'Sam Lee' },
    csmPortalUser: over.csm ?? null,
  };
}

function makeDeps(clients, opts = {}) {
  const calls = { post: [], createThread: [], createChannel: [], unarchive: [], saveThread: [], mark: [] };
  const claimed = new Set();
  const threads = new Map(Object.entries(opts.threads || {}));
  const deps = {
    discord: {
      listGuildChannels: async () => opts.channels || [],
      createTextChannel: async (g, { name }) => { calls.createChannel.push(name); return { id: 'newch' }; },
      createThread: async (ch, body) => { calls.createThread.push({ ch, body }); return { id: `th${calls.createThread.length}` }; },
      getChannel: async (id) => {
        if (opts.missingThreads?.includes(id)) throw Object.assign(new Error('Unknown Channel'), { status: 404 });
        return { id, thread_metadata: { archived: Boolean(opts.archived?.includes(id)) } };
      },
      unarchiveThread: async (id) => { calls.unarchive.push(id); },
      postMessage: async (ch, body) => {
        if (opts.postFailsFor && body.content.includes(opts.postFailsFor)) throw new Error('boom');
        calls.post.push({ ch, body });
        return { id: `m${calls.post.length}` };
      },
      listGuildMembers: async () => opts.members || [{ user: { id: '900', username: 'sam', global_name: 'Sam Lee' } }],
    },
    listCandidateClients: async () => clients,
    getThread: async (uid) => threads.get(uid) || null,
    saveThread: async (t) => { calls.saveThread.push(t); threads.set(t.userId, { threadId: t.threadId, channelId: t.channelId }); },
    tryClaimAlert: async ({ userId, need, istDay }) => {
      const k = `${userId}|${need}|${istDay}`;
      if (claimed.has(k)) return false;
      claimed.add(k);
      return true;
    },
    markAlert: async (a) => { calls.mark.push(a); if (a.status === 'failed') claimed.delete(`${a.userId}|${a.need}|${a.istDay}`); },
    countAlertDays: async () => opts.alertDays || 0,
  };
  return { deps, calls };
}

test('disabled returns skipped', async () => {
  const { deps, calls } = makeDeps([client('u1')]);
  const r = await runOnboardingSweep({ deps, config: cfg({ enabled: false }), now: NOW });
  assert.deepEqual(r, { skipped: 'disabled' });
  assert.equal(calls.post.length, 0);
});

test('dry run makes zero Discord writes and does not claim', async () => {
  const { deps, calls } = makeDeps([client('u1')], { channels: [] });
  const r = await runOnboardingSweep({ deps, config: cfg({ dryRun: true, clientsChannelId: '' }), now: NOW });
  assert.equal(r.dryRun, true);
  assert.equal(calls.post.length + calls.createThread.length + calls.createChannel.length + calls.unarchive.length, 0);
  assert.equal(calls.mark.length, 0);
  assert.equal(r.plan.length, 1);
  assert.equal(r.plan[0].need, 'resume');
  assert.equal(r.plan[0].csmMatched, true);
  assert.deepEqual(r.plan[0].wouldTag, ['900']);
});

test('linked resume posts nothing', async () => {
  const { deps, calls } = makeDeps([client('u1', { user: { resumeLink: [{ name: 'r', link: 'https://r/1' }] } })]);
  const r = await runOnboardingSweep({ deps, config: cfg(), now: NOW });
  assert.equal(calls.post.length, 0);
  assert.equal(r.skippedLinked, 1);
  assert.ok(!JSON.stringify(r).includes('https://r/1'));
});

test('unlinked resume posts one message with button and CSM mention', async () => {
  const { deps, calls } = makeDeps([client('u1')]);
  const r = await runOnboardingSweep({ deps, config: cfg(), now: NOW });
  assert.equal(r.posted, 1);
  assert.equal(calls.post.length, 1);
  const { ch, body } = calls.post[0];
  assert.equal(ch, 'th1');
  assert.ok(body.content.includes('Resume not made for **Client u1**'));
  assert.ok(body.content.includes('18 Nov 2026'));
  assert.ok(body.content.includes('<@900>'));
  assert.equal(body.components[0].components[0].label, 'Resume done and linked');
  assert.deepEqual(body.allowedUserIds, ['900']);
  assert.equal(calls.createThread[0].ch, 'ch1');
  assert.equal(calls.mark.at(-1).status, 'sent');
});

test('rerun the same day posts nothing', async () => {
  const { deps, calls } = makeDeps([client('u1')]);
  await runOnboardingSweep({ deps, config: cfg(), now: NOW });
  const r2 = await runOnboardingSweep({ deps, config: cfg(), now: NOW });
  assert.equal(calls.post.length, 1);
  assert.equal(r2.posted, 0);
  assert.equal(r2.skippedAlreadyAlerted, 1);
});

test('Executive with resume pending gets only the resume message (sequential)', async () => {
  const { deps, calls } = makeDeps([client('u1', { user: { planType: 'Executive' } })]);
  const r = await runOnboardingSweep({ deps, config: cfg(), now: NOW });
  assert.equal(r.posted, 1);
  assert.equal(calls.post.length, 1);
  assert.ok(calls.post[0].body.content.startsWith('Resume not made'));
});

test('Professional with resume pending gets only the resume message', async () => {
  const { deps, calls } = makeDeps([client('u1', { user: { planType: 'Professional' } })]);
  await runOnboardingSweep({ deps, config: cfg(), now: NOW });
  assert.equal(calls.post.length, 1);
  assert.ok(!calls.post.some((p) => /LinkedIn|Cover letter/.test(p.body.content)));
});

test('resume pending tags the resume maker, not the CSM', async () => {
  const { deps, calls } = makeDeps([client('u1', {
    job: { status: 'x', csmName: 'Sam Lee', resumeMakerName: 'Rita Rao' },
  })], { members: [
    { user: { id: '900900', username: 'sam', global_name: 'Sam Lee' } },
    { user: { id: '777777', username: 'rita', global_name: 'Rita Rao' } },
  ] });
  await runOnboardingSweep({ deps, config: cfg(), now: NOW });
  assert.deepEqual(calls.post[0].body.allowedUserIds, ['777777']);
  assert.ok(calls.post[0].body.content.includes('<@777777>'));
  assert.ok(calls.post[0].body.components[0].components[0].custom_id.endsWith(':900900'));
});

test('resume maker portal user discordUserId wins over a name match', async () => {
  const { deps, calls } = makeDeps([{
    ...client('u1', { job: { status: 'x', resumeMakerName: 'Rita Rao' } }),
    resumeMakerPortalUser: { name: 'Rita Rao', discordUserId: '555555' },
  }]);
  await runOnboardingSweep({ deps, config: cfg(), now: NOW });
  assert.deepEqual(calls.post[0].body.allowedUserIds, ['555555']);
});

test('resume maker unresolved falls back to the CSM', async () => {
  const { deps, calls } = makeDeps([client('u1', { job: { status: 'x', csmName: 'Sam Lee', resumeMakerName: 'Nobody Known' } })]);
  await runOnboardingSweep({ deps, config: cfg(), now: NOW });
  assert.deepEqual(calls.post[0].body.allowedUserIds, ['900']);
});

test('resume linked and LinkedIn plus cover pending: one stage-2 message, no resume message', async () => {
  const { deps, calls } = makeDeps([client('u1', { user: { planType: 'Executive', resumeLink: [{ link: 'https://r' }] }, csm: { name: 'Sam Lee', discordUserId: '900900' } })]);
  const r = await runOnboardingSweep({ deps, config: cfg(), now: NOW });
  assert.equal(r.posted, 1);
  assert.equal(calls.post.length, 1);
  const { body } = calls.post[0];
  assert.ok(body.content.startsWith('LinkedIn and cover letter not done'));
  assert.ok(!body.content.includes('Resume not made'));
  assert.deepEqual(body.allowedUserIds, PRANJAL);
  assert.deepEqual(body.components[0].components.map((b) => b.custom_id.split(':')[1]), ['linkedin', 'cover']);
  assert.ok(body.components[0].components[0].custom_id.endsWith(':900900'));
  assert.deepEqual(calls.mark.filter((m) => m.status === 'sent').map((m) => m.need).sort(), ['coverLetter', 'linkedin']);
});

test('stage-2 alert recorded by the click handler stops the sweep from repeating it', async () => {
  const { deps, calls } = makeDeps([client('u1', { user: { planType: 'Professional', resumeLink: [{ link: 'https://r' }] } })]);
  const base = deps.tryClaimAlert;
  deps.tryClaimAlert = async (a) => (a.need === 'linkedin' ? false : base(a));
  const r = await runOnboardingSweep({ deps, config: cfg(), now: NOW });
  assert.equal(calls.post.length, 0);
  assert.equal(r.skippedAlreadyAlerted, 1);
});

test('resume, LinkedIn and cover letter all done: nothing posted', async () => {
  const { deps, calls } = makeDeps([client('u1', {
    user: { planType: 'Executive', resumeLink: [{ link: 'https://r' }] }, job: { status: 'cover_letter_done' },
  })]);
  const r = await runOnboardingSweep({ deps, config: cfg(), now: NOW });
  assert.equal(calls.post.length, 0);
  assert.equal(r.posted, 0);
});

test('dry run with a stage-2 client plans per need and writes nothing', async () => {
  const { deps, calls } = makeDeps([client('u1', { user: { planType: 'Executive', resumeLink: [{ link: 'https://r' }] } })]);
  const r = await runOnboardingSweep({ deps, config: cfg({ dryRun: true }), now: NOW });
  assert.equal(calls.post.length + calls.mark.length + calls.createThread.length, 0);
  assert.deepEqual(r.plan.map((p) => p.need), ['linkedin', 'coverLetter']);
  assert.deepEqual(r.plan[0].wouldTag, PRANJAL);
});

test('linkedin is not gated on resume and skipped when done', async () => {
  const linked = { resumeLink: [{ link: 'https://r' }] };
  const { deps, calls } = makeDeps([
    client('u1', { user: { planType: 'Professional', ...linked } }),
    client('u2', { user: { planType: 'Professional', ...linked }, job: { status: 'linkedin_done' } }),
  ]);
  await runOnboardingSweep({ deps, config: cfg(), now: NOW });
  assert.equal(calls.post.length, 1);
  assert.ok(calls.post[0].body.content.startsWith('LinkedIn not done'));
});

test('Free Trial never reaches the sweep, even if the lister leaks one', async () => {
  const { deps, calls } = makeDeps([client('u1', { user: { planType: 'Free Trial' } })]);
  const r = await runOnboardingSweep({ deps, config: cfg(), now: NOW });
  assert.equal(r.considered, 0);
  assert.equal(calls.post.length, 0);
});

test('one client throwing does not stop the rest', async () => {
  const { deps, calls } = makeDeps([client('u1'), client('u2'), client('u3')], { postFailsFor: 'Client u2' });
  const r = await runOnboardingSweep({ deps, config: cfg(), now: NOW });
  assert.equal(r.posted, 2);
  assert.equal(r.failed, 1);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].userId, 'u2');
  assert.ok(calls.mark.some((a) => a.userId === 'u2' && a.status === 'failed'));
  // a failed row is claimable again, so a retry posts it
  const r2 = await runOnboardingSweep({ deps: { ...deps, discord: { ...deps.discord, postMessage: async () => ({ id: 'ok' }) } }, config: cfg(), now: NOW });
  assert.equal(r2.posted, 1);
});

test('a throwing getThread on one client is isolated', async () => {
  const { deps } = makeDeps([client('u1'), client('u2')]);
  const orig = deps.getThread;
  deps.getThread = async (id) => { if (id === 'u1') throw new Error('db down'); return orig(id); };
  const r = await runOnboardingSweep({ deps, config: cfg(), now: NOW });
  assert.equal(r.posted, 1);
  assert.equal(r.failed, 1);
});

test('archived thread is unarchived and reused', async () => {
  const { deps, calls } = makeDeps([client('u1')], { threads: { u1: { threadId: 'old', channelId: 'ch1' } }, archived: ['old'] });
  await runOnboardingSweep({ deps, config: cfg(), now: NOW });
  assert.deepEqual(calls.unarchive, ['old']);
  assert.equal(calls.createThread.length, 0);
  assert.equal(calls.post[0].ch, 'old');
});

test('missing thread (404) is recreated and saved', async () => {
  const { deps, calls } = makeDeps([client('u1')], { threads: { u1: { threadId: 'gone', channelId: 'ch1' } }, missingThreads: ['gone'] });
  const r = await runOnboardingSweep({ deps, config: cfg(), now: NOW });
  assert.equal(r.posted, 1);
  assert.equal(calls.createThread.length, 1);
  assert.equal(calls.saveThread[0].threadId, 'th1');
  assert.equal(calls.post[0].ch, 'th1');
});

test('maxMessagesPerRun caps posting', async () => {
  const { deps, calls } = makeDeps([client('u1'), client('u2'), client('u3')]);
  const r = await runOnboardingSweep({ deps, config: cfg({ maxMessagesPerRun: 2 }), now: NOW });
  assert.equal(calls.post.length, 2);
  assert.equal(r.capped, true);
});

test('channel resolved by name, then created, then failure', async () => {
  let h = makeDeps([client('u1')], { channels: [{ id: 'found', name: 'Clients', type: 0 }] });
  let r = await runOnboardingSweep({ deps: h.deps, config: cfg({ clientsChannelId: '' }), now: NOW });
  assert.equal(r.channelId, 'found');
  h = makeDeps([client('u1')], { channels: [] });
  r = await runOnboardingSweep({ deps: h.deps, config: cfg({ clientsChannelId: '' }), now: NOW });
  assert.deepEqual(h.calls.createChannel, ['clients']);
  assert.equal(r.channelId, 'newch');
  h = makeDeps([client('u1')], { channels: [] });
  await assert.rejects(runOnboardingSweep({ deps: h.deps, config: cfg({ clientsChannelId: '', allowCreateChannel: false }), now: NOW }), /not found/);
});

test('reminderMaxDays stops repeat reminders', async () => {
  const { deps, calls } = makeDeps([client('u1')], { alertDays: 3 });
  const r = await runOnboardingSweep({ deps, config: cfg({ reminderMaxDays: 3 }), now: NOW });
  assert.equal(calls.post.length, 0);
  assert.equal(r.skippedMaxDays, 1);
});
