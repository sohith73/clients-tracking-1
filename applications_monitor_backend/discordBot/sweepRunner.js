/**
 * One shared "only one sweep at a time" guard. The in-process cron and the HTTP
 * trigger both go through the same runner, so they can never run together.
 * A second caller gets an error with `busy: true` instead of starting a second sweep.
 * @template T
 * @param {() => Promise<T>} fn the real sweep
 * @returns {() => Promise<T>}
 */
export function createSweepRunner(fn) {
  let running = false;
  return async function runOnce() {
    if (running) throw Object.assign(new Error('sweep already running'), { busy: true });
    running = true;
    try {
      return await fn();
    } finally {
      running = false;
    }
  };
}

/**
 * Cron wrapper: never throws, logs one line per outcome. Returns the summary or null.
 * @param {{run: () => Promise<any>, label: string, logger?: Pick<Console, 'log'|'error'>}} p
 */
export async function runSweepFromCron({ run, label, logger = console }) {
  try {
    const s = await run();
    if (s?.skipped) logger.log(`[discord-onboarding] ${label}: skipped (${s.skipped})`);
    else logger.log(`[discord-onboarding] ${label}: dryRun=${s?.dryRun} considered=${s?.considered} posted=${s?.posted} failed=${s?.failed} capped=${s?.capped}`);
    return s ?? null;
  } catch (err) {
    if (err?.busy) logger.log(`[discord-onboarding] ${label}: another sweep is running, skipped`);
    else if (err?.notConfigured) logger.log(`[discord-onboarding] ${label}: bot not configured, skipped`);
    else logger.error(`[discord-onboarding] ${label} failed:`, String(err?.message || err).slice(0, 200));
    return null;
  }
}
