/**
 * Daily onboarding sweep. All I/O goes through `deps`, so tests use fakes.
 *
 * deps contract:
 *   discord: {
 *     listGuildChannels(guildId) -> channel[]            // {id, name, type}
 *     createCategory(guildId, { name }) -> { id }
 *     createTextChannel(guildId, { name, topic, parentId }) -> { id }
 *     getChannel(id) -> { id }                            // 404 means the client channel was deleted
 *     grantChannelAccess(channelId, userIds)               // private channel: let tagged users in
 *     postMessage(channelId, { content, components, allowedUserIds }) -> { id }
 *     listGuildMembers(guildId) -> member[]
 *   }
 *   listCandidateClients({ since, excludePlans }) -> [{ user, onboardingJob|null, csmPortalUser|null, resumeMakerPortalUser|null }]
 *   getThread(userId) -> { threadId, channelId } | null   // threadId is the client's text channel id
 *   saveThread({ userId, clientEmail, threadId, channelId, guildId })
 *   tryClaimAlert({ userId, need, istDay }) -> boolean
 *       true only if THIS call created the unique row. A row with status
 *       'failed' is claimable again (so a failed post can be retried the same
 *       day); rows with any other status are not.
 *   markAlert({ userId, need, istDay, status, messageId, threadId, error })
 *   countAlertDays({ userId, need }) -> number
 *
 * The flow is sequential per client. While the resume is pending the sweep
 * posts only the resume message (tagging the resume maker, else the CSM). Once
 * the resume is linked it posts the LinkedIn/cover letter message for what is
 * still pending. The click handler posts that message right after a resume
 * click and the final "start applications" message; the sweep never posts the
 * final one.
 *
 * Dry run never claims or marks anything and never calls a Discord write
 * method. It only collects `plan`.
 */
import { isLinkedInDone, isCoverLetterDone, isNewClient, isResumeLinked, planNeeds } from './needs.js';
import {
  buildFollowUpMessage,
  buildResumeMessage,
  istDateLabel,
  istDayKey,
} from './messages.js';
import { resolveCsmDiscordId } from './csmMatch.js';
import { buildChannelName, createClientChannel } from './channelPlacement.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function errMessage(e) {
  return String(e?.message || e).slice(0, 300);
}

function is404(e) {
  return e?.status === 404 || e?.statusCode === 404 || e?.code === 404;
}

/**
 * One text channel per client. Reuse the stored one; if Discord says it is gone
 * (404), make a new one. `ctx` holds the cached guild channel list and the
 * number of channels created so far this run.
 */
async function ensureClientChannel({ deps, config, user, onboardingJob, tracking, userId, ctx, viewerIds }) {
  const stored = await deps.getThread(userId);
  const wantedName = clientChannelName({ user, onboardingJob, tracking, userId });
  if (stored?.threadId) {
    try {
      const existing = await deps.discord.getChannel(stored.threadId);
      // Older channels were named without plan and country: bring them to the current format.
      if (existing?.name && existing.name !== wantedName && typeof deps.discord.renameChannel === 'function') {
        try {
          await deps.discord.renameChannel(stored.threadId, wantedName);
        } catch (e) {
          console.error('[discord-onboarding] rename failed:', errMessage(e));
        }
      }
      return stored.threadId;
    } catch (e) {
      if (!is404(e)) throw e;
      // Channel was deleted in Discord: fall through and make a new one.
    }
  }
  if (!ctx.channels) ctx.channels = (await deps.discord.listGuildChannels(config.guildId)) || [];
  const made = await createClientChannel({
    discord: deps.discord,
    guildId: config.guildId,
    channels: ctx.channels,
    baseName: config.categoryName,
    max: config.categoryMaxChannels,
    name: wantedName,
    topic: `Onboarding for ${String(user.name || 'client').slice(0, 80)}`,
    viewerIds,
    botUserId: config.botUserId,
  });
  if (made.created) ctx.created++;
  await deps.saveThread({
    userId,
    clientEmail: user.email || '',
    threadId: made.id,
    channelId: made.categoryId,
    guildId: config.guildId,
  });
  return made.id;
}

const CURRENCY_COUNTRY = { GBP: 'uk', USD: 'us', AUD: 'au', CAD: 'ca', EUR: 'eu', INR: 'in' };

function clientChannelName({ user, onboardingJob, tracking, userId }) {
  const country = tracking?.clientCountry
    || CURRENCY_COUNTRY[String(user.currency || '').toUpperCase()]
    || '';
  return buildChannelName({
    clientNumber: tracking?.clientNumber ?? onboardingJob?.clientNumber,
    name: user.name,
    email: user.email,
    userId,
    plan: user.planType,
    country,
  });
}

/**
 * @param {{deps: object, config: object, now?: Date}} p
 */
export async function runOnboardingSweep({ deps, config, now = new Date() }) {
  if (!config.enabled) return { skipped: 'disabled' };

  const dryRun = config.dryRun !== false;
  const istDay = istDayKey(now);
  const dateLabel = istDateLabel(now);
  const summary = {
    dryRun,
    considered: 0,
    posted: 0,
    skippedLinked: 0,
    skippedAlreadyAlerted: 0,
    skippedMaxDays: 0,
    failed: 0,
    capped: false,
    plan: [],
    errors: [],
  };

  const since = new Date(now.getTime() - config.newClientWindowDays * DAY_MS);
  const raw = (await deps.listCandidateClients({ since, excludePlans: config.excludePlans })) || [];
  const candidates = raw.filter(
    (c) =>
      c?.user &&
      !config.excludePlans.includes(c.user.planType) &&
      isNewClient(c.user, now, config.newClientWindowDays)
  );
  summary.considered = candidates.length;

  // Work out pending needs per client first, so we only load members when needed.
  const work = candidates.map((c) => {
    const needs = planNeeds(c.user.planType);
    const pending = [];
    if (isResumeLinked(c.user)) {
      summary.skippedLinked++;
      // Sequential: LinkedIn and cover letter only after the resume is linked.
      if (needs.linkedin && !isLinkedInDone(c.user, c.onboardingJob)) pending.push('linkedin');
      if (needs.coverLetter && !isCoverLetterDone(c.user, c.onboardingJob)) pending.push('coverLetter');
    } else {
      pending.push('resume');
    }
    return { ...c, pending };
  });
  const active = work.filter((w) => w.pending.length > 0);
  if (active.length === 0) return summary;

  const needsCsm = active.some(
    (w) => !w.csmPortalUser?.discordUserId || (w.pending.includes('resume') && !w.resumeMakerPortalUser?.discordUserId)
  );
  let members = [];
  if (needsCsm) {
    try {
      members = (await deps.discord.listGuildMembers(config.guildId, { limit: 5000 })) || [];
    } catch (e) {
      summary.errors.push({ userId: '', error: `member list failed: ${errMessage(e)}` });
    }
  }

  const ctx = { channels: null, created: 0 };

  let used = 0; // messages posted (or planned in dry run), for the safety cap
  outer: for (const w of active) {
    const user = w.user;
    const userId = String(user._id);
    let threadId = null;
    try {
      const csmName = w.onboardingJob?.csmName || w.csmPortalUser?.name || '';
      const csm = resolveCsmDiscordId({ portalUser: w.csmPortalUser, members, fallbackName: csmName });
      const csmMatched = Boolean(csm.userId);

      // Drop needs that hit the reminder limit.
      const todo = [];
      for (const need of w.pending) {
        if (config.reminderMaxDays > 0) {
          const days = await deps.countAlertDays({ userId, need });
          if (days >= config.reminderMaxDays) {
            summary.skippedMaxDays++;
            continue;
          }
        }
        todo.push(need);
      }
      if (todo.length === 0) continue;
      if (used >= config.maxMessagesPerRun) {
        summary.capped = true;
        break outer;
      }

      let message;
      let resumeMakerMatched = false;
      if (todo[0] === 'resume') {
        const makerName = w.onboardingJob?.resumeMakerName || w.resumeMakerPortalUser?.name || '';
        const maker = resolveCsmDiscordId({ portalUser: w.resumeMakerPortalUser, members, fallbackName: makerName });
        resumeMakerMatched = Boolean(maker.userId);
        message = buildResumeMessage({
          clientName: user.name,
          clientEmail: user.email,
          userId,
          csmDiscordId: csm.userId,
          csmName,
          resumeMakerDiscordId: maker.userId,
          dateLabel,
          loginUsername: w.onboardingJob?.dashboardCredentials?.username,
          loginPassword: w.onboardingJob?.dashboardCredentials?.password,
        });
      } else {
        message = buildFollowUpMessage({
          needs: todo.map((n) => (n === 'coverLetter' ? 'cover' : n)),
          clientName: user.name,
          clientEmail: user.email,
          planType: user.planType,
          userId,
          csmDiscordId: csm.userId,
          dateLabel,
          assigneeUserIds: config.linkedinCoverLetterUserIds,
        });
      }

      if (dryRun) {
        for (const need of todo) {
          summary.plan.push({ userId, email: user.email || '', need, channelName: clientChannelName({ user, onboardingJob: w.onboardingJob, tracking: w.tracking, userId }), csmMatched, resumeMakerMatched, wouldTag: message.allowedUserIds });
        }
        used++;
        continue;
      }

      // Stop before claiming anything when this client needs a new channel and the run's cap is used.
      if (ctx.created >= config.maxNewChannelsPerRun && !(await deps.getThread(userId))?.threadId) {
        summary.capped = true;
        break outer;
      }

      // One alert row per need and day. Only post for the needs this run claimed.
      const claimedNeeds = [];
      for (const need of todo) {
        if (await deps.tryClaimAlert({ userId, need, istDay })) claimedNeeds.push(need);
        else summary.skippedAlreadyAlerted++;
      }
      if (claimedNeeds.length === 0) continue;
      if (claimedNeeds.length !== todo.length && todo[0] !== 'resume') {
        message = buildFollowUpMessage({
          needs: claimedNeeds.map((n) => (n === 'coverLetter' ? 'cover' : n)),
          clientName: user.name,
          clientEmail: user.email,
          planType: user.planType,
          userId,
          csmDiscordId: csm.userId,
          dateLabel,
          assigneeUserIds: config.linkedinCoverLetterUserIds,
        });
      }
      try {
        if (!threadId) {
          threadId = await ensureClientChannel({ deps, config, user, onboardingJob: w.onboardingJob, tracking: w.tracking, userId, ctx, viewerIds: message.allowedUserIds });
        }
        // Private channels: whoever this message tags must be able to see it (idempotent, also covers reused channels).
        await deps.discord.grantChannelAccess(threadId, message.allowedUserIds);
        const sent = await deps.discord.postMessage(threadId, {
          content: message.content,
          components: message.components,
          allowedUserIds: message.allowedUserIds,
        });
        for (const need of claimedNeeds) {
          await deps.markAlert({ userId, need, istDay, status: 'sent', messageId: sent?.id || '', threadId });
        }
        summary.posted++;
        used++;
      } catch (e) {
        summary.failed++;
        summary.errors.push({ userId, error: errMessage(e) });
        for (const need of claimedNeeds) {
          try {
            await deps.markAlert({ userId, need, istDay, status: 'failed', threadId: threadId || '', error: errMessage(e) });
          } catch (markErr) {
            summary.errors.push({ userId, error: `markAlert failed: ${errMessage(markErr)}` });
          }
        }
      }
    } catch (e) {
      // Anything outside the post step (count, claim): isolate to this client.
      summary.failed++;
      summary.errors.push({ userId, error: errMessage(e) });
    }
  }
  return summary;
}
