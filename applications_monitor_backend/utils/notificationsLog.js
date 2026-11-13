// Pure logic for the admin Notifications tab: query parsing, Mongo filters and
// the "is every active client covered?" calculation. No DB access here so it
// stays unit-testable. The routes in index.js do the reads.
//
// Data is written by the dashboard backend (reminderdeliveries,
// clientreminderconfigs); this service only ever reads it.

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
export const MAX_SEARCH_LENGTH = 100;

const STATUS_VALUES = ['all', 'delivered', 'sent', 'partial', 'failed', 'skipped'];
const ITEM_KEYS = ['daily_summary', 'inactivity_alert'];
const TRIGGERS = ['cron', 'auto-threshold', 'manual'];
const CHANNELS = ['email_failed', 'mattermost_failed'];
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

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
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
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
 * { page, pageSize, status, filters } where filters holds everything except status.
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
  const itemKey = pick('itemKey', ITEM_KEYS);
  if (itemKey.error) return { error: itemKey.error };
  const trigger = pick('trigger', TRIGGERS);
  if (trigger.error) return { error: trigger.error };
  const channel = pick('channel', CHANNELS);
  if (channel.error) return { error: channel.error };

  const rawSearch = firstString(query.search);
  const search = typeof rawSearch === 'string' ? rawSearch.trim().slice(0, MAX_SEARCH_LENGTH) : '';

  const range = {};
  for (const name of ['from', 'to']) {
    const v = firstString(query[name]);
    if (v === undefined || v === null || v === '') continue;
    const start = istDayStart(v);
    if (!start) return { error: `${name} must be a real date in YYYY-MM-DD format` };
    range[name] = String(v);
  }
  if (range.from && range.to && range.from > range.to) {
    return { error: 'from must not be after to' };
  }

  return {
    page: page.value,
    pageSize,
    status: status.value || 'all',
    filters: { itemKey: itemKey.value, trigger: trigger.value, channel: channel.value, search, ...range },
  };
}

/** Mongo filter for everything except status (used for rows and for the status counts). */
export function buildBaseMatch(filters = {}) {
  const match = {};
  if (filters.itemKey) match.itemKey = filters.itemKey;
  if (filters.trigger) match.trigger = filters.trigger;
  if (filters.channel === 'email_failed') {
    match['email.attempted'] = true;
    match['email.ok'] = { $ne: true };
  } else if (filters.channel === 'mattermost_failed') {
    match['mattermost.attempted'] = true;
    match['mattermost.ok'] = { $ne: true };
  }
  if (filters.search) {
    const rx = new RegExp(escapeRegex(filters.search), 'i');
    match.$or = [{ clientEmail: rx }, { clientName: rx }];
  }
  if (filters.from || filters.to) {
    match.at = {};
    if (filters.from) match.at.$gte = istDayStart(filters.from);
    if (filters.to) match.at.$lt = new Date(istDayStart(filters.to).getTime() + 24 * 60 * 60 * 1000);
  }
  return match;
}

/** Add the status chip to a base match. */
export function withStatus(match, status) {
  if (!status || status === 'all') return match;
  if (status === 'delivered') return { ...match, status: { $in: ['sent', 'partial'] } };
  return { ...match, status };
}

/** Turn a $group-by-status result into the fixed counts shape. */
export function toCounts(groups = []) {
  const counts = { sent: 0, partial: 0, failed: 0, skipped: 0 };
  for (const g of groups) {
    if (g && Object.prototype.hasOwnProperty.call(counts, g._id)) counts[g._id] = g.n || 0;
  }
  return counts;
}

/**
 * A client is covered when its daily_summary item is enabled with at least one
 * channel on. Emails match case-insensitively. Reasons for the rest:
 * unsubscribed (the client used the unsubscribe link, which the dashboard
 * backend records as updatedBy "unsubscribe-link"; nobody should turn these
 * back on), no_config (no config doc, or no daily_summary item) or
 * switched_off (an operator turned it off).
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
    const ch0 = item?.channels || {};
    const isCovered = Boolean(item && item.enabled && (ch0.email || ch0.mattermost));
    if (!isCovered && cfg?.updatedBy === 'unsubscribe-link') {
      notCovered.push({ email, name: client.name || '', clientNumber: client.clientNumber ?? null, reason: 'unsubscribed' });
      continue;
    }
    if (!item) {
      notCovered.push({ email, name: client.name || '', clientNumber: client.clientNumber ?? null, reason: 'no_config' });
      continue;
    }
    const ch = item.channels || {};
    if (item.enabled && (ch.email || ch.mattermost)) covered += 1;
    else notCovered.push({ email, name: client.name || '', clientNumber: client.clientNumber ?? null, reason: 'switched_off' });
  }
  notCovered.sort((a, b) => (a.reason === b.reason ? a.name.localeCompare(b.name) : a.reason.localeCompare(b.reason)));
  return { activeClients: seen.size, covered, notCovered };
}

/** Active-and-unpaused clients, the same rule the daily reminders use. */
export const ACTIVE_CLIENT_FILTER = {
  status: 'active',
  $or: [{ isPaused: false }, { isPaused: null }, { isPaused: { $exists: false } }],
};
