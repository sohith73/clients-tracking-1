/**
 * One text channel per client, grouped into categories that hold at most `max`
 * channels (Discord's hard limit is 50 per category). Categories are named
 * "<base>", "<base>-2", "<base>-3", ... and filled in that order.
 * Pure helpers plus one function that talks to Discord through `discord`.
 */
import { CHANNEL_VIEWER_PERMS, VIEW_CHANNEL } from './discordApi.js';

const CATEGORY = 4;
const TEXT = 0;

/** @param {unknown} s @returns {string} lowercase a-z0-9 words joined by "-", no leading/trailing dash */
export function slugify(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * "5788-sohith" for a numbered client; "sohith-a1b2" (last 4 of the id) when there is no number yet.
 * @param {{clientNumber?: number|string|null, name?: string, email?: string, userId?: string, prefix?: string}} p
 */
export function buildChannelName({ clientNumber, name, email, userId, prefix = '' }) {
  const slug = slugify(name) || slugify(String(email || '').split('@')[0]) || 'client';
  const hasNumber = clientNumber !== undefined && clientNumber !== null && String(clientNumber).trim() !== '';
  const num = hasNumber ? slugify(clientNumber) : '';
  const tail = !num ? slugify(String(userId || '').slice(-4)) : '';
  const parts = [slugify(prefix), num, slug, tail].filter(Boolean);
  return parts.join('-').slice(0, 100).replace(/-+$/g, '');
}

/** @returns {string} */
export function categoryNameFor(base, index) {
  return index <= 1 ? base : `${base}-${index}`;
}

/** @returns {number|null} 1 for "<base>", N for "<base>-N" (N >= 2), null for any other name */
export function parseCategoryIndex(name, base) {
  const n = String(name || '').trim().toLowerCase();
  const b = String(base).toLowerCase();
  if (n === b) return 1;
  const m = new RegExp(`^${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`).exec(n);
  return m && Number(m[1]) >= 2 ? Number(m[1]) : null;
}

/**
 * Pick the first category (lowest index) with room; else say which one to create next.
 * @param {{channels: Array<{id: string, name: string, type?: number, parent_id?: string|null}>, baseName: string, max: number}} p
 * @returns {{categoryId: string|null, name: string}}
 */
export function planCategory({ channels, baseName, max }) {
  const cats = (channels || [])
    .filter((c) => c.type === CATEGORY)
    .map((c) => ({ id: c.id, index: parseCategoryIndex(c.name, baseName) }))
    .filter((c) => c.index !== null)
    .sort((a, b) => a.index - b.index);
  const count = (id) => (channels || []).filter((c) => c.parent_id === id).length;
  for (const c of cats) {
    if (count(c.id) < max) return { categoryId: c.id, name: categoryNameFor(baseName, c.index) };
  }
  const next = cats.length ? cats[cats.length - 1].index + 1 : 1;
  return { categoryId: null, name: categoryNameFor(baseName, next) };
}

/**
 * Private channel: @everyone (role id = guild id) cannot view it; only the listed users and the bot can.
 * @param {{guildId: string, viewerIds?: string[], botUserId?: string}} p
 */
export function privateOverwrites({ guildId, viewerIds = [], botUserId = '' }) {
  const ids = [...new Set([botUserId, ...viewerIds].map((x) => String(x || '').trim()).filter((x) => /^\d{5,25}$/.test(x)))];
  return [
    { id: String(guildId), type: 0, allow: '0', deny: VIEW_CHANNEL },
    ...ids.map((id) => ({ id, type: 1, allow: CHANNEL_VIEWER_PERMS, deny: '0' })),
  ];
}

/**
 * Create a text channel in the right category, making the category if needed.
 * `channels` is the caller's cached guild channel list; it is updated in place so
 * the next call in the same run sees the new category and channel.
 * @returns {Promise<{id: string, categoryId: string, created: boolean}>}
 */
export async function createClientChannel({ discord, guildId, channels, baseName, max, name, topic, viewerIds = [], botUserId = '' }) {
  // Reuse an identical name under our categories (guards against an orphan from a half-failed run).
  const ours = new Set(channels.filter((c) => c.type === CATEGORY && parseCategoryIndex(c.name, baseName) !== null).map((c) => c.id));
  const existing = channels.find((c) => (c.type === undefined || c.type === TEXT) && c.name === name && ours.has(c.parent_id));
  if (existing) return { id: existing.id, categoryId: existing.parent_id, created: false };

  let plan = planCategory({ channels, baseName, max });
  if (!plan.categoryId) {
    const cat = await discord.createCategory(guildId, { name: plan.name });
    channels.push({ id: cat.id, name: plan.name, type: CATEGORY, parent_id: null });
    plan = { categoryId: cat.id, name: plan.name };
  }
  const ch = await discord.createTextChannel(guildId, {
    name,
    topic,
    parentId: plan.categoryId,
    permissionOverwrites: privateOverwrites({ guildId, viewerIds, botUserId }),
  });
  channels.push({ id: ch.id, name, type: TEXT, parent_id: plan.categoryId });
  return { id: ch.id, categoryId: plan.categoryId, created: true };
}
