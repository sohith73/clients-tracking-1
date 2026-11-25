/**
 * Paid client, no dashboard yet: tell the dashboard people on Discord. Nothing is created.
 *
 * notifyPaid: called when a lead is marked paid or a payment arrives. Makes the client's private
 *   channel and posts "create the dashboard" tagging the dashboard people. Once per email.
 * remindPaid: once per IST day (8:00 sweep), reminds in the same channel until the dashboard exists.
 *   When the dashboard appears, the normal onboarding sweep adopts this channel (see findNoticeChannel).
 *
 * All I/O goes through `deps`, so tests use fakes. deps contract:
 *   discord: listGuildChannels, createCategory, createTextChannel, getChannel, grantChannelAccess, postMessage
 *   dashboardExists(email) -> boolean
 *   claim({email, name, plan, amount, currency, country, source}) -> boolean   (true only for the caller that took the row)
 *   markPosted({email, channelId, messageId, day}), markFailed({email, error}), markDone(email), setChannel({email, channelId})
 *   listPending({since}) -> rows, claimReminder({email, day}) -> boolean, releaseReminder({email, day})
 */
import crypto from 'node:crypto';
import { buildChannelName, createClientChannel } from './channelPlacement.js';
import { buildPaidMessage, istDateLabel, istDayKey } from './messages.js';

const EMAIL_RE = /^[^\s@()<>]+@[^\s@()<>]+\.[^\s@()<>]+$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const errMessage = (e) => String(e?.message || e).slice(0, 300);
const is404 = (e) => e?.status === 404 || e?.statusCode === 404 || e?.code === 404;

// No client number or user id yet: the last 4 of a hash of the email keeps two "Priya" channels apart.
function noticeChannelName({ name, email, plan, country }) {
  return buildChannelName({ name, email, plan, country, userId: crypto.createHash('sha1').update(email).digest('hex') });
}

async function makeChannel({ deps, config, row, ctx }) {
  if (!ctx.channels) ctx.channels = (await deps.discord.listGuildChannels(config.guildId)) || [];
  const made = await createClientChannel({
    discord: deps.discord,
    guildId: config.guildId,
    channels: ctx.channels,
    baseName: config.categoryName,
    max: config.categoryMaxChannels,
    name: noticeChannelName(row),
    topic: `Dashboard needed for ${String(row.name || 'client').slice(0, 80)}`,
    viewerIds: config.linkedinCoverLetterUserIds,
    botUserId: config.botUserId,
  });
  return made.id;
}

/**
 * @param {{deps: object, config: object, input: {email: string, name: string, plan?: string, amount?: number|null,
 *   currency?: string, country?: string, source?: string}, now?: Date}} p
 * @returns {Promise<{status: 'notified'|'exists'|'invalid'|'failed', [k: string]: any}>}
 */
export async function notifyPaid({ deps, config, input, now = new Date() }) {
  const email = String(input?.email || '').trim().toLowerCase();
  const name = String(input?.name || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!EMAIL_RE.test(email)) return { status: 'invalid', error: 'a valid email is required' };
  if (!name) return { status: 'invalid', error: 'name is required' };
  // Brakes and missing setup are "failed", not final, so the caller retries once they are fixed.
  if (!config.enabled) return { status: 'failed', error: 'bot is disabled' };
  if (config.dryRun) return { status: 'failed', error: 'bot is in dry run' };
  if (!config.linkedinCoverLetterUserIds.length) return { status: 'failed', error: 'DISCORD_PRANJAL_USER_IDS is not set' };

  if (await deps.dashboardExists(email)) return { status: 'exists', reason: 'dashboard' };

  const row = {
    email,
    name,
    plan: String(input.plan || '').slice(0, 40),
    amount: Number.isFinite(Number(input.amount)) && Number(input.amount) > 0 ? Number(input.amount) : null,
    currency: String(input.currency || '').slice(0, 8),
    country: String(input.country || '').slice(0, 30),
    source: String(input.source || '').slice(0, 40),
  };
  if (!(await deps.claim(row))) return { status: 'exists', reason: 'already notified' };

  try {
    const channelId = await makeChannel({ deps, config, row, ctx: {} });
    const msg = buildPaidMessage({
      clientName: row.name, clientEmail: email, plan: row.plan, amount: row.amount, currency: row.currency,
      country: row.country, source: row.source, assigneeUserIds: config.linkedinCoverLetterUserIds, dateLabel: istDateLabel(now),
    });
    await deps.discord.grantChannelAccess(channelId, msg.allowedUserIds);
    const sent = await deps.discord.postMessage(channelId, { content: msg.content, components: msg.components, allowedUserIds: msg.allowedUserIds });
    await deps.markPosted({ email, channelId, messageId: sent?.id || '', day: istDayKey(now) });
    return { status: 'notified', channelId };
  } catch (e) {
    try {
      await deps.markFailed({ email, error: errMessage(e) });
    } catch (markErr) {
      console.error('[paid-notice] markFailed failed:', errMessage(markErr));
    }
    return { status: 'failed', error: errMessage(e) };
  }
}

/**
 * One reminder per client per IST day, in the same channel, until the dashboard exists.
 * @param {{deps: object, config: object, now?: Date}} p
 */
export async function remindPaid({ deps, config, now = new Date() }) {
  const out = { checked: 0, reminded: 0, done: 0, failed: 0 };
  if (!config.enabled || config.dryRun || !config.linkedinCoverLetterUserIds.length) return out;
  const day = istDayKey(now);
  const rows = (await deps.listPending({ since: new Date(now.getTime() - config.newClientWindowDays * DAY_MS) })) || [];
  const ctx = {};
  for (const row of rows) {
    out.checked++;
    try {
      if (await deps.dashboardExists(row.email)) {
        await deps.markDone(row.email);
        out.done++;
        continue;
      }
      if (out.reminded >= config.maxMessagesPerRun) break;
      if (!(await deps.claimReminder({ email: row.email, day }))) continue;
      try {
        let channelId = row.channelId;
        let alive = false;
        if (channelId) {
          try {
            await deps.discord.getChannel(channelId);
            alive = true;
          } catch (e) {
            if (!is404(e)) throw e;
          }
        }
        if (!alive) {
          channelId = await makeChannel({ deps, config, row, ctx });
          await deps.setChannel({ email: row.email, channelId });
        }
        const msg = buildPaidMessage({
          clientName: row.name, clientEmail: row.email, plan: row.plan, amount: row.amount, currency: row.currency,
          country: row.country, source: row.source, assigneeUserIds: config.linkedinCoverLetterUserIds, dateLabel: istDateLabel(now), reminder: true,
        });
        await deps.discord.grantChannelAccess(channelId, msg.allowedUserIds);
        await deps.discord.postMessage(channelId, { content: msg.content, components: msg.components, allowedUserIds: msg.allowedUserIds });
        out.reminded++;
      } catch (e) {
        await deps.releaseReminder({ email: row.email, day });
        throw e;
      }
    } catch (e) {
      out.failed++;
      console.error('[paid-notice] reminder failed:', errMessage(e));
    }
  }
  return out;
}
