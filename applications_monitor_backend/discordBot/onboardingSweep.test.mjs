import test from 'node:test';
import assert from 'node:assert/strict';
import { runOnboardingSweep } from './onboardingSweep.js';
import { loadOnboardingConfig } from './config.js';

const NOW = new Date('2026-11-18T03:00:00Z'); // 08:30 IST
const PRANJAL = ['111111111111111111', '222222222222222222'];

function cfg(extra = {}) {
  return { ...loadOnboardingConfig({
    DISCORD_ONBOARDING_ENABLED: 'true', DISCORD_BOT_DRY_RUN: 'false', DISCORD_GUILD_ID: 'g1',
    DISCORD_PRANJAL_USER_IDS: PRANJAL.join(','),
  }), ...extra };
}

function client(id, over = {}) {
  return {
    user: { _id: id, name: `Client ${id}`, email: `${id}@x.com`, planType: 'Prime', createdAt: new Date('2026-11-10T00:00:00Z'), resumeLink: [], ...over.user },
    onboardingJob: over.job ?? { clientNumber: 4 + (Number(String(id).replace(/\D/g, '')) || 1), status: 'resume_in_progress', csmName: 'Sam Lee' },
    tracking: over.tracking ?? null,
    csmPortalUser: over.csm ?? null,
  };
}

function makeDeps(clients, opts = {}) {
  const calls = { rename: [], grant: [], post: [], createThread: [], createCategory: [], createChannel: [], unarchive: [], saveThread: [], mark: [] };
  const claimed = new Set();
  const threads = new Map(Object.entries(opts.threads || {}));
  const deps = {
    discord: {
      listGuildChannels: async () => opts.channels || [],
      createCategory: async (g, { name }) => { calls.createCategory.push(name); return { id: `cat${calls.createCategory.length}` }; },
      createTextChannel: async (g, body) => { calls.createChannel.push(body); return { id: `th${calls.createChannel.length}` }; },
      grantChannelAccess: async (ch, ids) => { calls.grant.push({ ch, ids }); },
      createThread: async () => { throw new Error('threads are no longer used'); },
      getChannel: async (id) => {
        if (opts.missingThreads?.includes(id)) throw Object.assign(new Error('Unknown Channel'), { status: 404 });
        return { id, name: opts.channelNames?.[id], thread_metadata: { archived: Boolean(opts.archived?.includes(id)) } };
      },
      renameChannel: async (id, name) => { if (opts.renameFails) throw new Error('rate limited'); calls.rename.push({ id, name }); },
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
  assert.equal(body.components[0].components[0].label, 'Resume done');
  assert.deepEqual(body.allowedUserIds, ['900']);
  assert.deepEqual(calls.createCategory, ['client-onboarding']);
  assert.equal(calls.createChannel[0].name, '5-client-prime');
  assert.equal(calls.createChannel[0].parentId, 'cat1');
  assert.equal(calls.saveThread[0].threadId, 'th1');
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

test('stored client channel is reused, nothing is created', async () => {
  const { deps, calls } = makeDeps([client('u1')], { threads: { u1: { threadId: 'old', channelId: 'cat9' } } });
  await runOnboardingSweep({ deps, config: cfg(), now: NOW });
  assert.equal(calls.createChannel.length + calls.createCategory.length, 0);
  assert.equal(calls.post[0].ch, 'old');
});

test('deleted client channel (404) is recreated and saved', async () => {
  const { deps, calls } = makeDeps([client('u1')], { threads: { u1: { threadId: 'gone', channelId: 'cat9' } }, missingThreads: ['gone'] });
  const r = await runOnboardingSweep({ deps, config: cfg(), now: NOW });
  assert.equal(r.posted, 1);
  assert.equal(calls.createChannel.length, 1);
  assert.equal(calls.saveThread[0].threadId, 'th1');
  assert.equal(calls.post[0].ch, 'th1');
});

test('maxMessagesPerRun caps posting', async () => {
  const { deps, calls } = makeDeps([client('u1'), client('u2'), client('u3')]);
  const r = await runOnboardingSweep({ deps, config: cfg({ maxMessagesPerRun: 2 }), now: NOW });
  assert.equal(calls.post.length, 2);
  assert.equal(r.capped, true);
});

test('clients fill the category, then roll over to clients-2 at the cap', async () => {
  const h = makeDeps([client('u1'), client('u2'), client('u3')]);
  const r = await runOnboardingSweep({ deps: h.deps, config: cfg({ categoryMaxChannels: 2 }), now: NOW });
  assert.equal(r.posted, 3);
  assert.deepEqual(h.calls.createCategory, ['client-onboarding', 'client-onboarding-2']);
  assert.deepEqual(h.calls.createChannel.map((c) => c.parentId), ['cat1', 'cat1', 'cat2']);
});

test('an existing clients category with room is used, no category is created', async () => {
  const channels = [{ id: 'catA', name: 'client-onboarding', type: 4, parent_id: null }];
  const h = makeDeps([client('u1')], { channels });
  await runOnboardingSweep({ deps: h.deps, config: cfg(), now: NOW });
  assert.equal(h.calls.createCategory.length, 0);
  assert.equal(h.calls.createChannel[0].parentId, 'catA');
});

test('new channels per run are capped, and the capped client is not claimed', async () => {
  const h = makeDeps([client('u1'), client('u2'), client('u3')]);
  const r = await runOnboardingSweep({ deps: h.deps, config: cfg({ maxNewChannelsPerRun: 2 }), now: NOW });
  assert.equal(r.capped, true);
  assert.equal(h.calls.createChannel.length, 2);
  assert.equal(h.calls.post.length, 2);
  // The next run finishes the rest; nothing was claimed for u3, so it posts then.
  const again = await runOnboardingSweep({ deps: h.deps, config: cfg({ maxNewChannelsPerRun: 2 }), now: NOW });
  assert.equal(again.posted, 1);
  assert.equal(h.calls.createChannel.length, 3);
});

test('reminderMaxDays stops repeat reminders', async () => {
  const { deps, calls } = makeDeps([client('u1')], { alertDays: 3 });
  const r = await runOnboardingSweep({ deps, config: cfg({ reminderMaxDays: 3 }), now: NOW });
  assert.equal(calls.post.length, 0);
  assert.equal(r.skippedMaxDays, 1);
});

test('private channels: created hidden from everyone, tagged users and bot allowed, access granted before posting', async () => {
  const members = [{ user: { id: '900900900900', username: 'sam', global_name: 'Sam Lee' } }];
  const h = makeDeps([client('u1')], { members });
  await runOnboardingSweep({ deps: h.deps, config: cfg({ botUserId: '777777777777' }), now: NOW });
  const ow = h.calls.createChannel[0].permissionOverwrites;
  assert.deepEqual(ow[0], { id: 'g1', type: 0, allow: '0', deny: '1024' });
  assert.deepEqual(ow.slice(1).map((o) => o.id).sort(), ['777777777777', '900900900900']);
  assert.deepEqual(h.calls.grant, [{ ch: 'th1', ids: ['900900900900'] }]);
});

test('channel name is number-firstname-plan-country, taken from the tracking record', async () => {
  const h = makeDeps([client('u1', { user: { name: 'Sohith Reddy', planType: 'Executive' }, tracking: { clientNumber: 5810, clientCountry: 'USA' } })]);
  await runOnboardingSweep({ deps: h.deps, config: cfg(), now: NOW });
  assert.equal(h.calls.createChannel[0].name, '5810-sohith-executive-usa');
});

test('an existing channel with an old name is renamed, an up-to-date one is left alone', async () => {
  const tracking = { clientNumber: 5810, clientCountry: 'UK' };
  const a = makeDeps([client('u1', { user: { name: 'Sohith', planType: 'Executive' }, tracking })], { channelNames: { th9: '5810-sohith' } });
  await a.deps.saveThread({ userId: 'u1', threadId: 'th9', channelId: 'cat1' });
  await runOnboardingSweep({ deps: a.deps, config: cfg(), now: NOW });
  assert.deepEqual(a.calls.rename, [{ id: 'th9', name: '5810-sohith-executive-uk' }]);
  assert.equal(a.calls.createChannel.length, 0);

  const b = makeDeps([client('u1', { user: { name: 'Sohith', planType: 'Executive' }, tracking })], { channelNames: { th9: '5810-sohith-executive-uk' } });
  await b.deps.saveThread({ userId: 'u1', threadId: 'th9', channelId: 'cat1' });
  await runOnboardingSweep({ deps: b.deps, config: cfg(), now: NOW });
  assert.equal(b.calls.rename.length, 0);
});

test('a failed rename does not stop the post', async () => {
  const h = makeDeps([client('u1')], { channelNames: { th9: 'old-name' }, renameFails: true });
  await h.deps.saveThread({ userId: 'u1', threadId: 'th9', channelId: 'cat1' });
  const r = await runOnboardingSweep({ deps: h.deps, config: cfg(), now: NOW });
  assert.equal(r.posted, 1);
  assert.equal(r.failed, 0);
});

test('when the dashboard appears, the sweep continues in the channel made at payment, renames it, and makes no second one', async () => {
  const { deps, calls } = makeDeps([client('u1', { tracking: { clientNumber: 6077, clientCountry: 'Australia', crmEmail: 'crm@x.com' } })], { channelNames: { pay1: 'u1-prime-a1b2' } });
  const asked = [];
  const done = [];
  deps.findNoticeChannel = async (emails) => { asked.push(emails); return { email: 'crm@x.com', channelId: 'pay1' }; };
  deps.markNoticeDone = async (e) => { done.push(e); };
  const r = await runOnboardingSweep({ deps, config: cfg(), now: NOW });
  assert.equal(r.posted, 1);
  assert.deepEqual(asked, [['u1@x.com', 'crm@x.com']]);
  assert.equal(calls.createChannel.length, 0);
  assert.equal(calls.post[0].ch, 'pay1');
  assert.deepEqual(calls.rename, [{ id: 'pay1', name: '6077-client-prime-australia' }]);
  assert.equal(calls.saveThread[0].threadId, 'pay1');
  assert.deepEqual(done, ['crm@x.com']);
  // Next run uses the saved thread, not the notice again.
  asked.length = 0;
  await runOnboardingSweep({ deps, config: cfg(), now: new Date(NOW.getTime() + 24 * 3600_000) });
  assert.equal(asked.length, 0);
});

test('a deleted payment channel falls back to a fresh channel', async () => {
  const { deps, calls } = makeDeps([client('u1')], { missingThreads: ['pay1'] });
  deps.findNoticeChannel = async () => ({ email: 'u1@x.com', channelId: 'pay1' });
  const r = await runOnboardingSweep({ deps, config: cfg(), now: NOW });
  assert.equal(r.posted, 1);
  assert.equal(calls.createChannel.length, 1);
  assert.equal(calls.post[0].ch, 'th1');
});
