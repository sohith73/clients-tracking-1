/**
 * Runs jobs one at a time, in the order they arrive. The 8:00 sweep, the HTTP trigger and the
 * real-time per-client runs all go through one queue, so two of them can never create the same
 * channel at once.
 * @returns {{readonly busy: boolean, run: <T>(fn: () => Promise<T>) => Promise<T>}}
 */
export function createSerialQueue() {
  let tail = Promise.resolve();
  let pending = 0;
  return {
    get busy() {
      return pending > 0;
    },
    run(fn) {
      pending++;
      const result = tail.then(() => fn());
      const done = () => { pending--; };
      result.then(done, done);
      tail = result.catch(() => {});
      return result;
    },
  };
}

/**
 * The full sweep. A second full sweep while one is running (or queued behind a client run)
 * gets an error with `busy: true` instead of piling up.
 * @template T
 * @param {() => Promise<T>} fn the real sweep
 * @param {ReturnType<typeof createSerialQueue>} [queue] shared with the per-client runs
 * @returns {() => Promise<T>}
 */
export function createSweepRunner(fn, queue = createSerialQueue()) {
  return async function runOnce() {
    if (queue.busy) throw Object.assign(new Error('sweep already running'), { busy: true });
    return queue.run(fn);
  };
}

/**
 * Real-time trigger for one client (a payment, a BDA marking paid, a new client). Waits its turn
 * behind any running sweep. Never throws, so callers can fire it and move on.
 * @param {{queue: ReturnType<typeof createSerialQueue>, run: (email: string) => Promise<any>, email: string, label: string, logger?: Pick<Console, 'log'|'error'>}} p
 */
export async function runClientFromTrigger({ queue, run, email, label, logger = console }) {
  try {
    const s = await queue.run(() => run(email));
    if (s?.skipped) logger.log(`[discord-onboarding] ${label}: skipped (${s.skipped})`);
    else logger.log(`[discord-onboarding] ${label}: dryRun=${s?.dryRun} considered=${s?.considered} posted=${s?.posted} failed=${s?.failed}`);
    return s ?? null;
  } catch (err) {
    if (err?.notConfigured) logger.log(`[discord-onboarding] ${label}: bot not configured, skipped`);
    else logger.error(`[discord-onboarding] ${label} failed:`, String(err?.message || err).slice(0, 200));
    return null;
  }
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
