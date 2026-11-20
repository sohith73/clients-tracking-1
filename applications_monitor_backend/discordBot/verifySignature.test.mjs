// node --test discordBot/verifySignature.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyDiscordSignature } from './verifySignature.js';

function makeFixture(timestamp = '1700000000', body = '{"type":1}') {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const der = publicKey.export({ format: 'der', type: 'spki' });
  const publicKeyHex = der.subarray(der.length - 32).toString('hex');
  const signatureHex = crypto
    .sign(null, Buffer.concat([Buffer.from(timestamp), Buffer.from(body)]), privateKey)
    .toString('hex');
  return { publicKeyHex, signatureHex, timestamp, rawBody: body };
}

test('valid signature passes (string and Buffer body)', () => {
  const f = makeFixture();
  assert.equal(verifyDiscordSignature(f), true);
  assert.equal(verifyDiscordSignature({ ...f, rawBody: Buffer.from(f.rawBody) }), true);
});

test('tampered body fails', () => {
  const f = makeFixture();
  assert.equal(verifyDiscordSignature({ ...f, rawBody: '{"type":2}' }), false);
});

test('tampered timestamp fails', () => {
  const f = makeFixture();
  assert.equal(verifyDiscordSignature({ ...f, timestamp: '1700000001' }), false);
});

test('wrong public key fails', () => {
  const f = makeFixture();
  const other = makeFixture();
  assert.equal(verifyDiscordSignature({ ...f, publicKeyHex: other.publicKeyHex }), false);
});

test('malformed inputs return false and never throw', () => {
  const f = makeFixture();
  assert.equal(verifyDiscordSignature(), false);
  assert.equal(verifyDiscordSignature({}), false);
  assert.equal(verifyDiscordSignature({ ...f, publicKeyHex: 'zz'.repeat(32) }), false);
  assert.equal(verifyDiscordSignature({ ...f, publicKeyHex: 'abcd' }), false);
  assert.equal(verifyDiscordSignature({ ...f, signatureHex: 'nothex' }), false);
  assert.equal(verifyDiscordSignature({ ...f, signatureHex: f.signatureHex.slice(2) }), false);
  assert.equal(verifyDiscordSignature({ ...f, timestamp: undefined }), false);
  assert.equal(verifyDiscordSignature({ ...f, rawBody: undefined }), false);
  assert.equal(verifyDiscordSignature({ ...f, rawBody: 123 }), false);
  assert.equal(verifyDiscordSignature({ ...f, publicKeyHex: null }), false);
});
