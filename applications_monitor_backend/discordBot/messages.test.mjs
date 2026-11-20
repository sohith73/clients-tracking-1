import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildResumeMessage, buildLinkedInMessage, buildCoverLetterMessage, buildThreadName, istDateLabel, istDayKey, neutralizeMentions,
  buildCustomId, buildTestCustomId, parseCustomId, buildFollowUpMessage, buildFinalMessage,
} from './messages.js';

const DASH = '\nDashboard: <https://portal.flashfirejobs.com/>';

const UID = '507f1f77bcf86cd799439011';

test('date label crosses IST midnight correctly', () => {
  // 18:29 UTC on 17 Nov is 23:59 IST on 17 Nov; 18:30 UTC is 00:00 IST on 18 Nov.
  assert.equal(istDateLabel(new Date('2026-11-17T18:29:00Z')), '17 Nov 2026');
  assert.equal(istDateLabel(new Date('2026-11-17T18:30:00Z')), '18 Nov 2026');
  assert.equal(istDayKey(new Date('2026-11-17T18:30:00Z')), '2026-11-18');
  assert.equal(istDayKey(new Date('2026-12-31T20:00:00Z')), '2027-01-01');
  assert.equal(istDateLabel(new Date('2026-12-31T20:00:00Z')), '1 Jan 2027');
});

test('resume message with matched CSM', () => {
  const m = buildResumeMessage({ clientName: 'Jane Doe', clientEmail: 'jane@x.com', userId: UID, csmDiscordId: '123456789012345678', csmName: 'Sam', dateLabel: '18 Nov 2026' });
  assert.equal(m.content, 'Resume not made for **Jane Doe** (jane@x.com). 18 Nov 2026. <@123456789012345678>' + DASH);
  assert.deepEqual(m.allowedUserIds, ['123456789012345678']);
  assert.equal(m.components.length, 1);
  const btn = m.components[0].components[0];
  assert.equal(m.components[0].type, 1);
  assert.equal(btn.type, 2);
  assert.equal(btn.style, 1);
  assert.equal(btn.label, 'Resume done');
  assert.equal(btn.custom_id, `onb:resume:${UID}:123456789012345678`);
  assert.ok(btn.custom_id.length < 100);
});

test('resume message fallback when CSM unmatched', () => {
  const m = buildResumeMessage({ clientName: 'A', clientEmail: 'a@x.com', userId: UID, csmDiscordId: null, csmName: 'Sam Lee', dateLabel: 'd' });
  assert.ok(m.content.endsWith('CSM not matched: Sam Lee' + DASH));
  assert.deepEqual(m.allowedUserIds, []);
  const n = buildResumeMessage({ clientName: 'A', clientEmail: '', userId: UID, dateLabel: 'd' });
  assert.ok(n.content.includes('CSM not matched: unassigned'));
});

test('client data cannot ping anyone', () => {
  const m = buildResumeMessage({
    clientName: '@everyone <@999> @here <@&5> <#7>', clientEmail: 'x@@everyone.com', userId: UID, csmDiscordId: '123', csmName: '<@888>', dateLabel: 'd',
  });
  const stripped = m.content.replace(/<@123>/g, '');
  assert.ok(!/@everyone|@here/.test(stripped));
  assert.ok(!/<@\d|<@&|<#/.test(stripped));
  assert.deepEqual(m.allowedUserIds, ['123']);
  assert.equal(neutralizeMentions('<@1>').includes('<@1>'), false);
});

test('LinkedIn and cover letter tag every assignee', () => {
  const ids = ['111', '222', '333'];
  const l = buildLinkedInMessage({ clientName: 'J', clientEmail: 'j@x.com', planType: 'Executive', userId: UID, dateLabel: 'd', assigneeUserIds: ids });
  const c = buildCoverLetterMessage({ clientName: 'J', clientEmail: 'j@x.com', planType: 'Executive', userId: UID, dateLabel: 'd', assigneeUserIds: ids });
  for (const m of [l, c]) {
    assert.ok(m.content.includes('<@111> <@222> <@333>'));
    assert.deepEqual(m.allowedUserIds, ids);
  }
  assert.equal(l.components[0].components[0].label, 'LinkedIn done');
  assert.equal(l.components[0].components[0].custom_id, `onb:linkedin:${UID}:0`);
  assert.equal(c.components[0].components[0].label, 'Cover letter done');
  assert.equal(c.components[0].components[0].custom_id, `onb:cover:${UID}:0`);
});

test('thread name is bounded, single line, mention free', () => {
  const n = buildThreadName('A'.repeat(300), 42);
  assert.ok(n.length <= 100);
  assert.ok(n.endsWith(' #42'));
  const w = buildThreadName('Jane\n<@123> @everyone\tDoe', 7);
  assert.ok(!/[\n\r\t@<>]/.test(w));
  assert.equal(buildThreadName('', null), 'Client');
});

const CSM = '123456789012345678';
const MAKER = '987654321098765432';

test('custom_id: csm embedded, unknown csm is 0, legacy 3-part still parses', () => {
  assert.equal(buildCustomId({ need: 'cover', userId: UID, csmDiscordId: CSM }), `onb:cover:${UID}:${CSM}`);
  assert.equal(buildCustomId({ need: 'cover', userId: UID, csmDiscordId: null }), `onb:cover:${UID}:0`);
  assert.equal(buildCustomId({ need: 'cover', userId: UID, csmDiscordId: 'abc' }), `onb:cover:${UID}:0`);
  assert.deepEqual(parseCustomId(`onb:linkedin:${UID}:${CSM}`), { family: 'onb', need: 'linkedin', userId: UID, csmDiscordId: CSM });
  assert.deepEqual(parseCustomId(`onb:linkedin:${UID}:0`), { family: 'onb', need: 'linkedin', userId: UID, csmDiscordId: null });
  assert.deepEqual(parseCustomId(`onb:resume:${UID}`), { family: 'onb', need: 'resume', userId: UID, csmDiscordId: null });
  assert.deepEqual(parseCustomId(`tst:cover:${CSM}:${MAKER}`), { family: 'tst', need: 'cover', csmDiscordId: CSM, csmDiscordIds: [CSM], resumeMakerId: MAKER });
  assert.deepEqual(parseCustomId(`tst:cover:${CSM},${MAKER}:${MAKER}`).csmDiscordIds, [CSM, MAKER]);
});

test('custom_id: strict parser rejects junk', () => {
  const bad = [
    '', 'onb:resume:xyz', `onb:other:${UID}`, `onb:resume:${UID}extra`, `onb:resume:${UID}:`, `onb:resume:${UID}:12`,
    `onb:resume:${UID}:${CSM}:1`, `onb:resume:${UID}:abc`, `x:resume:${UID}`, `tst:resume:${CSM}`, `tst:resume:0:${MAKER}`,
    `tst:resume:${CSM}:abc`, `tst:nope:${CSM}:${MAKER}`, `tst:resume:${CSM}:${MAKER}:1`, `ONB:resume:${UID}`,
  ];
  for (const id of bad) assert.equal(parseCustomId(id), null, id);
  assert.equal(parseCustomId(undefined), null);
});

test('custom_id: worst case stays under 100 chars', () => {
  const longId = '9'.repeat(25);
  for (const need of ['resume', 'linkedin', 'cover']) {
    assert.ok(buildCustomId({ need, userId: UID, csmDiscordId: longId }).length < 100);
    assert.ok(buildTestCustomId({ step: need, csmDiscordId: longId, resumeMakerId: longId }).length < 100);
  }
});

test('resume message tags the resume maker first, then the CSM, then plain text', () => {
  const base = { clientName: 'A', userId: UID, dateLabel: 'd', csmName: 'Sam' };
  const maker = buildResumeMessage({ ...base, csmDiscordId: CSM, resumeMakerDiscordId: MAKER });
  assert.ok(maker.content.endsWith(`<@${MAKER}>${DASH}`));
  assert.deepEqual(maker.allowedUserIds, [MAKER]);
  assert.equal(maker.components[0].components[0].custom_id, `onb:resume:${UID}:${CSM}`);
  const csm = buildResumeMessage({ ...base, csmDiscordId: CSM });
  assert.ok(csm.content.endsWith(`<@${CSM}>${DASH}`));
  const none = buildResumeMessage(base);
  assert.ok(none.content.endsWith('CSM not matched: Sam' + DASH));
  assert.deepEqual(none.allowedUserIds, []);
});

test('follow-up message: buttons per need, all assignees tagged', () => {
  const ids = ['111111', '222222'];
  const both = buildFollowUpMessage({ needs: ['linkedin', 'cover'], clientName: 'J', planType: 'Executive', userId: UID, csmDiscordId: CSM, dateLabel: 'd', assigneeUserIds: ids });
  assert.ok(both.content.startsWith('LinkedIn and cover letter not done for **J** [Executive]'));
  assert.deepEqual(both.components[0].components.map((b) => b.custom_id), [`onb:linkedin:${UID}:${CSM}`, `onb:cover:${UID}:${CSM}`]);
  assert.deepEqual(both.allowedUserIds, ids);
  const one = buildFollowUpMessage({ needs: ['linkedin'], clientName: 'J', userId: UID, dateLabel: 'd', assigneeUserIds: ids });
  assert.equal(one.components[0].components.length, 1);
});

test('final message: wording per plan, CSM tag or plain text, no button, no mention leaks', () => {
  const full = buildFinalMessage({ clientName: 'J', planType: 'Executive', needs: { linkedin: true, coverLetter: true }, csmDiscordId: CSM });
  assert.equal(full.content, `Please start the applications for **J**. Resume, LinkedIn and cover letter are done as required by the Executive plan. <@${CSM}>${DASH}`);
  assert.deepEqual(full.components, []);
  assert.deepEqual(full.allowedUserIds, [CSM]);
  const pro = buildFinalMessage({ clientName: 'J', planType: 'Professional', needs: { linkedin: true, coverLetter: false }, csmDiscordId: CSM });
  assert.ok(pro.content.includes('Resume and LinkedIn are done as required by the Professional plan.'));
  const prime = buildFinalMessage({ clientName: 'J', planType: 'Prime', needs: { linkedin: false, coverLetter: false }, csmDiscordId: null, csmName: 'Sam Lee' });
  assert.ok(prime.content.includes('The resume is done as required by the Prime plan.'));
  assert.ok(prime.content.endsWith('CSM not matched: Sam Lee' + DASH));
  assert.deepEqual(prime.allowedUserIds, []);
  const evil = buildFinalMessage({ clientName: '@everyone <@999>', planType: 'Prime', needs: {}, csmDiscordId: CSM });
  assert.ok(!/@everyone|<@999>/.test(evil.content));
});
