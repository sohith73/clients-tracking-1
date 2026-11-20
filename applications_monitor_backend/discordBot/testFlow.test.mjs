import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTestFlowArgs, validateTestFlowInput, buildTestFlowStart } from './testFlow.js';

const ENV = { DISCORD_BOT_TOKEN: 'tok', DISCORD_CLIENTS_CHANNEL_ID: '111111111111', DISCORD_GUILD_ID: '222222222222' };
const OK = { client: 'sohith', resumeMaker: '333333333333', csm: '444444444444' };

test('parses flags and confirm', () => {
  assert.deepEqual(
    parseTestFlowArgs(['--client', 'sohith', '--resume-maker', '3333333', '--csm', '4444444', '--confirm']),
    { client: 'sohith', resumeMaker: '3333333', csm: '4444444', confirm: true }
  );
  assert.equal(parseTestFlowArgs([]).confirm, false);
});

test('rejects unknown flags and missing values', () => {
  assert.throws(() => parseTestFlowArgs(['--bogus']), /Unknown argument/);
  assert.throws(() => parseTestFlowArgs(['--client']), /needs a value/);
  assert.throws(() => parseTestFlowArgs(['--client', '--confirm']), /needs a value/);
});

test('validates ids, client and env without echoing the token', () => {
  const v = validateTestFlowInput(OK, ENV);
  assert.equal(v.channelId, '111111111111');
  assert.throws(() => validateTestFlowInput({ ...OK, csm: 'abc' }, ENV), /--csm/);
  assert.throws(() => validateTestFlowInput({ ...OK, resumeMaker: '12' }, ENV), /--resume-maker/);
  assert.throws(() => validateTestFlowInput({ ...OK, client: '  ' }, ENV), /--client is required/);
  assert.throws(() => validateTestFlowInput(OK, { ...ENV, DISCORD_GUILD_ID: '' }), /DISCORD_GUILD_ID/);
  try {
    validateTestFlowInput(OK, { ...ENV, DISCORD_BOT_TOKEN: '', DISCORD_GUILD_ID: 'bad' });
    assert.fail('should throw');
  } catch (e) {
    assert.match(e.message, /DISCORD_BOT_TOKEN/);
    assert.doesNotMatch(e.message, /bad/);
  }
  assert.doesNotThrow(() => validateTestFlowInput(OK, { ...ENV, DISCORD_BOT_TOKEN: '' }, { requireToken: false }));
});

test('client name is sanitised', () => {
  const v = validateTestFlowInput({ ...OK, client: '@everyone <@9> **x**' }, ENV);
  assert.doesNotMatch(v.client, /@everyone|<@9>|\*/);
});

test('start message tags only the resume maker and carries the tst button', () => {
  const s = buildTestFlowStart(validateTestFlowInput(OK, ENV), new Date('2026-11-18T03:00:00Z'));
  assert.equal(s.threadName, 'TEST sohith');
  assert.equal(s.message.content, '[TEST] Resume not made for **sohith**. 18 Nov 2026. <@333333333333>');
  assert.deepEqual(s.message.allowedUserIds, ['333333333333']);
  const b = s.message.components[0].components[0];
  assert.equal(b.label, 'Resume done and linked');
  assert.equal(b.custom_id, 'tst:resume:444444444444:333333333333');
});
