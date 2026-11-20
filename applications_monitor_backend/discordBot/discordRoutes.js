import crypto from 'node:crypto';
import { verifyDiscordSignature } from './verifySignature.js';
import { handleInteraction } from './interactions.js';

const MAX_SKEW_SECONDS = 300;

function secretsEqual(provided, expected) {
  const a = Buffer.from(String(provided || ''));
  const b = Buffer.from(String(expected || ''));
  // Hash both so the length never leaks and timingSafeEqual gets equal sizes.
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb) && a.length === b.length;
}

/**
 * Registers the Discord routes. Everything is injected so it can be tested.
 * Must be called BEFORE the global express.json(), the signature needs the raw body.
 */
export function registerDiscordRoutes(app, { express, getDeps, getConfig, getPublicKey, runSweep, cronSecret, nowMs = () => Date.now() }) {
  const rawJson = express.raw({ type: 'application/json', limit: '100kb' });

  const interactionsHandler = async (req, res) => {
    try {
      const publicKeyHex = getPublicKey ? getPublicKey() : '';
      if (!publicKeyHex) return res.status(503).json({ error: 'discord bot not configured' });

      const signatureHex = req.get('x-signature-ed25519');
      const timestamp = req.get('x-signature-timestamp');
      const rawBody = Buffer.isBuffer(req.body) ? req.body : null;
      if (!signatureHex || !timestamp || !rawBody) {
        return res.status(401).json({ error: 'invalid request signature' });
      }
      const ts = Number(timestamp);
      if (!Number.isFinite(ts) || Math.abs(nowMs() / 1000 - ts) > MAX_SKEW_SECONDS) {
        return res.status(401).json({ error: 'invalid request signature' });
      }
      if (!verifyDiscordSignature({ publicKeyHex, signatureHex, timestamp, rawBody })) {
        return res.status(401).json({ error: 'invalid request signature' });
      }

      let interaction;
      try {
        interaction = JSON.parse(rawBody.toString('utf8'));
      } catch {
        return res.status(400).json({ error: 'invalid json' });
      }

      // PING needs no deps, so Discord can verify the endpoint before env is complete.
      if (interaction?.type === 1) return res.status(200).json({ type: 1 });

      let deps;
      try {
        deps = await getDeps();
      } catch (err) {
        console.error('[discord-interactions] deps init failed:', err?.message);
        return res.status(503).json({ error: 'discord bot not configured' });
      }
      if (!deps) return res.status(503).json({ error: 'discord bot not configured' });

      const body = await handleInteraction({ interaction, deps });
      return res.status(200).json(body);
    } catch (err) {
      console.error('[discord-interactions] error:', err?.message);
      return res.status(500).json({ error: 'internal error' });
    }
  };

  let sweepRunning = false;
  const sweepHandler = async (req, res) => {
    if (!cronSecret) return res.status(503).json({ error: 'not configured' });
    if (!secretsEqual(req.get('x-cron-secret'), cronSecret)) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    if (sweepRunning) return res.status(409).json({ error: 'sweep already running' });
    sweepRunning = true;
    try {
      const summary = await runSweep();
      return res.status(200).json({ ok: true, ...(summary || {}) });
    } catch (err) {
      if (err?.notConfigured) return res.status(503).json({ error: 'discord bot not configured' });
      console.error('[discord-onboarding] sweep error:', err?.message);
      return res.status(500).json({ error: 'sweep failed' });
    } finally {
      sweepRunning = false;
    }
  };

  app.post('/api/discord/interactions', rawJson, interactionsHandler);
  app.post('/api/internal/run-discord-onboarding', sweepHandler);
  app.get('/api/internal/run-discord-onboarding', sweepHandler);
  return { interactionsHandler, sweepHandler, getConfig };
}
