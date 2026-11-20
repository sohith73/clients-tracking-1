import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildResumeMessage, buildLinkedInMessage, buildCoverLetterMessage, buildThreadName, istDateLabel, istDayKey, neutralizeMentions,
} from './messages.js';

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
  const m = buildResumeMessage({ clientName: 'Jane Doe', clientEmail: 'jane@x.com', userId: UID, csmDiscordId: '123', csmName: 'Sam', dateLabel: '18 Nov 2026' });
  assert.equal(m.content, 'Resume not made for **Jane Doe** (jane@x.com). 18 Nov 2026. <@123>');
  assert.deepEqual(m.allowedUserIds, ['123']);
  assert.equal(m.components.length, 1);
  const btn = m.components[0].components[0];
  assert.equal(m.components[0].type, 1);
  assert.equal(btn.type, 2);
  assert.equal(btn.style, 1);
  assert.equal(btn.label, 'Resume done and linked');
  assert.equal(btn.custom_id, `onb:resume:${UID}`);
  assert.ok(btn.custom_id.length < 100);
});

test('resume message fallback when CSM unmatched', () => {
  const m = buildResumeMessage({ clientName: 'A', clientEmail: 'a@x.com', userId: UID, csmDiscordId: null, csmName: 'Sam Lee', dateLabel: 'd' });
  assert.ok(m.content.endsWith('CSM not matched: Sam Lee'));
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
  assert.equal(l.components[0].components[0].custom_id, `onb:linkedin:${UID}`);
  assert.equal(c.components[0].components[0].label, 'Cover letter done');
  assert.equal(c.components[0].components[0].custom_id, `onb:cover:${UID}`);
});

test('thread name is bounded, single line, mention free', () => {
  const n = buildThreadName('A'.repeat(300), 42);
  assert.ok(n.length <= 100);
  assert.ok(n.endsWith(' #42'));
  const w = buildThreadName('Jane\n<@123> @everyone\tDoe', 7);
  assert.ok(!/[\n\r\t@<>]/.test(w));
  assert.equal(buildThreadName('', null), 'Client');
});
