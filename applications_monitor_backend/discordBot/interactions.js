import { isResumeLinked, isLinkedInDone, isCoverLetterDone } from './needs.js';

const CUSTOM_ID_RE = /^onb:(resume|linkedin|cover):([a-f0-9]{24})$/;
const EPHEMERAL = 64;

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
  resume: (name, by, day) => `Resume done and linked for **${name}**. Confirmed by <@${by}> on ${day}.`,
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

export async function handleInteraction({ interaction, deps }) {
  try {
    if (!interaction || typeof interaction !== 'object') return ephemeral('Not supported.');
    if (interaction.type === 1) return { type: 1 };
    if (interaction.type !== 3) return ephemeral('Not supported.');

    const match = CUSTOM_ID_RE.exec(String(interaction.data?.custom_id ?? ''));
    if (!match) return ephemeral('Not supported.');
    const [, need, userId] = match;

    const clickerId = String(interaction.member?.user?.id ?? interaction.user?.id ?? '');
    if (!/^\d{5,25}$/.test(clickerId)) return ephemeral('Only the CSM team can confirm this.');
    if (!(await deps.canClick(clickerId))) return ephemeral('Only the CSM team can confirm this.');

    const user = await deps.loadUser(userId);
    if (!user) return ephemeral("I can't find this client anymore.");
    const name = sanitizeName(user.name || user.userName || user.email);

    // Never trust the click: re-check the database.
    let done = false;
    if (need === 'resume') {
      done = Boolean(isResumeLinked(user));
    } else {
      const job = user.email ? await deps.loadOnboardingJob(user.email) : null;
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

    return {
      type: 7,
      data: {
        content: RESOLVED_TEXT[need](name, clickerId, istDay(deps.now ? deps.now() : new Date())),
        embeds: [],
        components: [],
        allowed_mentions: { parse: [] },
      },
    };
  } catch (err) {
    console.error('[discord-interactions] handler error:', err?.message);
    return ephemeral('Something went wrong, please try again.');
  }
}

export { NEED_LABEL };
