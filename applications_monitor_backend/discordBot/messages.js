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

/**
 * Stateless custom_id contract (Discord caps custom_id at 100 chars):
 *   onb:<need>:<userId 24 hex>:<csmId digits | 0>   real flow, 0 means CSM unknown
 *   onb:<need>:<userId 24 hex>                       legacy, CSM unknown
 *   tst:<step>:<csmId[,csmId...]>:<resumeMakerId digits> test flow, never touches the database
 * need and step are one of resume, linkedin, cover.
 */
export const CUSTOM_ID_RE = /^onb:(resume|linkedin|cover):([a-f0-9]{24})(?::(0|\d{5,25}))?$/;
export const TEST_CUSTOM_ID_RE = /^tst:(resume|linkedin|cover):(\d{5,25}(?:,\d{5,25})*):(\d{5,25})$/;

const SNOWFLAKE_RE = /^\d{5,25}$/;

/** Team dashboard linked from every message. Wrapped in <> so Discord shows no embed. */
export const DASHBOARD_URL = 'https://portal.flashfirejobs.com/';
const dashboardLine = () => `\nDashboard: <${DASHBOARD_URL}>`;

/** @param {unknown} id @returns {string|null} the id when it is a plausible Discord snowflake */
function snowflakeOrNull(id) {
  const s = String(id ?? '').trim();
  return SNOWFLAKE_RE.test(s) ? s : null;
}

/**
 * @param {{need: 'resume'|'linkedin'|'cover', userId: string, csmDiscordId?: string|null}} p
 * @returns {string}
 */
export function buildCustomId({ need, userId, csmDiscordId }) {
  return `onb:${need}:${userId}:${snowflakeOrNull(csmDiscordId) || '0'}`;
}

/**
 * @param {{step: 'resume'|'linkedin'|'cover', csmDiscordId: string, resumeMakerId: string}} p
 * @returns {string}
 */
export function buildTestCustomId({ step, csmDiscordId, resumeMakerId }) {
  return `tst:${step}:${csmDiscordId}:${resumeMakerId}`;
}

/**
 * @param {unknown} raw
 * @returns {{family: 'onb', need: string, userId: string, csmDiscordId: string|null}
 *   | {family: 'tst', need: string, csmDiscordId: string, resumeMakerId: string} | null}
 *   null when the id is not one of ours or is malformed
 */
export function parseCustomId(raw) {
  const id = String(raw ?? '');
  if (id.length > 100) return null;
  const m = CUSTOM_ID_RE.exec(id);
  if (m) return { family: 'onb', need: m[1], userId: m[2], csmDiscordId: m[3] && m[3] !== '0' ? m[3] : null };
  const t = TEST_CUSTOM_ID_RE.exec(id);
  if (t) return { family: 'tst', need: t[1], csmDiscordId: t[2], csmDiscordIds: t[2].split(','), resumeMakerId: t[3] };
  return null;
}

function button(label, customId) {
  return { type: 2, style: 1, label, custom_id: customId.slice(0, 100) };
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
 * Stage 1. Tags the resume maker, else the CSM, else prints the CSM name.
 * @param {{clientName: string, clientEmail?: string, userId: string, csmDiscordId?: string|null, csmName?: string,
 *   resumeMakerDiscordId?: string|null, dateLabel: string}} p
 * @returns {{content: string, components: object[], allowedUserIds: string[]}}
 */
/** Dashboard login shown in the client's private channel. Empty when there is no password to show. */
function loginLine(username, password) {
  const u = neutralizeMentions(String(username ?? '').trim()).slice(0, 120);
  const p = neutralizeMentions(String(password ?? '').trim()).slice(0, 120);
  if (!u || !p) return '';
  return `\nDashboard login: ${u} / ${p}`;
}

export function buildResumeMessage({ clientName, clientEmail, userId, csmDiscordId, csmName, resumeMakerDiscordId, dateLabel, loginUsername, loginPassword }) {
  const csmId = csmDiscordId && /^\d+$/.test(String(csmDiscordId)) ? String(csmDiscordId) : null;
  const makerId = resumeMakerDiscordId && /^\d+$/.test(String(resumeMakerDiscordId)) ? String(resumeMakerDiscordId) : null;
  const tagId = makerId || csmId;
  const tagPart = tagId
    ? `<@${tagId}>`
    : `CSM not matched: ${neutralizeMentions(csmName || 'unassigned')}`;
  return {
    content: `Resume not made for ${who(clientName, clientEmail)}. ${dateLabel}. ${tagPart}${dashboardLine()}${loginLine(loginUsername, loginPassword)}`,
    components: [{ type: 1, components: [button('Resume done', buildCustomId({ need: 'resume', userId, csmDiscordId: csmId }))] }],
    allowedUserIds: tagId ? [tagId] : [],
  };
}

const FOLLOW_UP_LABEL = { linkedin: 'LinkedIn done', cover: 'Cover letter done' };

/**
 * Stage 2. Tags every LinkedIn/cover letter assignee, one button per need.
 * @param {{needs: Array<'linkedin'|'cover'>, clientName: string, clientEmail?: string, planType?: string, userId?: string,
 *   csmDiscordId?: string|null, dateLabel: string, assigneeUserIds?: string[], testPrefix?: boolean,
 *   customIdFor?: (need: string) => string}} p
 * @returns {{content: string, components: object[], allowedUserIds: string[]}}
 */
export function buildFollowUpMessage({ needs, clientName, clientEmail, planType, userId, csmDiscordId, dateLabel, assigneeUserIds, testPrefix, customIdFor }) {
  const wanted = ['linkedin', 'cover'].filter((n) => (needs || []).includes(n));
  const ids = cleanIds(assigneeUserIds);
  const mentions = ids.length ? ids.map((id) => `<@${id}>`).join(' ') : 'No assignee configured';
  const plan = planType ? ` [${neutralizeMentions(planType)}]` : '';
  const what = wanted.length === 2
    ? 'LinkedIn and cover letter not done'
    : wanted[0] === 'cover' ? 'Cover letter not done' : 'LinkedIn not done';
  const idFor = customIdFor || ((n) => buildCustomId({ need: n, userId, csmDiscordId }));
  const prefix = testPrefix ? '[TEST] ' : '';
  return {
    content: `${prefix}${what} for ${who(clientName, clientEmail)}${plan}. ${dateLabel}. ${mentions}${dashboardLine()}`,
    components: wanted.length ? [{ type: 1, components: wanted.map((n) => button(FOLLOW_UP_LABEL[n], idFor(n))) }] : [],
    allowedUserIds: ids,
  };
}

/** @param {object} p see buildFollowUpMessage fields */
export function buildLinkedInMessage(p) {
  return buildFollowUpMessage({ ...p, needs: ['linkedin'] });
}

/** @param {object} p see buildFollowUpMessage fields */
export function buildCoverLetterMessage(p) {
  return buildFollowUpMessage({ ...p, needs: ['cover'] });
}

/**
 * Stage 3. Tells the CSM everything the plan needs is done. No button.
 * csmDiscordIds (array) wins over csmDiscordId; the test flow tags every CSM it was given.
 * @param {{clientName: string, clientEmail?: string, planType?: string, needs: {linkedin: boolean, coverLetter: boolean},
 *   csmDiscordId?: string|null, csmDiscordIds?: string[], csmName?: string, testPrefix?: boolean}} p
 * @returns {{content: string, components: object[], allowedUserIds: string[]}}
 */
export function buildFinalMessage({ clientName, clientEmail, planType, needs, csmDiscordId, csmDiscordIds, csmName, testPrefix }) {
  const csmIds = [...new Set((csmDiscordIds?.length ? csmDiscordIds : [csmDiscordId]).map(snowflakeOrNull).filter(Boolean))];
  const items = needs?.linkedin && needs?.coverLetter
    ? 'Resume, LinkedIn and cover letter are done'
    : needs?.linkedin ? 'Resume and LinkedIn are done' : 'The resume is done';
  const plan = planType ? `the ${neutralizeMentions(planType)} plan` : 'the plan';
  const csmPart = csmIds.length ? csmIds.map((id) => `<@${id}>`).join(' ') : `CSM not matched: ${neutralizeMentions(csmName || 'unassigned')}`;
  const prefix = testPrefix ? '[TEST] ' : '';
  const email = clientEmail ? ` (${neutralizeMentions(clientEmail)})` : '';
  return {
    content: `${prefix}Please start the applications for **${neutralizeMentions(clientName || 'this client')}**${email}. ${items} as required by ${plan}. ${csmPart}${dashboardLine()}`,
    components: [],
    allowedUserIds: csmIds,
  };
}

const SOURCE_LABEL = { 'crm-paid': 'CRM, lead marked paid', payment: 'payment received', stripe: 'Stripe payment' };

/**
 * Tells the dashboard people a client has paid and needs a dashboard. Nothing is created for them.
 * Client data can never ping: only `assigneeUserIds` are mentioned.
 * @param {{clientName: string, clientEmail: string, plan?: string, amount?: number|null, currency?: string, country?: string,
 *   source?: string, assigneeUserIds: string[], dateLabel: string, reminder?: boolean}} p
 * @returns {{content: string, components: object[], allowedUserIds: string[]}}
 */
export function buildPaidMessage({ clientName, clientEmail, plan, amount, currency, country, source, assigneeUserIds, dateLabel, reminder = false }) {
  const ids = cleanIds(assigneeUserIds);
  const tags = ids.map((id) => `<@${id}>`).join(' ');
  const paid = amount ? `${neutralizeMentions(currency || '')} ${amount}`.trim() : 'amount not recorded';
  const details = [
    `Plan: ${neutralizeMentions(plan || 'not recorded')}`,
    `Paid: ${paid}`,
    country ? `Country: ${neutralizeMentions(country)}` : '',
    source ? `Source: ${SOURCE_LABEL[source] || neutralizeMentions(String(source).slice(0, 40))}` : '',
  ].filter(Boolean).join('. ');
  const head = reminder
    ? `Reminder: dashboard still not created for ${who(clientName, clientEmail)}. ${dateLabel}.`
    : `Payment received. Please create the dashboard for ${who(clientName, clientEmail)}. ${dateLabel}.`;
  return {
    content: `${head} ${tags}\n${details}.\nCreate the client in the tracking portal with this email. Onboarding continues in this channel once it exists.`,
    components: [],
    allowedUserIds: ids,
  };
}
