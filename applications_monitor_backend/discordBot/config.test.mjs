import test from 'node:test';
import assert from 'node:assert/strict';
import { loadOnboardingConfig } from './config.js';

test('live by default: dryRun only when the env explicitly says true', () => {
  assert.equal(loadOnboardingConfig({}).dryRun, false);
  assert.equal(loadOnboardingConfig({ DISCORD_BOT_DRY_RUN: '0' }).dryRun, false);
  assert.equal(loadOnboardingConfig({ DISCORD_BOT_DRY_RUN: 'true' }).dryRun, true);
});

test('enabled by default: only the string false switches it off', () => {
  assert.equal(loadOnboardingConfig({}).enabled, true);
  assert.equal(loadOnboardingConfig({ DISCORD_ONBOARDING_ENABLED: 'true' }).enabled, true);
  assert.equal(loadOnboardingConfig({ DISCORD_ONBOARDING_ENABLED: 'false' }).enabled, false);
});

test('assignee ids are trimmed, deduped, digits only; junk dropped', () => {
  const c = loadOnboardingConfig({ DISCORD_PRANJAL_USER_IDS: ' 111111111111111111, abc,222222222222222222,111111111111111111,<@333>, ,12x4567890' });
  assert.deepEqual([...c.linkedinCoverLetterUserIds], ['111111111111111111', '222222222222222222']);
});

test('defaults and parsing of the other fields', () => {
  const c = loadOnboardingConfig({});
  assert.equal(c.categoryName, 'client-onboarding');
  assert.equal(c.categoryMaxChannels, 50);
  assert.equal(c.maxNewChannelsPerRun, 25);
  assert.equal(c.newClientWindowDays, 30);
  assert.equal(c.maxMessagesPerRun, 200);
  assert.equal(c.reminderMaxDays, 0);
  assert.deepEqual([...c.excludePlans], ['Free Trial']);
  const d = loadOnboardingConfig({ DISCORD_NEW_CLIENT_DAYS: '14', DISCORD_REMINDER_MAX_DAYS: '5', DISCORD_GUILD_ID: ' 99 ' });
  assert.equal(d.newClientWindowDays, 14);
  assert.equal(d.reminderMaxDays, 5);
  assert.equal(d.guildId, '99');
  assert.equal(loadOnboardingConfig({ DISCORD_NEW_CLIENT_DAYS: 'junk' }).newClientWindowDays, 30);
});

test('config is frozen and has no token', () => {
  const c = loadOnboardingConfig({ DISCORD_BOT_TOKEN: 'secret' });
  assert.ok(Object.isFrozen(c));
  assert.ok(!JSON.stringify(c).includes('secret'));
});

test('category settings are fixed constants and ignore env', () => {
  const c = loadOnboardingConfig({ DISCORD_CLIENTS_CATEGORY_NAME: 'x', DISCORD_CATEGORY_MAX_CHANNELS: '10', DISCORD_MAX_NEW_CHANNELS_PER_RUN: '1' });
  assert.equal(c.categoryName, 'client-onboarding');
  assert.equal(c.categoryMaxChannels, 50);
  assert.equal(c.maxNewChannelsPerRun, 25);
});
