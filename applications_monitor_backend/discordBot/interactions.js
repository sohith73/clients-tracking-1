import { isResumeLinked, isLinkedInDone, isCoverLetterDone, planNeeds } from './needs.js';
import {
  buildFinalMessage,
  buildFollowUpMessage,
  buildTestCustomId,
  istDateLabel,
  parseCustomId,
} from './messages.js';

const EPHEMERAL = 64;
const CONTENT_MAX = 2000;
const TEST_TAG = '[TEST] ';

const NEED_LABEL = {
  resume: 'resume',
  linkedin: 'LinkedIn optimization',
  cover: 'cover letter',
};

const NOT_DONE_TEXT = {
  resume: (name) => `I do not see a resume linked for ${name} yet. Link it in the dashboard, then click again.`,
  linkedin: (name) => `I do not see LinkedIn optimization marked done for ${name} yet. Finish it in the dashboard, then click again.`,
  cover: (name) => `I do not see a cover letter marked done for ${name} yet. Finish it in the dashboard, then click again.`,
};

const RESOLVED_TEXT = {
  resume: (name, by, day) => `Resume done for **${name}**. Confirmed by <@${by}> on ${day}.`,
  linkedin: (name, by, day) => `LinkedIn optimization done for **${name}**. Confirmed by <@${by}> on ${day}.`,
  cover: (name, by, day) => `Cover letter done for **${name}**. Confirmed by <@${by}> on ${day}.`,
};

/** Strip mentions and markdown control chars from client-provided text. */
export function sanitizeName(raw) {
  const text = String(raw ?? '')
    .replace(/@(everyone|here)/gi, '@\u200b$1')
    .replace(/<@/g, '<\u200b@')
    .replace(/<#/g, '<\u200b#')
    .replace(/[*_`~|>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return text || 'this client';
}

function ephemeral(content) {
  return {
    type: 4,
    data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } },
  };
}

function istDay(date) {
  const ist = new Date(date.getTime() + 5.5 * 3600 * 1000);
  return ist.toISOString().slice(0, 10);
}

/** Buttons left on the clicked message that belong to us, excluding the clicked one. */
function remainingButtons(interaction, clickedId) {
  const rows = Array.isArray(interaction.message?.components) ? interaction.message.components : [];
  const left = [];
  for (const row of rows) {
    const kept = (Array.isArray(row?.components) ? row.components : []).filter(
      (c) => c && c.type === 2 && c.custom_id !== clickedId && parseCustomId(c.custom_id)
    );
    if (kept.length) left.push({ type: 1, components: kept });
  }
  return left;
}

/** Type 7 reply. Step 2 and 3 buttons keep the original text and add one line per click. */
function updateReply({ interaction, resolvedText, keepRows, appendToOriginal }) {
  const original = interaction.message?.content;
  const content = appendToOriginal && typeof original === 'string' && original
    ? `${original}\n${resolvedText}`.slice(0, CONTENT_MAX)
    : resolvedText.slice(0, CONTENT_MAX);
  return {
    type: 7,
    data: { content, embeds: [], components: keepRows, allowed_mentions: { parse: [] } },
  };
}

/** Posts a follow-up in the clicked thread. Never throws: a verified click must stay resolved. */
async function tryPost(deps, interaction, message) {
  try {
    const channelId = String(interaction.channel_id ?? '');
    if (!deps.discord || typeof deps.discord.postMessage !== 'function') throw new Error('no discord client');
    if (!/^\d{5,25}$/.test(channelId)) throw new Error('no thread id on interaction');
    return await deps.discord.postMessage(channelId, {
      content: message.content,
      components: message.components,
      allowedUserIds: message.allowedUserIds,
    });
  } catch (err) {
    console.error('[discord-interactions] follow-up post failed:', String(err?.message || err).slice(0, 200));
    return null;
  }
}

function followNeedsFor(planType) {
  const n = planNeeds(planType);
  return { linkedin: n.linkedin, cover: n.coverLetter, list: [n.linkedin && 'linkedin', n.coverLetter && 'cover'].filter(Boolean) };
}

/** First plain email inside "(...)" in a bot message, else ''. Only used by the test flow. */
function extractEmail(content) {
  const m = /\(([^()\s@]+@[^()\s@]+\.[^()\s]+)\)/.exec(String(content ?? ''));
  return m ? m[1] : '';
}

/** Test flow: fixed Executive plan, no database, same state machine. */
async function handleTestClick({ interaction, deps, parsed, clickerId, customId }) {
  const threadName = String(interaction.channel?.name ?? '').replace(/^test[-\s]+/i, '');
  const hasName = threadName.trim() !== '';
  const name = hasName ? sanitizeName(threadName) : 'the test client';
  const day = istDay(deps.now ? deps.now() : new Date());
  const { csmDiscordId, csmDiscordIds, resumeMakerId, need } = parsed;
  // The thread's first message carries "(email)"; read it back so later messages show it too.
  const clientEmail = extractEmail(interaction.message?.content);

  if (need === 'resume') {
    const message = buildFollowUpMessage({
      needs: ['linkedin', 'cover'],
      clientName: name,
      clientEmail,
      planType: 'Executive',
      dateLabel: istDateLabel(deps.now ? deps.now() : new Date()),
      assigneeUserIds: deps.config?.linkedinCoverLetterUserIds || [],
      testPrefix: true,
      customIdFor: (n) => buildTestCustomId({ step: n, csmDiscordId, resumeMakerId }),
    });
    await tryPost(deps, interaction, message);
    return updateReply({
      interaction,
      resolvedText: `${TEST_TAG}${RESOLVED_TEXT.resume(name, clickerId, day)}`,
      keepRows: [],
      appendToOriginal: false,
    });
  }

  const keepRows = remainingButtons(interaction, customId);
  if (keepRows.length === 0) {
    await tryPost(deps, interaction, buildFinalMessage({
      clientName: name,
      clientEmail,
      planType: 'Executive',
      needs: { linkedin: true, coverLetter: true },
      csmDiscordIds,
      testPrefix: true,
    }));
  }
  return updateReply({
    interaction,
    resolvedText: `${TEST_TAG}${RESOLVED_TEXT[need](name, clickerId, day)}`,
    keepRows,
    appendToOriginal: true,
  });
}

export async function handleInteraction({ interaction, deps }) {
  try {
    if (!interaction || typeof interaction !== 'object') return ephemeral('Not supported.');
    if (interaction.type === 1) return { type: 1 };
    if (interaction.type !== 3) return ephemeral('Not supported.');

    const customId = String(interaction.data?.custom_id ?? '');
    const parsed = parseCustomId(customId);
    if (!parsed) return ephemeral('Not supported.');
    const { need } = parsed;

    const clickerId = String(interaction.member?.user?.id ?? interaction.user?.id ?? '');
    if (!/^\d{5,25}$/.test(clickerId)) return ephemeral('Only the CSM team can confirm this.');
    if (!(await deps.canClick(clickerId))) return ephemeral('Only the CSM team can confirm this.');

    // Test family: no database reads or writes at all.
    if (parsed.family === 'tst') return await handleTestClick({ interaction, deps, parsed, clickerId, customId });

    const { userId, csmDiscordId } = parsed;
    const user = await deps.loadUser(userId);
    if (!user) return ephemeral("I can't find this client anymore.");
    const name = sanitizeName(user.name || user.userName || user.email);

    // Never trust the click: re-check the database.
    let done = false;
    let job = null;
    if (need === 'resume') {
      done = Boolean(isResumeLinked(user));
    } else {
      job = user.email ? await deps.loadOnboardingJob(user.email) : null;
      done = need === 'linkedin'
        ? Boolean(isLinkedInDone(user, job))
        : Boolean(isCoverLetterDone(user, job));
    }

    if (!done) return ephemeral(NOT_DONE_TEXT[need](name));

    await deps.markResolved({
      userId,
      need: need === 'cover' ? 'coverLetter' : need,
      discordUserId: clickerId,
    });

    const now = deps.now ? deps.now() : new Date();
    const resolvedText = RESOLVED_TEXT[need](name, clickerId, istDay(now));
    const needs = followNeedsFor(user.planType);
    const finalMessage = async () => {
      if (!job && user.email && typeof deps.loadOnboardingJob === 'function') {
        try { job = await deps.loadOnboardingJob(user.email); } catch { job = null; }
      }
      return buildFinalMessage({
        clientName: name,
        clientEmail: user.email,
        planType: user.planType,
        needs: { linkedin: needs.linkedin, coverLetter: needs.cover },
        csmDiscordId,
        csmName: job?.csmName,
      });
    };

    if (need === 'resume') {
      if (needs.list.length > 0) {
        const message = buildFollowUpMessage({
          needs: needs.list,
          clientName: user.name,
          clientEmail: user.email,
          planType: user.planType,
          userId,
          csmDiscordId,
          dateLabel: istDateLabel(now),
          assigneeUserIds: deps.config?.linkedinCoverLetterUserIds || [],
        });
        const sent = await tryPost(deps, interaction, message);
        if (sent && typeof deps.recordFollowUp === 'function') {
          try {
            await deps.recordFollowUp({
              userId,
              needs: needs.list.map((n) => (n === 'cover' ? 'coverLetter' : n)),
              istDay: istDay(now),
              messageId: sent?.id || '',
              threadId: String(interaction.channel_id ?? ''),
            });
          } catch (err) {
            console.error('[discord-interactions] recordFollowUp failed:', String(err?.message || err).slice(0, 200));
          }
        }
      } else {
        await tryPost(deps, interaction, await finalMessage());
      }
      return updateReply({ interaction, resolvedText, keepRows: [], appendToOriginal: false });
    }

    const keepRows = remainingButtons(interaction, customId);
    if (keepRows.length === 0) await tryPost(deps, interaction, await finalMessage());
    return updateReply({ interaction, resolvedText, keepRows, appendToOriginal: true });
  } catch (err) {
    console.error('[discord-interactions] handler error:', err?.message);
    return ephemeral('Something went wrong, please try again.');
  }
}

export { NEED_LABEL };
