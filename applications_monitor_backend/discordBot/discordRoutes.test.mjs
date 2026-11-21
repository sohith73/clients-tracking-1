import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { registerDiscordRoutes } from './discordRoutes.js';

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
// Raw 32-byte public key = last 32 bytes of the SPKI DER.
const publicKeyHex = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');

const NOW = 1_800_000_000_000;
const sign = (ts, body) => crypto.sign(null, Buffer.concat([Buffer.from(ts), body]), privateKey).toString('hex');

function setup(over = {}) {
  const routes = {};
  const app = {
    post: (path, ...h) => { routes[`POST ${path}`] = h; },
    get: (path, ...h) => { routes[`GET ${path}`] = h; },
  };
  const express = { raw: () => 'RAW_MW' };
  registerDiscordRoutes(app, {
    express,
    getDeps: async () => ({
      loadUser: async () => null, loadOnboardingJob: async () => null,
      canClick: async () => true, markResolved: async () => {}, now: () => new Date(),
    }),
    getConfig: () => ({}),
    getPublicKey: () => publicKeyHex,
    runSweep: async () => ({ sent: 2 }),
    cronSecret: 'sekret',
    nowMs: () => NOW,
    ...over,
  });
  return routes;
}

function mkRes() {
  const res = { statusCode: null, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
const mkReq = ({ headers = {}, body } = {}) => ({
  body,
  get: (h) => headers[h.toLowerCase()],
});

function signedReq(bodyObj, { ts = String(NOW / 1000), sig } = {}) {
  const body = Buffer.from(typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj));
  return mkReq({
    body,
    headers: { 'x-signature-ed25519': sig ?? sign(ts, body), 'x-signature-timestamp': ts },
  });
}

test('registers raw body middleware on the interactions route only', () => {
  const routes = setup();
  assert.equal(routes['POST /api/discord/interactions'][0], 'RAW_MW');
  assert.ok(routes['GET /api/internal/run-discord-onboarding']);
});

test('valid signature passes and PING is answered', async () => {
  const h = setup()['POST /api/discord/interactions'][1];
  const res = mkRes();
  await h(signedReq({ type: 1 }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { type: 1 });
});

test('bad signature is 401', async () => {
  const h = setup()['POST /api/discord/interactions'][1];
  const res = mkRes();
  await h(signedReq({ type: 1 }, { sig: 'ab'.repeat(64) }), res);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: 'invalid request signature' });
});

test('missing signature headers is 401', async () => {
  const h = setup()['POST /api/discord/interactions'][1];
  const res = mkRes();
  await h(mkReq({ body: Buffer.from('{}') }), res);
  assert.equal(res.statusCode, 401);
});

test('stale timestamp is 401 even with a valid signature', async () => {
  const h = setup()['POST /api/discord/interactions'][1];
  const res = mkRes();
  await h(signedReq({ type: 1 }, { ts: String(NOW / 1000 - 600) }), res);
  assert.equal(res.statusCode, 401);
});

test('signed but invalid JSON is 400', async () => {
  const h = setup()['POST /api/discord/interactions'][1];
  const res = mkRes();
  await h(signedReq('{not json'), res);
  assert.equal(res.statusCode, 400);
});

test('button click flows through handleInteraction', async () => {
  const h = setup()['POST /api/discord/interactions'][1];
  const res = mkRes();
  await h(signedReq({ type: 3, data: { custom_id: 'onb:resume:' + 'a'.repeat(24) }, member: { user: { id: '12345678' } } }), res);
  assert.equal(res.statusCode, 200);
  assert.match(res.body.data.content, /can't find this client/);
});

test('interactions 503 when no public key', async () => {
  const h = setup({ getPublicKey: () => '' })['POST /api/discord/interactions'][1];
  const res = mkRes();
  await h(signedReq({ type: 1 }), res);
  assert.equal(res.statusCode, 503);
});

test('cron route 503 when secret unset', async () => {
  const h = setup({ cronSecret: '' })['POST /api/internal/run-discord-onboarding'][0];
  const res = mkRes();
  await h(mkReq({ headers: { 'x-cron-secret': 'anything' } }), res);
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { error: 'not configured' });
});

test('cron route 401 on wrong or missing secret', async () => {
  const h = setup()['POST /api/internal/run-discord-onboarding'][0];
  for (const headers of [{ 'x-cron-secret': 'nope' }, {}]) {
    const res = mkRes();
    await h(mkReq({ headers }), res);
    assert.equal(res.statusCode, 401);
  }
});

test('cron route ignores the query string secret', async () => {
  const h = setup()['GET /api/internal/run-discord-onboarding'][0];
  const res = mkRes();
  const req = { ...mkReq(), query: { key: 'sekret' } };
  await h(req, res);
  assert.equal(res.statusCode, 401);
});

test('cron route 200 with right secret', async () => {
  const h = setup()['POST /api/internal/run-discord-onboarding'][0];
  const res = mkRes();
  await h(mkReq({ headers: { 'x-cron-secret': 'sekret' } }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, sent: 2 });
});

test('cron route 500 hides internals on failure, 503 when bot unconfigured', async () => {
  let h = setup({ runSweep: async () => { throw new Error('secret db string'); } })['POST /api/internal/run-discord-onboarding'][0];
  let res = mkRes();
  await h(mkReq({ headers: { 'x-cron-secret': 'sekret' } }), res);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: 'sweep failed' });

  h = setup({ runSweep: async () => { throw Object.assign(new Error('x'), { notConfigured: true }); } })['POST /api/internal/run-discord-onboarding'][0];
  res = mkRes();
  await h(mkReq({ headers: { 'x-cron-secret': 'sekret' } }), res);
  assert.equal(res.statusCode, 503);
});

test('overlapping sweeps get 409, and the guard releases afterwards', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const h = setup({ runSweep: async () => { await gate; return {}; } })['POST /api/internal/run-discord-onboarding'][0];
  const req = () => mkReq({ headers: { 'x-cron-secret': 'sekret' } });
  const res1 = mkRes();
  const p1 = h(req(), res1);
  const res2 = mkRes();
  await h(req(), res2);
  assert.equal(res2.statusCode, 409);
  release();
  await p1;
  assert.equal(res1.statusCode, 200);
  const res3 = mkRes();
  await h(req(), res3);
  assert.equal(res3.statusCode, 200);
});

test('a busy shared runner (cron already sweeping) answers 409', async () => {
  const h = setup({ runSweep: async () => { throw Object.assign(new Error('sweep already running'), { busy: true }); } })['POST /api/internal/run-discord-onboarding'][0];
  const res = mkRes();
  await h(mkReq({ headers: { 'x-cron-secret': 'sekret' } }), res);
  assert.equal(res.statusCode, 409);
});
