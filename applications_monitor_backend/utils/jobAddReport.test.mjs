import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRow, capDayWindow, runState, ruleNote } from './jobAddReport.js';

test('cap day starts 22:00 IST the evening before', () => {
  const w = capDayWindow('2026-11-12');
  assert.equal(w.start.toISOString(), '2026-11-11T16:30:00.000Z');
  assert.equal(w.end.toISOString(), '2026-11-12T16:30:00.000Z');
  assert.equal(capDayWindow('12-11-2026'), null);
});

test('USA client with good JobRight: boards say not needed', () => {
  const r = buildRow({ email: 'a', name: 'A', country: 'USA' }, { jobright: 24 }, null, false, 9);
  assert.equal(r.cells.jobright.count, 24);
  assert.equal(r.removed, 9);
  assert.match(r.summary, /9 more were added but removed later/);
  assert.equal(r.cells.hiringcafe.text, 'Not needed - JobRight gave 24');
  assert.match(r.summary, /^24 jobs: JobRight 24\. JobRight was enough/);
});

test('Europe client: JobRight not used; saved reasons win', () => {
  const r = buildRow({ email: 'v', name: 'V', country: 'Europe' }, { indeed: 1 }, {
    platforms: { hiringcafe: { state: 'done', note: 'No new jobs on the board (last 48h)' },
                 glassdoor: { state: 'done', note: 'Glassdoor daily limit used' } } });
  assert.equal(r.cells.jobright.text, 'Not used - Europe client (boards only)');
  assert.equal(r.cells.hiringcafe.text, 'No new jobs on the board (last 48h)');
  assert.equal(r.cells.indeed.count, 1);
  assert.match(r.summary, /below 5\. Main reason: no new jobs/);
});

test('live run: running cell shows running, dead run shows stopped', () => {
  const saved = { platforms: { jobright: { state: 'running' } } };
  assert.equal(buildRow({ email: 'k', country: 'USA' }, {}, saved, true).cells.jobright.text, 'Running now…');
  assert.equal(buildRow({ email: 'k', country: 'USA' }, {}, saved, false).cells.jobright.state, 'stopped');
  assert.equal(ruleNote('indeed', { country: 'USA', jobright: 2, runActive: true }), 'Waiting - top-up runs after JobRight');
});

test('run banner goes stalled after 10 min without a heartbeat', () => {
  const now = Date.parse('2026-11-13T01:00:00Z');
  assert.equal(runState({ status: 'running', heartbeatAt: new Date(now - 60000) }, now).state, 'live');
  assert.equal(runState({ status: 'running', heartbeatAt: new Date(now - 30 * 60000) }, now).state, 'stalled');
  assert.equal(runState(null).state, 'none');
});
