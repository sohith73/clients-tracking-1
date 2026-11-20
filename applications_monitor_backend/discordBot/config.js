/**
 * Onboarding sweep configuration, read from env. Pure: pass `env` in tests.
 * The bot token is deliberately NOT part of this object.
 */

/**
 * @param {string|undefined} raw comma separated list
 * @returns {string[]} unique, digits-only Discord snowflakes
 */
function parseIdList(raw) {
  const out = [];
  for (const part of String(raw || '').split(',')) {
    const id = part.trim();
    if (/^\d{5,25}$/.test(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * @param {string|undefined} raw
 * @param {number} fallback
 * @returns {number} non-negative integer, or fallback when junk
 */
function parseNonNegativeInt(raw, fallback) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/**
 * @param {Record<string, string|undefined>} [env]
 */
export function loadOnboardingConfig(env = process.env) {
  const windowDays = parseNonNegativeInt(env.DISCORD_NEW_CLIENT_DAYS, 30);
  return Object.freeze({
    enabled: env.DISCORD_ONBOARDING_ENABLED === 'true',
    // Safe by default: only an explicit "false" turns real posting on.
    dryRun: env.DISCORD_BOT_DRY_RUN !== 'false',
    guildId: String(env.DISCORD_GUILD_ID || '').trim(),
    clientsChannelId: String(env.DISCORD_CLIENTS_CHANNEL_ID || '').trim(),
    clientsChannelName: 'clients',
    allowCreateChannel: env.DISCORD_ALLOW_CREATE_CHANNEL !== 'false',
    linkedinCoverLetterUserIds: Object.freeze(parseIdList(env.DISCORD_PRANJAL_USER_IDS)),
    newClientWindowDays: windowDays > 0 ? windowDays : 30,
    excludePlans: Object.freeze(['Free Trial']),
    maxMessagesPerRun: 200,
    // 0 means unlimited daily reminders.
    reminderMaxDays: parseNonNegativeInt(env.DISCORD_REMINDER_MAX_DAYS, 0),
  });
}
