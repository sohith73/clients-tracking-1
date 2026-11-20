/**
 * Daily onboarding sweep. All I/O goes through `deps`, so tests use fakes.
 *
 * deps contract:
 *   discord: {
 *     listGuildChannels(guildId) -> channel[]            // {id, name, type}
 *     createTextChannel(guildId, { name }) -> channel
 *     createThread(channelId, { name }) -> { id }
 *     getChannel(id) -> { id, thread_metadata?: { archived } }
 *     unarchiveThread(threadId)
 *     postMessage(channelId, { content, components, allowedUserIds }) -> { id }
 *     listGuildMembers(guildId) -> member[]
 *   }
 *   listCandidateClients({ since, excludePlans }) -> [{ user, onboardingJob|null, csmPortalUser|null, resumeMakerPortalUser|null }]
 *   getThread(userId) -> { threadId, channelId } | null
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
  buildThreadName,
  istDateLabel,
  istDayKey,
} from './messages.js';
import { resolveCsmDiscordId } from './csmMatch.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function errMessage(e) {
  return String(e?.message || e).slice(0, 300);
}

function is404(e) {
  return e?.status === 404 || e?.statusCode === 404 || e?.code === 404;
}

/** Find, else create, the #clients channel. Returns id or null (dry run, nothing to create). */
async function resolveChannel({ discord, config, dryRun }) {
  if (config.clientsChannelId) return config.clientsChannelId;
  const channels = (await discord.listGuildChannels(config.guildId)) || [];
  const found = channels.find(
    (c) => (c.type === undefined || c.type === 0) && String(c.name).toLowerCase() === config.clientsChannelName
  );
  if (found) return found.id;
  if (!config.allowCreateChannel) {
    throw new Error(`Channel #${config.clientsChannelName} not found and channel creation is disabled`);
  }
  if (dryRun) return null;
  const created = await discord.createTextChannel(config.guildId, { name: config.clientsChannelName });
  return created.id;
}

/** Reuse the stored thread, unarchive it, or recreate it if Discord says it is gone. */
async function ensureThread({ deps, config, channelId, user, onboardingJob }) {
  const userId = String(user._id);
  const stored = await deps.getThread(userId);
  if (stored?.threadId) {
    try {
      const ch = await deps.discord.getChannel(stored.threadId);
      if (ch?.thread_metadata?.archived) await deps.discord.unarchiveThread(stored.threadId);
      return stored.threadId;
    } catch (e) {
      if (!is404(e)) throw e;
      // Thread was deleted in Discord: fall through and make a new one.
    }
  }
  const thread = await deps.discord.createThread(channelId, {
    name: buildThreadName(user.name || user.email, onboardingJob?.clientNumber),
  });
  await deps.saveThread({
    userId,
    clientEmail: user.email || '',
    threadId: thread.id,
    channelId,
    guildId: config.guildId,
  });
  return thread.id;
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
    channelId: null,
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

  summary.channelId = await resolveChannel({ discord: deps.discord, config, dryRun });

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
          summary.plan.push({ userId, email: user.email || '', need, csmMatched, resumeMakerMatched, wouldTag: message.allowedUserIds });
        }
        used++;
        continue;
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
          threadId = await ensureThread({ deps, config, channelId: summary.channelId, user, onboardingJob: w.onboardingJob });
        }
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
