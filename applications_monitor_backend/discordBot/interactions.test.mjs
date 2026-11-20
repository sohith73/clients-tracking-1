import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleInteraction } from './interactions.js';

const UID = 'a'.repeat(24);
const click = (customId, clicker = '111111111111') => ({
  type: 3,
  data: { custom_id: customId },
  member: { user: { id: clicker } },
});

function makeDeps(over = {}) {
  const calls = { markResolved: [], posts: [], records: [] };
  const deps = {
    discord: { postMessage: async (ch, body) => { calls.posts.push({ ch, body }); return { id: 'm1' }; } },
    config: { linkedinCoverLetterUserIds: ['111111', '222222'] },
    recordFollowUp: async (a) => { calls.records.push(a); },
    loadUser: async () => ({ name: 'Asha', email: 'asha@x.com', resumeLink: [] }),
    loadOnboardingJob: async () => null,
    canClick: async () => true,
    markResolved: async (a) => { calls.markResolved.push(a); },
    now: () => new Date('2026-11-18T10:00:00Z'),
    ...over,
  };
  return { deps, calls };
}

test('PING returns type 1', async () => {
  const { deps } = makeDeps();
  assert.deepEqual(await handleInteraction({ interaction: { type: 1 }, deps }), { type: 1 });
});

test('unsupported interaction type is ephemeral', async () => {
  const { deps } = makeDeps();
  const r = await handleInteraction({ interaction: { type: 2 }, deps });
  assert.equal(r.type, 4);
  assert.equal(r.data.flags, 64);
});

test('bad custom_id is rejected without touching deps', async () => {
  const { deps, calls } = makeDeps({ loadUser: async () => { throw new Error('should not load'); } });
  for (const id of ['onb:resume:xyz', `onb:other:${UID}`, `onb:resume:${UID}extra`, '', `x:resume:${UID}`]) {
    const r = await handleInteraction({ interaction: click(id), deps });
    assert.equal(r.type, 4);
    assert.equal(r.data.flags, 64);
    assert.match(r.data.content, /Not supported/);
  }
  assert.equal(calls.markResolved.length, 0);
});

test('clicker not allowed', async () => {
  const { deps, calls } = makeDeps({ canClick: async () => false });
  const r = await handleInteraction({ interaction: click(`onb:resume:${UID}`), deps });
  assert.equal(r.data.flags, 64);
  assert.match(r.data.content, /Only the CSM team/);
  assert.equal(calls.markResolved.length, 0);
});

test('missing user', async () => {
  const { deps } = makeDeps({ loadUser: async () => null });
  const r = await handleInteraction({ interaction: click(`onb:resume:${UID}`), deps });
  assert.match(r.data.content, /can't find this client/);
});

test('resume not linked: ephemeral, button kept, nothing resolved', async () => {
  const { deps, calls } = makeDeps();
  const r = await handleInteraction({ interaction: click(`onb:resume:${UID}`), deps });
  assert.equal(r.type, 4);
  assert.equal(r.data.flags, 64);
  assert.match(r.data.content, /I do not see a resume linked for Asha/);
  assert.equal(r.data.components, undefined);
  assert.equal(calls.markResolved.length, 0);
});

test('resume linked: type 7 update, components cleared, markResolved called', async () => {
  const { deps, calls } = makeDeps({
    loadUser: async () => ({ name: 'Asha', email: 'asha@x.com', resumeLink: [{ link: 'https://r/1' }] }),
  });
  const r = await handleInteraction({ interaction: click(`onb:resume:${UID}`, '222222222222'), deps });
  assert.equal(r.type, 7);
  assert.deepEqual(r.data.components, []);
  assert.deepEqual(r.data.allowed_mentions, { parse: [] });
  assert.match(r.data.content, /Resume done and linked for \*\*Asha\*\*\. Confirmed by <@222222222222> on 2026-11-18\./);
  assert.deepEqual(calls.markResolved, [{ userId: UID, need: 'resume', discordUserId: '222222222222' }]);
});

test('cover maps to coverLetter and uses the onboarding job', async () => {
  let askedEmail;
  const { deps, calls } = makeDeps({
    loadOnboardingJob: async (e) => { askedEmail = e; return { status: 'cover_letter_done' }; },
  });
  const r = await handleInteraction({ interaction: { ...click(`onb:cover:${UID}`), member: undefined, user: { id: '333333333333' } }, deps });
  assert.equal(askedEmail, 'asha@x.com');
  assert.equal(r.type, 7);
  assert.equal(calls.markResolved[0].need, 'coverLetter');
  assert.equal(calls.markResolved[0].discordUserId, '333333333333');
});

test('linkedin not done keeps the button', async () => {
  const { deps } = makeDeps({ loadOnboardingJob: async () => ({ status: 'resume_in_progress' }) });
  const r = await handleInteraction({ interaction: click(`onb:linkedin:${UID}`), deps });
  assert.equal(r.type, 4);
  assert.match(r.data.content, /LinkedIn/);
});

test('deps throwing returns an ephemeral error', async () => {
  const { deps } = makeDeps({ loadUser: async () => { throw new Error('db down'); } });
  const r = await handleInteraction({ interaction: click(`onb:resume:${UID}`), deps });
  assert.equal(r.type, 4);
  assert.equal(r.data.flags, 64);
  assert.match(r.data.content, /Something went wrong/);
});

test('client names cannot ping anyone', async () => {
  const { deps } = makeDeps({
    loadUser: async () => ({ name: '@everyone <@999> @here', resumeLink: [{ link: 'x' }], email: 'a@b.c' }),
  });
  const r = await handleInteraction({ interaction: click(`onb:resume:${UID}`), deps });
  assert.doesNotMatch(r.data.content, /@everyone|@here/);
  assert.doesNotMatch(r.data.content, /<@999>/);
  assert.deepEqual(r.data.allowed_mentions, { parse: [] });
});

const CSM = '123456789012345678';
const MAKER = '987654321098765432';
const THREAD = '555555555555555555';
const LINKED = [{ link: 'https://secret.example/resume' }];
const withPlan = (planType, extra = {}) => async () => ({ name: 'Asha', email: 'asha@x.com', planType, resumeLink: LINKED, ...extra });
const resumeClick = (extra = {}) => ({ ...click(`onb:resume:${UID}:${CSM}`, '222222222222'), channel_id: THREAD, ...extra });
const buttonIds = (body) => body.components.flatMap((r) => r.components.map((c) => c.custom_id));

test('resume click on Executive: resolved edit plus stage-2 post with both buttons', async () => {
  const { deps, calls } = makeDeps({ loadUser: withPlan('Executive') });
  const r = await handleInteraction({ interaction: resumeClick(), deps });
  assert.equal(r.type, 7);
  assert.deepEqual(r.data.components, []);
  assert.equal(calls.posts.length, 1);
  const { ch, body } = calls.posts[0];
  assert.equal(ch, THREAD);
  assert.ok(body.content.startsWith('LinkedIn and cover letter not done for **Asha**'));
  assert.ok(body.content.includes('<@111111> <@222222>'));
  assert.deepEqual(body.allowedUserIds, ['111111', '222222']);
  assert.deepEqual(buttonIds(body), [`onb:linkedin:${UID}:${CSM}`, `onb:cover:${UID}:${CSM}`]);
  assert.ok(!JSON.stringify(calls.posts).includes('secret.example'));
  assert.deepEqual(calls.records, [{ userId: UID, needs: ['linkedin', 'coverLetter'], istDay: '2026-11-18', messageId: 'm1', threadId: THREAD }]);
});

test('resume click on Professional: LinkedIn button only', async () => {
  const { deps, calls } = makeDeps({ loadUser: withPlan('Professional') });
  await handleInteraction({ interaction: resumeClick(), deps });
  assert.deepEqual(buttonIds(calls.posts[0].body), [`onb:linkedin:${UID}:${CSM}`]);
  assert.deepEqual(calls.records[0].needs, ['linkedin']);
});

for (const plan of ['Prime', 'Free Trial', undefined]) {
  test(`resume click on ${plan}: straight to the CSM message, no assignee post`, async () => {
    const { deps, calls } = makeDeps({ loadUser: withPlan(plan), loadOnboardingJob: async () => ({ csmName: 'Sam' }) });
    const r = await handleInteraction({ interaction: resumeClick(), deps });
    assert.equal(r.type, 7);
    assert.equal(calls.posts.length, 1);
    const { body } = calls.posts[0];
    assert.ok(body.content.startsWith('Please start the applications for **Asha**.'));
    assert.ok(body.content.includes('The resume is done'));
    assert.ok(body.content.endsWith(`<@${CSM}>`));
    assert.deepEqual(body.components, []);
    assert.deepEqual(body.allowedUserIds, [CSM]);
    assert.equal(calls.records.length, 0);
  });
}

const stage2 = (ids, content = 'LinkedIn and cover letter not done for **Asha**. d. <@111111>') => ({
  content,
  components: [{ type: 1, components: ids.map((i) => ({ type: 2, style: 1, label: 'x', custom_id: i })) }],
});
const LI = `onb:linkedin:${UID}:${CSM}`;
const CO = `onb:cover:${UID}:${CSM}`;

test('LinkedIn click with the cover button still present: no final message, cover button kept', async () => {
  const { deps, calls } = makeDeps({
    loadUser: withPlan('Executive'), loadOnboardingJob: async () => ({ status: 'linkedin_done' }),
  });
  const r = await handleInteraction({ interaction: { ...click(LI), channel_id: THREAD, message: stage2([LI, CO]) }, deps });
  assert.equal(r.type, 7);
  assert.equal(calls.posts.length, 0);
  assert.deepEqual(r.data.components[0].components.map((c) => c.custom_id), [CO]);
  assert.ok(r.data.content.startsWith('LinkedIn and cover letter not done'));
  assert.ok(r.data.content.includes('LinkedIn optimization done for **Asha**'));
  assert.equal(calls.markResolved[0].need, 'linkedin');
});

test('last button clicked: final message tags the CSM', async () => {
  const { deps, calls } = makeDeps({
    loadUser: withPlan('Executive'), loadOnboardingJob: async () => ({ status: 'cover_letter_done' }),
  });
  const r = await handleInteraction({ interaction: { ...click(CO), channel_id: THREAD, message: stage2([CO]) }, deps });
  assert.equal(r.type, 7);
  assert.deepEqual(r.data.components, []);
  assert.equal(calls.posts.length, 1);
  assert.equal(calls.posts[0].ch, THREAD);
  assert.equal(
    calls.posts[0].body.content,
    `Please start the applications for **Asha**. Resume, LinkedIn and cover letter are done as required by the Executive plan. <@${CSM}>`
  );
  assert.deepEqual(calls.posts[0].body.allowedUserIds, [CSM]);
});

test('final message with unknown CSM is plain text and tags nobody', async () => {
  const { deps, calls } = makeDeps({
    loadUser: withPlan('Professional'), loadOnboardingJob: async () => ({ status: 'linkedin_done', csmName: 'Sam Lee' }),
  });
  const legacy = `onb:linkedin:${UID}`;
  await handleInteraction({ interaction: { ...click(legacy), channel_id: THREAD, message: stage2([legacy]) }, deps });
  const { body } = calls.posts[0];
  assert.ok(body.content.endsWith('CSM not matched: Sam Lee'));
  assert.ok(!body.content.includes('<@'));
  assert.deepEqual(body.allowedUserIds, []);
});

test('follow-up post failing still resolves the click', async () => {
  const errs = [];
  const orig = console.error;
  console.error = (...a) => errs.push(a.join(' '));
  try {
    const { deps, calls } = makeDeps({
      loadUser: withPlan('Executive'),
      discord: { postMessage: async () => { throw new Error('discord 500'); } },
    });
    const r = await handleInteraction({ interaction: resumeClick(), deps });
    assert.equal(r.type, 7);
    assert.deepEqual(r.data.components, []);
    assert.equal(calls.markResolved.length, 1);
    assert.equal(calls.records.length, 0);
    assert.equal(errs.length, 1);
    assert.match(errs[0], /follow-up post failed: discord 500/);
  } finally {
    console.error = orig;
  }
});

test('forged or malformed custom_ids never reach the database', async () => {
  const { deps, calls } = makeDeps({
    loadUser: async () => { throw new Error('no db'); }, canClick: async () => { throw new Error('no auth'); },
  });
  const bad = [
    `onb:resume:${UID}:abc`, `onb:resume:${UID}:12`, `tst:resume:abc:${MAKER}`, `tst:resume:${CSM}`, `tst:resume:${CSM}:${MAKER}:9`,
    `tst:other:${CSM}:${MAKER}`, `tst:resume:${CSM}:${MAKER}x`, `tst:resume:0:${MAKER}`,
  ];
  for (const id of bad) {
    const r = await handleInteraction({ interaction: click(id), deps });
    assert.match(r.data.content, /Not supported/, id);
  }
  assert.equal(calls.markResolved.length, 0);
});

test('test flow: full chain with no database access', async () => {
  const boom = () => { throw new Error('test flow must not touch the database'); };
  const { deps, calls } = makeDeps({ loadUser: boom, loadOnboardingJob: boom, markResolved: boom, recordFollowUp: boom });
  const channel = { name: 'TEST sohith' };
  const tst = (step) => `tst:${step}:${CSM}:${MAKER}`;

  const r1 = await handleInteraction({ interaction: { ...click(tst('resume'), MAKER), channel_id: THREAD, channel }, deps });
  assert.equal(r1.type, 7);
  assert.deepEqual(r1.data.components, []);
  assert.match(r1.data.content, /^\[TEST\] Resume done and linked for \*\*sohith\*\*/);
  assert.equal(calls.posts.length, 1);
  const s2 = calls.posts[0].body;
  assert.equal(calls.posts[0].ch, THREAD);
  assert.ok(s2.content.startsWith('[TEST] LinkedIn and cover letter not done for **sohith**'));
  assert.deepEqual(s2.allowedUserIds, ['111111', '222222']);
  assert.deepEqual(buttonIds(s2), [tst('linkedin'), tst('cover')]);

  const msg = { content: s2.content, components: s2.components };
  const r2 = await handleInteraction({ interaction: { ...click(tst('linkedin'), '111111'), channel_id: THREAD, channel, message: msg }, deps });
  assert.equal(calls.posts.length, 1);
  assert.deepEqual(r2.data.components[0].components.map((c) => c.custom_id), [tst('cover')]);
  assert.ok(r2.data.content.includes('[TEST] LinkedIn optimization done'));

  const msg2 = { content: r2.data.content, components: r2.data.components };
  const r3 = await handleInteraction({ interaction: { ...click(tst('cover'), '111111'), channel_id: THREAD, channel, message: msg2 }, deps });
  assert.deepEqual(r3.data.components, []);
  assert.equal(calls.posts.length, 2);
  const fin = calls.posts[1].body;
  assert.equal(
    fin.content,
    `[TEST] Please start the applications for **sohith**. Resume, LinkedIn and cover letter are done as required by the Executive plan. <@${CSM}>`
  );
  assert.deepEqual(fin.allowedUserIds, [CSM]);
  assert.deepEqual(fin.components, []);
  assert.equal(calls.markResolved.length, 0);
  assert.equal(calls.records.length, 0);
});

test('test flow: canClick still applies and a missing thread name falls back', async () => {
  const denied = makeDeps({ canClick: async () => false });
  const r = await handleInteraction({ interaction: { ...click(`tst:resume:${CSM}:${MAKER}`), channel_id: THREAD }, deps: denied.deps });
  assert.match(r.data.content, /Only the CSM team/);
  assert.equal(denied.calls.posts.length, 0);

  const { deps, calls } = makeDeps();
  const ok = await handleInteraction({ interaction: { ...click(`tst:resume:${CSM}:${MAKER}`), channel_id: THREAD }, deps });
  assert.match(ok.data.content, /for \*\*the test client\*\*/);
  assert.ok(calls.posts[0].body.content.includes('**the test client**'));
});

test('test flow: hostile thread name cannot ping and original message text is not used', async () => {
  const { deps, calls } = makeDeps();
  const r = await handleInteraction({
    interaction: {
      ...click(`tst:resume:${CSM}:${MAKER}`), channel_id: THREAD,
      channel: { name: 'TEST @everyone <@999> **x**' },
      message: { content: 'Resume not made for **EVIL <@888>**', components: [] },
    },
    deps,
  });
  const all = r.data.content + calls.posts[0].body.content;
  assert.doesNotMatch(all, /@everyone|<@999>|EVIL|<@888>/);
  assert.deepEqual(r.data.allowed_mentions, { parse: [] });
});

test('client names with mentions are neutralised in follow-up posts too', async () => {
  const { deps, calls } = makeDeps({ loadUser: withPlan('Executive', { name: '@everyone <@999>' }) });
  await handleInteraction({ interaction: resumeClick(), deps });
  assert.doesNotMatch(calls.posts[0].body.content, /@everyone|<@999>/);
});
