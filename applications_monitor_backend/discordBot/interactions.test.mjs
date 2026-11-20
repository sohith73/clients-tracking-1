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
  const calls = { markResolved: [] };
  const deps = {
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
