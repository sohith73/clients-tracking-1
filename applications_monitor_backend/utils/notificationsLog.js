// Pure logic for the admin Notifications tab: every email Flashfire sends a
// client, in one list. No DB access here so it stays unit-testable; the routes
// in index.js run the pipelines this file builds.
//
// Where each kind of mail is recorded (all written elsewhere, read-only here):
//   daily_summary,     reminderdeliveries    dashboard backend reminder worker
//   inactivity_alert   (one row per attempt) (the alert goes to the team inbox)
//   onboarding         onboardingmailstates  dashboard backend onboarding
//                      .steps[]              sequence (resume, cover letter,
//                                            LinkedIn), sent or hand-sent
//   milestone          clientemaillogs       this service's milestone emails
//                      (category milestone)  (started, 250, 350, 700, completed)
//   inbox_alert        maildigests           dashboard backend inbox alerts
//                      (clientNotifyEligible) (interview, assignment, offer)
//
// Each source is reshaped into one row format and merged with $unionWith, so
// filters, counts and paging run in a single aggregation. "Scheduled" rows are
// computed in JS from the reminder configs and the onboarding sequences,
// because they are promises about the future, not records.
//
// Email is the only channel. Mattermost was removed on 2026-11-14; reminder
// rows written before that may say "partial", which folds into sent or failed
// by whether the email went out.

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
export const MAX_SEARCH_LENGTH = 100;

export const KINDS = ['daily_summary', 'inactivity_alert', 'onboarding', 'milestone', 'inbox_alert'];
export const STATUS_VALUES = ['all', 'sent', 'failed', 'skipped', 'scheduled'];
export const TRIGGERS = ['auto', 'manual'];

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const SEND_AT_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
// The onboarding worker stops retrying a step after this many attempts.
const ONBOARDING_MAX_ATTEMPTS = 4;

// The dashboard backend's daily reminder items and their catalogue defaults
// (Utils/reminderItems.js there). Only daily items exist today.
const REMINDER_DEFAULTS = {
  daily_summary: { enabled: true, email: true, sendAtIST: '21:30', activityGated: true },
  inactivity_alert: { enabled: false, email: true, sendAtIST: '11:00', activityGated: false },
};

/** Escape regex metacharacters so user text is matched literally. */
export function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Start of an IST calendar day ("YYYY-MM-DD") as a UTC Date, or null if the
 * string is malformed or not a real date (2026-02-31 is rejected, not rolled over).
 */
export function istDayStart(day) {
  const m = DAY_RE.exec(String(day || ''));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const utc = new Date(Date.UTC(y, mo - 1, d));
  if (utc.getUTCFullYear() !== y || utc.getUTCMonth() !== mo - 1 || utc.getUTCDate() !== d) return null;
  return new Date(utc.getTime() - IST_OFFSET_MS);
}

/** "YYYY-MM-DD" of the IST calendar day containing `now`. */
export function istDayString(now = new Date()) {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** [start, end) UTC range for today in IST. */
export function istTodayRange(now = new Date()) {
  const start = istDayStart(istDayString(now));
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

function firstString(v) {
  return Array.isArray(v) ? v[0] : v;
}

function parsePositiveInt(raw, name, fallback) {
  const v = firstString(raw);
  if (v === undefined || v === null || v === '') return { value: fallback };
  if (!/^\d+$/.test(String(v))) return { error: `${name} must be a whole number` };
  return { value: Number(v) };
}

/**
 * Validate req.query. Returns { error } (caller sends 400) or
 * { page, pageSize, status, filters } where filters = { kind, trigger, search, from, to }.
 * No from/to means every date; the tab sends today by default.
 */
export function parseDeliveryQuery(query = {}) {
  const page = parsePositiveInt(query.page, 'page', 1);
  if (page.error) return { error: page.error };
  if (page.value < 1) return { error: 'page must be 1 or higher' };

  const size = parsePositiveInt(query.pageSize, 'pageSize', DEFAULT_PAGE_SIZE);
  if (size.error) return { error: size.error };
  if (size.value < 1) return { error: 'pageSize must be 1 or higher' };
  const pageSize = Math.min(size.value, MAX_PAGE_SIZE);

  const pick = (name, allowed) => {
    const v = firstString(query[name]);
    if (v === undefined || v === null || v === '') return { value: '' };
    if (!allowed.includes(String(v))) return { error: `${name} must be one of: ${allowed.join(', ')}` };
    return { value: String(v) };
  };
  const status = pick('status', STATUS_VALUES);
  if (status.error) return { error: status.error };
  const kind = pick('kind', KINDS);
  if (kind.error) return { error: kind.error };
  const trigger = pick('trigger', TRIGGERS);
  if (trigger.error) return { error: trigger.error };

  const rawSearch = firstString(query.search);
  const search = typeof rawSearch === 'string' ? rawSearch.trim().slice(0, MAX_SEARCH_LENGTH) : '';

  const range = {};
  for (const name of ['from', 'to']) {
    const v = firstString(query[name]);
    if (v === undefined || v === null || v === '') continue;
    if (!istDayStart(v)) return { error: `${name} must be a real date in YYYY-MM-DD format` };
    range[name] = String(v);
  }
  if (range.from && range.to && range.from > range.to) {
    return { error: 'from must not be after to' };
  }

  return {
    page: page.value,
    pageSize,
    status: status.value || 'all',
    filters: { kind: kind.value, trigger: trigger.value, search, ...range },
  };
}

/** { start, end } UTC instants for the filters' IST days; either may be null. */
export function rangeOf(filters = {}) {
  return {
    start: filters.from ? istDayStart(filters.from) : null,
    end: filters.to ? new Date(istDayStart(filters.to).getTime() + DAY_MS) : null,
  };
}

/** Mongo clause for a date field inside the range, or null for "any date". */
function inRange(range) {
  if (!range?.start && !range?.end) return null;
  const c = {};
  if (range.start) c.$gte = range.start;
  if (range.end) c.$lt = range.end;
  return c;
}

const withRange = (field, range) => {
  const c = inRange(range);
  return c ? { [field]: c } : {};
};

// ---- one pipeline per source, each ending in the shared row shape -------------
//
// Row: { id, kind, item, clientEmail, clientName, to, subject, at,
//        status: sent|failed|skipped, reason, trigger: auto|manual, added, applied }

/** reminderdeliveries: daily summary and the team's no-activity alert. */
export function reminderPipeline(range) {
  return [
    { $match: withRange('at', range) },
    {
      $project: {
        _id: 0,
        id: { $concat: ['r:', { $toString: '$_id' }] },
        kind: '$itemKey',
        item: '$itemKey',
        clientEmail: { $toLower: { $ifNull: ['$clientEmail', ''] } },
        clientName: { $ifNull: ['$clientName', ''] },
        to: { $ifNull: ['$email.to', ''] },
        subject: { $ifNull: ['$subject', ''] },
        at: '$at',
        status: {
          $cond: [
            { $eq: ['$status', 'partial'] },
            { $cond: [{ $eq: ['$email.ok', true] }, 'sent', 'failed'] },
            '$status',
          ],
        },
        reason: { $ifNull: ['$reason', ''] },
        // "manual" or "manual:<operator>" from Send now; cron and the
        // threshold auto-send are automatic.
        trigger: {
          $cond: [
            { $regexMatch: { input: { $ifNull: ['$trigger', ''] }, regex: '^manual' } },
            'manual',
            'auto',
          ],
        },
        added: '$stats.added',
        applied: '$stats.applied',
      },
    },
  ];
}

/** clientemaillogs: plan milestone emails. Test sends to staff are left out. */
export function milestonePipeline(range) {
  return [
    { $match: { category: 'milestone', type: { $not: /^test_/ }, ...withRange('createdAt', range) } },
    {
      $project: {
        _id: 0,
        id: { $concat: ['m:', { $toString: '$_id' }] },
        kind: 'milestone',
        item: '$type',
        clientEmail: { $toLower: { $ifNull: ['$clientEmail', ''] } },
        clientName: '',
        to: { $ifNull: ['$toEmail', ''] },
        subject: { $ifNull: ['$subject', ''] },
        at: '$createdAt',
        status: { $cond: [{ $eq: ['$status', 'success'] }, 'sent', 'failed'] },
        reason: { $ifNull: ['$errorMessage', ''] },
        trigger: { $cond: [{ $eq: ['$meta.trigger', 'manual'] }, 'manual', 'auto'] },
        added: null,
        applied: '$snapshot.currentCount',
      },
    },
  ];
}

/**
 * onboardingmailstates: one row per step that was sent, or that failed at
 * least once without being sent. A failed step is dated by when it was due,
 * the only time the sequence records for it.
 */
export function onboardingPipeline(range) {
  const r = inRange(range);
  const sentIn = r ? { 'steps.sentAt': r } : { 'steps.sentAt': { $ne: null } };
  const failedIn = {
    'steps.sentAt': null,
    'steps.attempts': { $gt: 0 },
    'steps.error': { $nin: ['', null] },
    ...(r ? { 'steps.sendAt': r } : {}),
  };
  return [
    { $match: { 'steps.0': { $exists: true } } },
    { $unwind: '$steps' },
    { $match: { $or: [sentIn, failedIn] } },
    {
      $project: {
        _id: 0,
        id: { $concat: ['o:', { $toString: '$_id' }, ':', '$steps.key'] },
        kind: 'onboarding',
        item: '$steps.key',
        clientEmail: { $toLower: { $ifNull: ['$clientEmail', ''] } },
        clientName: { $ifNull: ['$clientName', ''] },
        to: { $ifNull: ['$paymentEmail', ''] },
        subject: { $ifNull: ['$steps.subject', ''] },
        at: { $ifNull: ['$steps.sentAt', '$steps.sendAt'] },
        status: { $cond: [{ $ne: [{ $ifNull: ['$steps.sentAt', null] }, null] }, 'sent', 'failed'] },
        reason: { $cond: [{ $ne: [{ $ifNull: ['$steps.sentAt', null] }, null] }, '', '$steps.error'] },
        trigger: { $cond: [{ $eq: ['$steps.trigger', 'manual'] }, 'manual', 'auto'] },
        added: null,
        applied: null,
      },
    },
  ];
}

/**
 * maildigests: interview / assignment / offer alerts. Sent rows are dated by
 * the send; failed and skipped ones by the digest's last update, which is when
 * the reason was written.
 */
export function inboxAlertPipeline(range) {
  const r = inRange(range);
  return [
    {
      $match: {
        clientNotifyEligible: true,
        $or: [
          r ? { clientNotifiedAt: r } : { clientNotifiedAt: { $ne: null } },
          {
            clientNotifiedAt: null,
            ...(r ? { updatedAt: r } : {}),
            $or: [{ clientNotifyError: { $nin: ['', null] } }, { clientNotifySkippedReason: { $nin: ['', null] } }],
          },
        ],
      },
    },
    {
      $project: {
        _id: 0,
        id: { $concat: ['i:', { $toString: '$_id' }] },
        kind: 'inbox_alert',
        item: { $ifNull: ['$clientNotifyCategory', ''] },
        clientEmail: { $toLower: { $ifNull: ['$ownerEmail', '$gmailEmail'] } },
        clientName: '',
        to: { $ifNull: ['$clientNotifyTo', ''] },
        // The subject of the recruiter's mail the alert was about.
        subject: { $ifNull: ['$subject', ''] },
        at: { $ifNull: ['$clientNotifiedAt', '$updatedAt'] },
        status: {
          $cond: [
            { $ne: [{ $ifNull: ['$clientNotifiedAt', null] }, null] },
            'sent',
            { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$clientNotifySkippedReason', ''] } }, 0] }, 'skipped', 'failed'] },
          ],
        },
        reason: {
          $cond: [
            { $ne: [{ $ifNull: ['$clientNotifiedAt', null] }, null] },
            '',
            {
              $cond: [
                { $gt: [{ $strLenCP: { $ifNull: ['$clientNotifySkippedReason', ''] } }, 0] },
                '$clientNotifySkippedReason',
                { $ifNull: ['$clientNotifyError', ''] },
              ],
            },
          ],
        },
        trigger: 'auto',
        added: null,
        applied: null,
      },
    },
  ];
}

const SOURCES = [
  { coll: 'reminderdeliveries', kinds: ['daily_summary', 'inactivity_alert'], build: reminderPipeline },
  { coll: 'clientemaillogs', kinds: ['milestone'], build: milestonePipeline },
  { coll: 'onboardingmailstates', kinds: ['onboarding'], build: onboardingPipeline },
  { coll: 'maildigests', kinds: ['inbox_alert'], build: inboxAlertPipeline },
];

/**
 * Match on the shared row shape for everything except status.
 * searchEmails: client emails whose tracked name matched the search, so a
 * search by name also finds milestone and inbox rows, which carry no name.
 */
export function buildRowMatch(filters = {}, searchEmails = []) {
  const match = {};
  if (filters.kind) match.kind = filters.kind;
  if (filters.trigger) match.trigger = filters.trigger;
  if (filters.search) {
    const rx = new RegExp(escapeRegex(filters.search), 'i');
    match.$or = [{ clientEmail: rx }, { clientName: rx }, { to: rx }];
    if (searchEmails.length) match.$or.push({ clientEmail: { $in: searchEmails } });
  }
  return match;
}

/**
 * The whole history query: which collection to aggregate on and the pipeline,
 * which returns one document { rows, total, counts } via $facet.
 * Sources the kind filter rules out are left out entirely.
 */
export function buildHistoryAggregation({ filters = {}, status = 'all', page = 1, pageSize = DEFAULT_PAGE_SIZE, searchEmails = [] } = {}) {
  const range = rangeOf(filters);
  const sources = SOURCES.filter((s) => !filters.kind || s.kinds.includes(filters.kind));
  const [first, ...rest] = sources;
  const pipeline = [...first.build(range)];
  for (const s of rest) pipeline.push({ $unionWith: { coll: s.coll, pipeline: s.build(range) } });

  const rowMatch = buildRowMatch(filters, searchEmails);
  if (Object.keys(rowMatch).length) pipeline.push({ $match: rowMatch });

  const statusMatch = status && status !== 'all' && status !== 'scheduled' ? [{ $match: { status } }] : [];
  pipeline.push({
    $facet: {
      rows: [...statusMatch, { $sort: { at: -1, id: -1 } }, { $skip: (page - 1) * pageSize }, { $limit: pageSize }],
      total: [...statusMatch, { $count: 'n' }],
      counts: [{ $group: { _id: '$status', n: { $sum: 1 } } }],
    },
  });
  return { coll: first.coll, pipeline };
}

/** Turn a $group-by-status result into the fixed counts shape. */
export function toCounts(groups = [], scheduled = 0) {
  const counts = { sent: 0, failed: 0, skipped: 0, scheduled };
  for (const g of groups) {
    if (g && ['sent', 'failed', 'skipped'].includes(g._id)) counts[g._id] = g.n || 0;
  }
  return counts;
}

// ---- scheduled sends ------------------------------------------------------------

/** Same rule as the dashboard backend: Mattermost-only rows now mean email on. */
function emailOn(channels, fallback) {
  if (channels?.email === true || channels?.mattermost === true) return true;
  if (channels?.email === false) return false;
  return fallback;
}

/** The instant of "HH:mm" IST on the IST day containing `day`. */
function istTimeOn(day, sendAt) {
  const m = SEND_AT_RE.exec(String(sendAt || ''));
  if (!m) return null;
  return new Date(istDayStart(istDayString(day)).getTime() + (Number(m[1]) * 60 + Number(m[2])) * 60000);
}

/**
 * Upcoming sends, soonest first:
 *   - each active client's enabled daily reminder items, by the worker's own
 *     rule: today at sendAtIST unless today's period is already decided, then
 *     tomorrow. A client with no config yet gets the catalogue defaults,
 *     because the worker gives them a config on its next tick.
 *   - onboarding steps waiting for their sendAt.
 *
 * @param {object} a
 * @param {Array} a.clients     active, unpaused dashboardtrackings rows {email, name, paymentEmail}
 * @param {Array} a.configs     clientreminderconfigs {clientEmail, items, paymentEmailOverride}
 * @param {Array} a.onboarding  onboardingmailstates with status "scheduled"
 * @param {Date}  a.now
 */
export function computeScheduled({ clients = [], configs = [], onboarding = [], now = new Date() } = {}) {
  const rows = [];
  const byEmail = new Map(configs.map((c) => [String(c.clientEmail || '').trim().toLowerCase(), c]));
  const seen = new Set();
  const today = istDayString(now);

  for (const client of clients) {
    const email = String(client.email || '').trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    const cfg = byEmail.get(email);
    for (const [key, def] of Object.entries(REMINDER_DEFAULTS)) {
      const stored = cfg && Array.isArray(cfg.items) ? cfg.items.find((i) => i && i.key === key) : null;
      // No config yet: the worker seeds one with the defaults on its next
      // tick. A config without this item (unsubscribed clients have no items
      // at all) is never picked up for it, so it is not scheduled.
      const enabled = stored ? stored.enabled === true : !cfg && def.enabled;
      if (!enabled || !emailOn(stored?.channels, def.email)) continue;
      const sendAt = SEND_AT_RE.test(String(stored?.sendAtIST || '')) ? stored.sendAtIST : def.sendAtIST;
      const decided = String(stored?.lastPeriodKey || '') === `${key}:${today}`;
      let at = istTimeOn(now, sendAt);
      if (!at) continue;
      if (decided) at = new Date(at.getTime() + DAY_MS);
      const internal = key === 'inactivity_alert';
      const to = internal
        ? 'team inbox'
        : String(cfg?.paymentEmailOverride || '').trim().toLowerCase() || String(client.paymentEmail || '').trim().toLowerCase();
      rows.push({
        id: `s:${email}:${key}`,
        kind: key,
        item: key,
        clientEmail: email,
        clientName: client.name || cfg?.clientName || '',
        to,
        subject: '',
        at,
        status: 'scheduled',
        // Why it might not go out, so "scheduled" is never read as a promise.
        reason: !to ? 'no_payment_email' : def.activityGated ? 'only_if_roles_added' : '',
        trigger: 'auto',
        dueNow: !decided && at.getTime() <= now.getTime(),
        added: null,
        applied: null,
      });
    }
  }

  for (const doc of onboarding) {
    if (doc?.status !== 'scheduled') continue;
    const email = String(doc.clientEmail || '').trim().toLowerCase();
    for (const step of Array.isArray(doc.steps) ? doc.steps : []) {
      if (!step || step.sentAt || (step.attempts || 0) >= ONBOARDING_MAX_ATTEMPTS) continue;
      const at = step.sendAt ? new Date(step.sendAt) : null;
      if (!at || Number.isNaN(at.getTime())) continue;
      rows.push({
        id: `s:o:${email}:${step.key}`,
        kind: 'onboarding',
        item: step.key,
        clientEmail: email,
        clientName: doc.clientName || '',
        to: String(doc.paymentEmail || '').toLowerCase(),
        subject: step.subject || '',
        at,
        status: 'scheduled',
        reason: step.error ? `retrying: ${step.error}` : '',
        trigger: 'auto',
        dueNow: at.getTime() <= now.getTime(),
        added: null,
        applied: null,
      });
    }
  }

  return rows.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

/** Apply the filters (kind, trigger, search, date range) to scheduled rows. */
export function filterScheduled(rows = [], filters = {}, searchEmails = []) {
  const { start, end } = rangeOf(filters);
  const rx = filters.search ? new RegExp(escapeRegex(filters.search), 'i') : null;
  const names = new Set(searchEmails);
  return rows.filter((r) => {
    if (filters.kind && r.kind !== filters.kind) return false;
    if (filters.trigger && r.trigger !== filters.trigger) return false;
    if (start && r.at < start) return false;
    if (end && r.at >= end) return false;
    if (rx && !(rx.test(r.clientEmail) || rx.test(r.clientName) || rx.test(r.to) || names.has(r.clientEmail))) return false;
    return true;
  });
}

// ---- coverage ----------------------------------------------------------------

/**
 * Does each active client get the daily summary? Covered = the item is on with
 * email, and there is an address to send it to. The rest, with why:
 *   unsubscribed      used the unsubscribe link (updatedBy "unsubscribe-link");
 *                     nobody should turn these back on
 *   switched_off      an operator turned the daily summary off
 *   no_payment_email  on, but no payment email on file, so nothing can send
 * A client with no config yet is covered: the reminder worker gives every
 * active, unpaused client the defaults (daily summary on) on its next tick.
 */
export function computeCoverage(clients = [], configs = []) {
  const byEmail = new Map();
  for (const c of configs) {
    const key = String(c.clientEmail || '').trim().toLowerCase();
    if (key) byEmail.set(key, c);
  }
  const seen = new Set();
  let covered = 0;
  const notCovered = [];
  for (const client of clients) {
    const email = String(client.email || '').trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    const cfg = byEmail.get(email);
    const item = cfg && Array.isArray(cfg.items) ? cfg.items.find((i) => i && i.key === 'daily_summary') : null;
    const base = { email, name: client.name || '', clientNumber: client.clientNumber ?? null };
    const on = item ? item.enabled === true && emailOn(item.channels, true) : !cfg;
    if (!on) {
      notCovered.push({ ...base, reason: cfg?.updatedBy === 'unsubscribe-link' ? 'unsubscribed' : 'switched_off' });
      continue;
    }
    const to = String(cfg?.paymentEmailOverride || '').trim() || String(client.paymentEmail || '').trim();
    if (!to) {
      notCovered.push({ ...base, reason: 'no_payment_email' });
      continue;
    }
    covered += 1;
  }
  notCovered.sort((a, b) => (a.reason === b.reason ? a.name.localeCompare(b.name) : a.reason.localeCompare(b.reason)));
  return { activeClients: seen.size, covered, notCovered };
}

/** Active-and-unpaused clients, the same rule the daily reminders use. */
export const ACTIVE_CLIENT_FILTER = {
  status: 'active',
  $or: [{ isPaused: false }, { isPaused: null }, { isPaused: { $exists: false } }],
};
