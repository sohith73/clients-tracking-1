/**
 * Pure builders for the Discord messages. Client data can never ping anyone:
 * every mention-like sequence in it gets a zero-width space, and allowedUserIds
 * lists only the ids we mean to mention.
 */

const ZWSP = '​';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/**
 * @param {unknown} text
 * @returns {string} text with @everyone, @here and <@...> / <#...> / <@&...> defanged
 */
export function neutralizeMentions(text) {
  return String(text ?? '')
    .replace(/@(everyone|here)/gi, `@${ZWSP}$1`)
    .replace(/<(?=[@#])/g, `<${ZWSP}`);
}

/** @param {Date} now @returns {Date} a Date whose UTC fields hold IST wall time */
function istShifted(now) {
  return new Date(now.getTime() + IST_OFFSET_MS);
}

/** @param {Date} now @returns {string} e.g. "18 Nov 2026" in IST */
export function istDateLabel(now) {
  const d = istShifted(now);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** @param {Date} now @returns {string} "YYYY-MM-DD" in IST */
export function istDayKey(now) {
  return istShifted(now).toISOString().slice(0, 10);
}

/**
 * @param {string} clientName
 * @param {number|string|null} [clientNumber]
 * @returns {string} thread name, max 100 chars, single line, no mentions
 */
export function buildThreadName(clientName, clientNumber) {
  const base = String(clientName || 'Client')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[@<>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim() || 'Client';
  const suffix = clientNumber !== undefined && clientNumber !== null && clientNumber !== '' ? ` #${clientNumber}` : '';
  const safeSuffix = suffix.replace(/[\r\n@<>]/g, '');
  const room = 100 - safeSuffix.length;
  return `${base.slice(0, Math.max(1, room)).trim()}${safeSuffix}`.slice(0, 100);
}

function button(label, customId) {
  return [{ type: 1, components: [{ type: 2, style: 1, label, custom_id: customId.slice(0, 100) }] }];
}

function who(clientName, clientEmail) {
  const name = neutralizeMentions(clientName || 'Unnamed client');
  const email = clientEmail ? ` (${neutralizeMentions(clientEmail)})` : '';
  return `**${name}**${email}`;
}

function cleanIds(ids) {
  return [...new Set((ids || []).map(String).filter((id) => /^\d+$/.test(id)))];
}

/**
 * @param {{clientName: string, clientEmail?: string, userId: string, csmDiscordId?: string|null, csmName?: string, dateLabel: string}} p
 * @returns {{content: string, components: object[], allowedUserIds: string[]}}
 */
export function buildResumeMessage({ clientName, clientEmail, userId, csmDiscordId, csmName, dateLabel }) {
  const csmId = csmDiscordId && /^\d+$/.test(String(csmDiscordId)) ? String(csmDiscordId) : null;
  const csmPart = csmId
    ? `<@${csmId}>`
    : `CSM not matched: ${neutralizeMentions(csmName || 'unassigned')}`;
  return {
    content: `Resume not made for ${who(clientName, clientEmail)}. ${dateLabel}. ${csmPart}`,
    components: button('Resume done and linked', `onb:resume:${userId}`),
    allowedUserIds: csmId ? [csmId] : [],
  };
}

function buildAssigneeMessage({ what, label, key, clientName, clientEmail, planType, userId, dateLabel, assigneeUserIds }) {
  const ids = cleanIds(assigneeUserIds);
  const mentions = ids.length ? ids.map((id) => `<@${id}>`).join(' ') : 'No assignee configured';
  const plan = planType ? ` [${neutralizeMentions(planType)}]` : '';
  return {
    content: `${what} for ${who(clientName, clientEmail)}${plan}. ${dateLabel}. ${mentions}`,
    components: button(label, `onb:${key}:${userId}`),
    allowedUserIds: ids,
  };
}

/** @param {object} p see buildAssigneeMessage fields */
export function buildLinkedInMessage(p) {
  return buildAssigneeMessage({ ...p, what: 'LinkedIn not done', label: 'LinkedIn done', key: 'linkedin' });
}

/** @param {object} p see buildAssigneeMessage fields */
export function buildCoverLetterMessage(p) {
  return buildAssigneeMessage({ ...p, what: 'Cover letter not done', label: 'Cover letter done', key: 'cover' });
}
