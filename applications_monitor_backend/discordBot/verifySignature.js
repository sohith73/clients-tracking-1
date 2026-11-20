/**
 * Discord interaction signature check. Discord signs `timestamp + rawBody`
 * with Ed25519; every interaction request must be verified against the
 * application's public key before it is trusted.
 *
 * Never throws: any malformed input simply returns false.
 */
import crypto from 'node:crypto';

// DER SPKI prefix for a raw 32-byte Ed25519 public key.
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const HEX_RE = /^[0-9a-fA-F]+$/;

function hexToBuffer(hex, expectedBytes) {
  if (typeof hex !== 'string' || hex.length !== expectedBytes * 2 || !HEX_RE.test(hex)) return null;
  return Buffer.from(hex, 'hex');
}

/**
 * @param {{publicKeyHex: string, signatureHex: string, timestamp: string, rawBody: Buffer|string}} args
 * @returns {boolean}
 */
export function verifyDiscordSignature({ publicKeyHex, signatureHex, timestamp, rawBody } = {}) {
  try {
    if (typeof timestamp !== 'string' || !timestamp) return false;
    if (!Buffer.isBuffer(rawBody) && typeof rawBody !== 'string') return false;
    const keyBytes = hexToBuffer(publicKeyHex, 32);
    const sig = hexToBuffer(signatureHex, 64);
    if (!keyBytes || !sig) return false;
    const key = crypto.createPublicKey({
      key: Buffer.concat([SPKI_PREFIX, keyBytes]),
      format: 'der',
      type: 'spki',
    });
    const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
    return crypto.verify(null, Buffer.concat([Buffer.from(timestamp), body]), key, sig);
  } catch {
    return false;
  }
}
