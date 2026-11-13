/**
 * Jobs Added report: per client, per day, how many jobs each platform added
 * (JobRight, HiringCafe, Indeed, Glassdoor) and, where a platform added
 * nothing, one plain line saying why.
 *
 * Two sources, on purpose:
 *   - COUNTS come from jobdbs, bucketed by how each card was made. They are
 *     always right, for any past day, whoever added the job.
 *   - REASONS come from jobaddreports, written by the Flashfire Autopilot on
 *     the laptop while it runs (FlashfireAutopilot/job_report.py). A count
 *     cannot say "Glassdoor's daily limit was used" - only the run knows that.
 * Where the run left no reason, ruleNote() derives one from the client's
 * country and the JobRight count, following the ops rule:
 *   USA/UK/Canada/Australia: JobRight first; boards only when JobRight < 20.
 *   Europe: no JobRight; HiringCafe, then Indeed, then Glassdoor.
 *
 * A "day" is the cap day: 22:00 IST the evening before to 22:00 IST
 * (see addWindow.js), so a 1-2 AM run belongs to that morning's date.
 *
 * Pure functions only - the route in index.js does the queries.
 */

export const PLATFORMS = ['jobright', 'hiringcafe', 'indeed', 'glassdoor'];

/** JobRight count at or above which the board top-up is not needed. */
export const GOOD_JOBRIGHT = 20;

/** A run whose laptop has not checked in for this long is shown as stalled. */
export const STALE_MS = 10 * 60 * 1000;

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const JOBRIGHT_COUNTRIES = new Set(['usa', 'uk', 'canada', 'australia']);

/** "YYYY-MM-DD" -> {start, end} of that cap day, or null for a bad date. */
export function capDayWindow(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
  if (!m) return null;
  const midnightIst = Date.UTC(+m[1], +m[2] - 1, +m[3]) - IST_OFFSET_MS;
  if (Number.isNaN(midnightIst)) return null;
  const start = new Date(midnightIst - 2 * 60 * 60 * 1000); // 22:00 IST the day before
  return { start, end: new Date(start.getTime() + MS_PER_DAY) };
}

/**
 * Mongo $switch expression naming a card's bucket:
 *   hiringcafe | indeed | glassdoor | otherBoard | jobright | manual
 */
export const BUCKET_EXPR = {
  $switch: {
    branches: [
      { case: { $regexMatch: { input: { $ifNull: ['$importSource', ''] }, regex: /hiringcafe/i } }, then: 'hiringcafe' },
      { case: { $regexMatch: { input: { $ifNull: ['$importSource', ''] }, regex: /indeed/i } }, then: 'indeed' },
      { case: { $regexMatch: { input: { $ifNull: ['$importSource', ''] }, regex: /glassdoor/i } }, then: 'glassdoor' },
      { case: { $gt: [{ $strLenCP: { $ifNull: ['$importSource', ''] } }, 0] }, then: 'otherBoard' },
      // operatorEmail is NOT used to split Autopilot from team JobRight
      // cards: applying to a card rewrites it to the applier's email.
      { case: { $gt: ['$extensionCode', null] }, then: 'jobright' },
    ],
    default: 'manual',
  },
};

function countryKind(country) {
  const c = String(country || '').trim().toLowerCase();
  if (!c) return 'none';
  if (c === 'europe') return 'europe';
  if (JOBRIGHT_COUNTRIES.has(c)) return 'jobright';
  return 'other';
}

/**
 * The line a cell shows when the run recorded no reason of its own.
 * @param {string} platform
 * @param {{country:string, paused:boolean, jobright:number, runActive:boolean, boardsRan?:boolean}} ctx
 */
export function ruleNote(platform, ctx) {
  const kind = countryKind(ctx.country);
  if (kind === 'none') return 'No country set - skipped';
  if (ctx.paused) return 'Client paused';
  if (platform === 'jobright') {
    if (kind === 'europe') return 'Not used - Europe client (boards only)';
    return ctx.runActive ? 'Waiting for JobRight' : 'Not run';
  }
  // "Not needed" only while no board ran at all; once the top-up ran for this
  // client (Ahmed: HiringCafe 10 + Indeed 7) a board with 0 simply did not run.
  if (kind === 'jobright' && ctx.jobright >= GOOD_JOBRIGHT && !ctx.boardsRan) {
    return `Not needed - JobRight gave ${ctx.jobright}`;
  }
  if (ctx.runActive) return kind === 'europe' ? 'Waiting in the Europe run' : 'Waiting - top-up runs after JobRight';
  return 'Not run';
}

/**
 * One table row.
 * @param {{email,name,country,paused}} client
 * @param {Record<string, number>} counts  bucket -> jobs that day
 * @param {{platforms?: Record<string,{state,note}>}|null} saved  jobaddreports row
 * @param {boolean} runActive  a run is going right now for this day
 * @param {number} removed  cards added that day and later deleted/removed
 */
export function buildRow(client, counts = {}, saved = null, runActive = false, removed = 0) {
  const n = (k) => Number(counts[k] || 0);
  const jobright = n('jobright');
  const byPlatform = { jobright, hiringcafe: n('hiringcafe'), indeed: n('indeed'), glassdoor: n('glassdoor') };
  const boardsRan = ['hiringcafe', 'indeed', 'glassdoor'].some((p) => byPlatform[p] > 0);
  const ctx = { country: client.country, paused: !!client.paused, jobright, runActive, boardsRan };
  const cells = {};
  for (const p of PLATFORMS) {
    const s = (saved && saved.platforms && saved.platforms[p]) || {};
    const count = byPlatform[p];
    let state = s.state || '';
    // A run that died leaves "running"; only trust it while the run is live.
    if (!runActive && (state === 'running' || state === 'queued')) state = 'stopped';
    let text = '';
    if (state === 'running') text = count ? 'Adding now…' : 'Running now…';
    else if (state === 'queued') text = 'In the queue';
    else if (state === 'stopped') text = s.note || 'Run stopped before this finished';
    else if (s.note && count && state === 'failed') {
      // Karan: Autopilot login failed, yet 12 JobRight jobs - the team added them.
      text = `Autopilot: ${s.note}. These ${count} were added by the team.`;
    } else if (s.note) text = s.note;
    else if (!count) text = ruleNote(p, ctx);
    let tone = 'muted';
    if (count) tone = 'good';
    else if (state === 'running' || state === 'queued') tone = 'live';
    else if (state === 'failed' || state === 'stopped') tone = 'bad';
    else if (/not needed|not used/i.test(text)) tone = 'skip';
    else if (s.note) tone = 'warn';
    cells[p] = { count, state: state || (count ? 'done' : ''), text, tone };
  }
  const other = n('otherBoard') + n('manual');
  const total = jobright + byPlatform.hiringcafe + byPlatform.indeed + byPlatform.glassdoor + other;
  return {
    email: client.email,
    name: client.name || '',
    country: client.country || '',
    paused: !!client.paused,
    total,
    other,
    removed,
    cells,
    summary: summaryLine({ total, byPlatform, other, cells, ctx })
      + (removed ? ` (${removed} more ${removed === 1 ? 'was' : 'were'} added but removed later by the team.)` : ''),
  };
}

const LABEL = { jobright: 'JobRight', hiringcafe: 'HiringCafe', indeed: 'Indeed', glassdoor: 'Glassdoor' };

export function summaryLine({ total, byPlatform, other, cells, ctx }) {
  const parts = PLATFORMS.filter((p) => byPlatform[p]).map((p) => `${LABEL[p]} ${byPlatform[p]}`);
  if (other) parts.push(`other ${other}`);
  const live = PLATFORMS.some((p) => cells[p].state === 'running' || cells[p].state === 'queued');
  const kind = countryKind(ctx.country);
  if (kind === 'none') return 'No country set, so nothing was added automatically.';
  if (ctx.paused && !total) return 'Client paused - no jobs added.';
  // The total is its own field (row.total); repeating it here read as "1010 jobs".
  let line = total ? parts.join(' + ') : 'No jobs yet';
  if (live) return `${line}. Still adding right now.`;
  if (total >= GOOD_JOBRIGHT) {
    if (kind === 'jobright' && byPlatform.jobright >= GOOD_JOBRIGHT && !byPlatform.hiringcafe && !byPlatform.indeed && !byPlatform.glassdoor) {
      return `${line}. JobRight was enough, boards not needed.`;
    }
    return `${line}.`;
  }
  // Under target: say the main reason, taken from the cells.
  const why = PLATFORMS.map((p) => cells[p])
    .filter((c) => !c.count && c.tone !== 'skip' && c.text && c.text !== 'Not run')
    .map((c) => c.text);
  const reason = why[0] ? ` Main reason: ${why[0].charAt(0).toLowerCase()}${why[0].slice(1)}.` : '';
  return `${line} - below ${GOOD_JOBRIGHT}.${reason}`;
}

/**
 * Run banner state for a day.
 * @param {{status,startedAt,heartbeatAt,finishedAt,total,done,current}|null} run
 */
export function runState(run, nowMs = Date.now()) {
  if (!run) return { state: 'none' };
  const beat = run.heartbeatAt ? new Date(run.heartbeatAt).getTime() : 0;
  const base = {
    startedAt: run.startedAt || null,
    heartbeatAt: run.heartbeatAt || null,
    finishedAt: run.finishedAt || null,
    total: run.total || 0,
    done: run.done || 0,
    current: Array.isArray(run.current) ? run.current : [],
  };
  if (run.status === 'running') {
    const age = nowMs - beat;
    return { ...base, state: age <= STALE_MS ? 'live' : 'stalled', minutesSinceUpdate: Math.round(age / 60000) };
  }
  return { ...base, state: 'done' };
}
