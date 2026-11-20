/**
 * Pure helpers for scripts/discord-test-flow.mjs. No I/O, no env, no network.
 */
import { DASHBOARD_URL, buildTestCustomId, istDateLabel, neutralizeMentions } from './messages.js';
import { sanitizeName } from './interactions.js';

const SNOWFLAKE_RE = /^\d{5,25}$/;
const USAGE = 'Usage: node scripts/discord-test-flow.mjs --client "name" [--email a@b.com] --resume-maker <discordId> --csm <discordId[,discordId]> [--confirm]';

/**
 * @param {string[]} argv arguments after the script name
 * @returns {{client: string, resumeMaker: string, csm: string, confirm: boolean}} raw values, not yet validated
 * @throws {Error} on an unknown flag or a flag missing its value
 */
export function parseTestFlowArgs(argv) {
  const out = { client: '', email: '', resumeMaker: '', csm: '', confirm: false };
  const valueFlags = { '--client': 'client', '--email': 'email', '--resume-maker': 'resumeMaker', '--csm': 'csm' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--confirm') {
      out.confirm = true;
    } else if (Object.hasOwn(valueFlags, arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value. ${USAGE}`);
      out[valueFlags[arg]] = value;
      i++;
    } else {
      throw new Error(`Unknown argument: ${neutralizeMentions(arg).slice(0, 40)}. ${USAGE}`);
    }
  }
  return out;
}

/**
 * Validates args and env. Env values are checked but never echoed.
 * @param {{client: string, resumeMaker: string, csm: string}} args
 * @param {Record<string, string|undefined>} env
 * @param {{requireToken?: boolean}} [opts] the token is only needed when posting
 * @returns {{client: string, email: string, resumeMaker: string, csm: string, channelId: string, guildId: string}}
 * @throws {Error} with a message that names the problem and never contains a secret
 */
export function validateTestFlowInput(args, env, { requireToken = true } = {}) {
  const problems = [];
  const raw = String(args.client ?? '').trim();
  if (!raw) problems.push('--client is required');
  const client = sanitizeName(raw);
  if (raw && client === 'this client') problems.push('--client has no usable characters');
  if (!SNOWFLAKE_RE.test(String(args.resumeMaker ?? ''))) problems.push('--resume-maker must be a Discord user id (5 to 25 digits)');
  const csmList = String(args.csm ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  if (csmList.length === 0 || !csmList.every((x) => SNOWFLAKE_RE.test(x))) problems.push('--csm must be one or more Discord user ids (5 to 25 digits each), comma separated');
  const email = String(args.email ?? '').trim();
  if (email && !/^[^\s@()<>]+@[^\s@()<>]+\.[^\s@()<>]+$/.test(email)) problems.push('--email is not a valid email address');
  const channelId = String(env.DISCORD_CLIENTS_CHANNEL_ID ?? '').trim();
  const guildId = String(env.DISCORD_GUILD_ID ?? '').trim();
  if (!SNOWFLAKE_RE.test(channelId)) problems.push('env DISCORD_CLIENTS_CHANNEL_ID is missing or not an id');
  if (!SNOWFLAKE_RE.test(guildId)) problems.push('env DISCORD_GUILD_ID is missing or not an id');
  if (requireToken && !String(env.DISCORD_BOT_TOKEN ?? '').trim()) problems.push('env DISCORD_BOT_TOKEN is missing');
  if (problems.length) throw new Error(problems.join('; '));
  return { client, email, resumeMaker: args.resumeMaker, csm: csmList.join(','), channelId, guildId };
}

/**
 * What the script posts: the thread name and the first message of the test flow.
 * @param {{client: string, resumeMaker: string, csm: string}} input validated input
 * @param {Date} now
 */
export function buildTestFlowStart({ client, email, resumeMaker, csm }, now) {
  return {
    threadName: `TEST ${client}`.slice(0, 100),
    message: {
      content: `[TEST] Resume not made for **${client}**${email ? ` (${neutralizeMentions(email)})` : ''}. ${istDateLabel(now)}. <@${resumeMaker}>\nDashboard: <${DASHBOARD_URL}>`,
      components: [{
        type: 1,
        components: [{
          type: 2,
          style: 1,
          label: 'Resume done',
          custom_id: buildTestCustomId({ step: 'resume', csmDiscordId: csm, resumeMakerId: resumeMaker }),
        }],
      }],
      allowedUserIds: [resumeMaker],
    },
  };
}
