// node --test discordBot/discordApi.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiscordApi, DiscordApiError } from './discordApi.js';

const TOKEN = 'SECRET.TOKEN.VALUE';

function res(status, body, headers = {}) {
  const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    text: async () => text,
  };
}

function setup(responses) {
  const calls = [];
  const delays = [];
  const queue = [...responses];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return typeof next === 'function' ? next(url, init) : next;
  };
  const sleep = async (ms) => { delays.push(ms); };
  const api = createDiscordApi({ token: TOKEN, fetchImpl, sleep, logger: { warn() {} } });
  return { api, calls, delays };
}

test('empty token throws', () => {
  assert.throws(() => createDiscordApi({ token: '' }));
});

test('sends auth and user agent headers; token never in thrown error', async () => {
  const { api, calls } = setup([res(403, { code: 50013, message: `Missing Permissions ${TOKEN}` })]);
  await assert.rejects(api.getChannel('12345678'), (err) => {
    assert.ok(err instanceof DiscordApiError);
    assert.equal(err.status, 403);
    assert.equal(err.code, 50013);
    assert.ok(!err.message.includes(TOKEN));
    assert.ok(!err.message.includes('Authorization'));
    assert.ok(!String(err.stack).includes(TOKEN));
    return true;
  });
  assert.equal(calls[0].init.headers.Authorization, `Bot ${TOKEN}`);
  assert.equal(calls[0].init.headers['User-Agent'], 'FlashfireOnboardingBot (internal, 1.0)');
});

test('error body is truncated to 300 chars', async () => {
  const { api } = setup([res(400, 'x'.repeat(5000))]);
  await assert.rejects(api.getChannel('12345678'), (err) => {
    assert.ok(err.message.length < 450);
    return true;
  });
});

test('429 then success retries once and sleeps retry_after', async () => {
  const { api, calls, delays } = setup([res(429, { retry_after: 1.5 }), res(200, { id: '1' })]);
  const out = await api.getChannel('12345678');
  assert.deepEqual(out, { id: '1' });
  assert.equal(calls.length, 2);
  assert.deepEqual(delays, [1500]);
});

test('429 uses Retry-After header when body has none', async () => {
  const { api, delays } = setup([res(429, 'nope', { 'retry-after': '2' }), res(200, {})]);
  await api.getChannel('12345678');
  assert.deepEqual(delays, [2000]);
});

test('429 forever throws after maxRetries', async () => {
  const { api, calls, delays } = setup([res(429, { retry_after: 0.1 })]);
  await assert.rejects(api.getChannel('12345678'), (err) => err instanceof DiscordApiError && err.status === 429 && err.retryAfterMs === 100);
  assert.equal(calls.length, 4);
  assert.equal(delays.length, 3);
});

test('5xx retries then succeeds', async () => {
  const { api, calls, delays } = setup([res(503, 'down'), res(200, { id: '2' })]);
  assert.deepEqual(await api.getChannel('12345678'), { id: '2' });
  assert.equal(calls.length, 2);
  assert.equal(delays.length, 1);
});

test('404 throws immediately with no retry', async () => {
  const { api, calls, delays } = setup([res(404, { code: 10003, message: 'Unknown Channel' })]);
  await assert.rejects(api.getChannel('12345678'), (err) => err.status === 404 && err.code === 10003);
  assert.equal(calls.length, 1);
  assert.equal(delays.length, 0);
});

test('204 returns null', async () => {
  const { api } = setup([res(204)]);
  assert.equal(await api.unarchiveThread('12345678'), null);
});

test('postMessage always sends empty parse and only listed users', async () => {
  const { api, calls } = setup([res(200, { id: '9' })]);
  await api.postMessage('12345678', { content: 'hi @everyone @here <@&99999>' });
  assert.deepEqual(calls[0].body.allowed_mentions, { parse: [], users: [] });
  await api.postMessage('12345678', { content: 'hey', allowedUserIds: ['11111111', '22222222'] });
  assert.deepEqual(calls[1].body.allowed_mentions, { parse: [], users: ['11111111', '22222222'] });
  assert.equal(calls[1].init.method, 'POST');
});

test('editMessage uses same mention rule and PATCH', async () => {
  const { api, calls } = setup([res(200, { id: '9' })]);
  await api.editMessage('12345678', '87654321', { content: '@everyone', allowedUserIds: ['11111111'] });
  assert.equal(calls[0].init.method, 'PATCH');
  assert.ok(calls[0].url.endsWith('/channels/12345678/messages/87654321'));
  assert.deepEqual(calls[0].body.allowed_mentions, { parse: [], users: ['11111111'] });
});

test('content over 2000 chars is truncated', async () => {
  const { api, calls } = setup([res(200, {})]);
  await api.postMessage('12345678', { content: 'a'.repeat(2500) });
  assert.equal(calls[0].body.content.length, 2000);
});

test('createThread sends type 11 and truncates name', async () => {
  const { api, calls } = setup([res(200, { id: '5' })]);
  await api.createThread('12345678', { name: 'n'.repeat(150) });
  assert.equal(calls[0].body.type, 11);
  assert.equal(calls[0].body.name.length, 100);
  assert.equal(calls[0].body.auto_archive_duration, 10080);
});

test('unarchiveThread patches archived false', async () => {
  const { api, calls } = setup([res(200, {})]);
  await api.unarchiveThread('12345678');
  assert.equal(calls[0].init.method, 'PATCH');
  assert.deepEqual(calls[0].body, { archived: false });
});

test('createTextChannel sends type 0', async () => {
  const { api, calls } = setup([res(200, {})]);
  await api.createTextChannel('12345678', { name: 'clients', topic: 't' });
  assert.equal(calls[0].body.type, 0);
  assert.equal(calls[0].body.name, 'clients');
});

test('createTextChannel passes parent and permission overwrites', async () => {
  const { api, calls } = setup([res(200, {})]);
  await api.createTextChannel('12345678', { name: 'n', parentId: '87654321', permissionOverwrites: [{ id: '12345678', type: 0, allow: '0', deny: '1024' }] });
  assert.equal(calls[0].body.parent_id, '87654321');
  assert.equal(calls[0].body.permission_overwrites[0].deny, '1024');
});

test('grantChannelAccess PUTs one overwrite per unique user and rejects bad ids', async () => {
  const { api, calls } = setup([res(204), res(204)]);
  await api.grantChannelAccess('12345678', ['900000', '900000', '900001']);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.method, 'PUT');
  assert.ok(calls[0].url.endsWith('/channels/12345678/permissions/900000'));
  assert.deepEqual(calls[0].body, { type: 1, allow: '68608', deny: '0' });
  await assert.rejects(() => api.grantChannelAccess('12345678', ['../x']), TypeError);
});

test('searchGuildMembers builds query string', async () => {
  const { api, calls } = setup([res(200, [])]);
  await api.searchGuildMembers('12345678', 'a b&c', 5);
  const u = new URL(calls[0].url);
  assert.equal(u.searchParams.get('query'), 'a b&c');
  assert.equal(u.searchParams.get('limit'), '5');
});

test('listGuildMembers pages with after until a short page', async () => {
  const mk = (start, n) => Array.from({ length: n }, (_, i) => ({ user: { id: String(start + i) } }));
  const { api, calls } = setup([res(200, mk(100000, 1000)), res(200, mk(200000, 1000)), res(200, mk(300000, 10))]);
  const out = await api.listGuildMembers('12345678', { limit: 5000 });
  assert.equal(out.length, 2010);
  assert.equal(calls.length, 3);
  assert.equal(new URL(calls[0].url).searchParams.get('after'), null);
  assert.equal(new URL(calls[1].url).searchParams.get('after'), '100999');
  assert.equal(new URL(calls[2].url).searchParams.get('after'), '200999');
  assert.equal(new URL(calls[0].url).searchParams.get('limit'), '1000');
});

test('invalid IDs reject with TypeError before any request', async () => {
  const { api, calls } = setup([res(200, {})]);
  await assert.rejects(async () => api.getChannel('../etc'), TypeError);
  await assert.rejects(async () => api.getChannel('12'), TypeError);
  await assert.rejects(async () => api.postMessage('123456/../789', { content: 'x' }), TypeError);
  await assert.rejects(async () => api.listGuildChannels(undefined), TypeError);
  await assert.rejects(async () => api.postMessage('12345678', { content: 'x', allowedUserIds: ['evil'] }), TypeError);
  assert.equal(calls.length, 0);
});

test('renameChannel PATCHes only the name', async () => {
  const { api, calls } = setup([res(200, { id: '12345678', name: 'x' })]);
  await api.renameChannel('12345678', '5810-sohith-executive-usa');
  assert.equal(calls[0].init.method, 'PATCH');
  assert.deepEqual(calls[0].body, { name: '5810-sohith-executive-usa' });
  await assert.rejects(async () => api.renameChannel('../x', 'a'), TypeError);
});
