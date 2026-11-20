/**
 * Thin Discord REST client for the onboarding bot. JSON in, JSON out, with
 * retry on 429 and 5xx, and a hard rule that no message can ever ping
 * @everyone, @here or a role: allowed_mentions.parse is always empty and only
 * explicitly listed user IDs may be mentioned.
 *
 * Errors carry a safe message: never the token, never the Authorization
 * header, and the response body is truncated.
 */

export class DiscordApiError extends Error {
  /**
   * @param {string} message
   * @param {{status?: number, code?: number|null, retryAfterMs?: number|null, path?: string}} [info]
   */
  constructor(message, { status, code = null, retryAfterMs = null, path } = {}) {
    super(message);
    this.name = 'DiscordApiError';
    this.status = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
    this.path = path;
  }
}

const ID_RE = /^\d{5,25}$/;
const MEMBER_PAGE_SIZE = 1000;

function assertId(value, label) {
  if (typeof value !== 'string' || !ID_RE.test(value)) {
    throw new TypeError(`Invalid Discord ${label}: expected a numeric snowflake string`);
  }
  return value;
}

function truncate(str, max) {
  const s = typeof str === 'string' ? str : '';
  return s.length > max ? s.slice(0, max) : s;
}

function mentionPolicy(allowedUserIds) {
  const users = Array.isArray(allowedUserIds) ? allowedUserIds.map((id) => assertId(String(id), 'user id')) : [];
  return { parse: [], users };
}

function messageBody({ content, embeds, components, allowedUserIds } = {}) {
  const body = { allowed_mentions: mentionPolicy(allowedUserIds) };
  if (content !== undefined && content !== null) body.content = truncate(String(content), 2000);
  if (embeds) body.embeds = embeds;
  if (components) body.components = components;
  return body;
}

/**
 * @param {object} opts
 * @param {string} opts.token Bot token (never logged or put in errors)
 */
export function createDiscordApi({
  token,
  fetchImpl = globalThis.fetch,
  baseUrl = 'https://discord.com/api/v10',
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  logger = console,
  maxRetries = 3,
} = {}) {
  if (!token || typeof token !== 'string') throw new Error('Discord bot token is required');
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');

  async function request(method, path, { body, query } = {}) {
    let url = `${baseUrl}${path}`;
    if (query) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) qs.set(k, String(v));
      const s = qs.toString();
      if (s) url += `?${s}`;
    }
    const headers = {
      Authorization: `Bot ${token}`,
      'User-Agent': 'FlashfireOnboardingBot (internal, 1.0)',
    };
    const init = { method, headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetchImpl(url, init);
      } catch (err) {
        // Network failure: retry like a 5xx, then surface a safe error.
        if (attempt < maxRetries) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
        throw new DiscordApiError(`Discord ${method} ${path} network error: ${truncate(String(err?.message || err), 120).replaceAll(token, '[redacted]')}`, { status: 0, path });
      }

      if (res.status === 204) return null;

      const text = await res.text().catch(() => '');
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }

      if (res.ok) return json;

      const code = json && typeof json.code === 'number' ? json.code : null;
      const safeBody = truncate(text, 300).replaceAll(token, '[redacted]');

      if (res.status === 429) {
        let retryAfterMs = null;
        if (json && typeof json.retry_after === 'number') retryAfterMs = Math.ceil(json.retry_after * 1000);
        else {
          const h = Number(res.headers?.get?.('retry-after'));
          if (Number.isFinite(h) && h >= 0) retryAfterMs = Math.ceil(h * 1000);
        }
        if (retryAfterMs === null) retryAfterMs = 1000;
        if (attempt < maxRetries) {
          logger?.warn?.(`[discord] 429 on ${method} ${path}, waiting ${retryAfterMs}ms`);
          await sleep(retryAfterMs);
          continue;
        }
        throw new DiscordApiError(`Discord ${method} ${path} rate limited after ${maxRetries} retries: ${safeBody}`, { status: 429, code, retryAfterMs, path });
      }

      if (res.status >= 500) {
        if (attempt < maxRetries) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
        throw new DiscordApiError(`Discord ${method} ${path} failed with ${res.status}: ${safeBody}`, { status: res.status, code, path });
      }

      throw new DiscordApiError(`Discord ${method} ${path} failed with ${res.status}: ${safeBody}`, { status: res.status, code, path });
    }
  }

  const enc = encodeURIComponent;

  return {
    async listGuildChannels(guildId) {
      assertId(guildId, 'guild id');
      return request('GET', `/guilds/${enc(guildId)}/channels`);
    },

    async createTextChannel(guildId, { name, topic } = {}) {
      assertId(guildId, 'guild id');
      const body = { name, type: 0 };
      if (topic) body.topic = truncate(topic, 1024);
      return request('POST', `/guilds/${enc(guildId)}/channels`, { body });
    },

    async getChannel(channelId) {
      assertId(channelId, 'channel id');
      return request('GET', `/channels/${enc(channelId)}`);
    },

    async createThread(channelId, { name, autoArchiveDuration = 10080 } = {}) {
      assertId(channelId, 'channel id');
      return request('POST', `/channels/${enc(channelId)}/threads`, {
        body: { name: truncate(String(name ?? ''), 100), auto_archive_duration: autoArchiveDuration, type: 11 },
      });
    },

    async unarchiveThread(threadId) {
      assertId(threadId, 'thread id');
      return request('PATCH', `/channels/${enc(threadId)}`, { body: { archived: false } });
    },

    async postMessage(channelId, opts = {}) {
      assertId(channelId, 'channel id');
      return request('POST', `/channels/${enc(channelId)}/messages`, { body: messageBody(opts) });
    },

    async editMessage(channelId, messageId, opts = {}) {
      assertId(channelId, 'channel id');
      assertId(messageId, 'message id');
      return request('PATCH', `/channels/${enc(channelId)}/messages/${enc(messageId)}`, { body: messageBody(opts) });
    },

    async searchGuildMembers(guildId, query, limit = 10) {
      assertId(guildId, 'guild id');
      return request('GET', `/guilds/${enc(guildId)}/members/search`, { query: { query: String(query ?? ''), limit } });
    },

    async listGuildMembers(guildId, { limit = 1000 } = {}) {
      assertId(guildId, 'guild id');
      const all = [];
      let after;
      while (all.length < limit) {
        const page = await request('GET', `/guilds/${enc(guildId)}/members`, {
          query: { limit: MEMBER_PAGE_SIZE, after },
        });
        if (!Array.isArray(page) || page.length === 0) break;
        all.push(...page);
        if (page.length < MEMBER_PAGE_SIZE) break;
        after = page[page.length - 1]?.user?.id;
        if (!after) break;
      }
      return all.slice(0, limit);
    },
  };
}
