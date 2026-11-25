import test from 'node:test';
import assert from 'node:assert/strict';
import { createSerialQueue, createSweepRunner, runSweepFromCron } from './sweepRunner.js';

const quiet = () => { const lines = []; return { lines, log: (...a) => lines.push(a.join(' ')), error: (...a) => lines.push('ERR ' + a.join(' ')) }; };

test('a second call while one is running is rejected as busy, and the guard releases', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const run = createSweepRunner(async () => { await gate; return 'done'; });
  const first = run();
  await assert.rejects(run(), (e) => e.busy === true);
  release();
  assert.equal(await first, 'done');
  assert.equal(await createSweepRunner(async () => 'again')(), 'again');
});

test('the guard releases after a failure', async () => {
  let n = 0;
  const run = createSweepRunner(async () => { if (n++ === 0) throw new Error('boom'); return 'ok'; });
  await assert.rejects(run(), /boom/);
  assert.equal(await run(), 'ok');
});

test('cron wrapper logs the summary, and never throws', async () => {
  const l = quiet();
  assert.deepEqual(await runSweepFromCron({ run: async () => ({ dryRun: false, considered: 3, posted: 2, failed: 0, capped: false }), label: '8:00', logger: l }), { dryRun: false, considered: 3, posted: 2, failed: 0, capped: false });
  assert.match(l.lines[0], /8:00: dryRun=false considered=3 posted=2 failed=0/);
  assert.equal(await runSweepFromCron({ run: async () => ({ skipped: 'disabled' }), label: 'x', logger: l }) !== null, true);
  assert.match(l.lines[1], /skipped \(disabled\)/);
  assert.equal(await runSweepFromCron({ run: async () => { throw Object.assign(new Error('x'), { busy: true }); }, label: 'x', logger: l }), null);
  assert.match(l.lines[2], /another sweep is running/);
  assert.equal(await runSweepFromCron({ run: async () => { throw Object.assign(new Error('x'), { notConfigured: true }); }, label: 'x', logger: l }), null);
  assert.match(l.lines[3], /not configured/);
  assert.equal(await runSweepFromCron({ run: async () => { throw new Error('db down'); }, label: 'x', logger: l }), null);
  assert.match(l.lines[4], /^ERR .*db down/);
});

test('queued jobs wait for a running sweep, run in order, and a failing one does not block the next', async () => {
  const queue = createSerialQueue();
  const order = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const sweep = createSweepRunner(async () => { order.push('sweep start'); await gate; order.push('sweep end'); return 'swept'; }, queue);
  const p1 = sweep();
  const bad = queue.run(async () => { order.push('bad'); throw new Error('boom'); });
  const good = queue.run(async () => { order.push('good'); return 'ok'; });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(order, ['sweep start']);
  assert.equal(queue.busy, true);
  await assert.rejects(sweep(), (e) => e.busy === true);
  release();
  assert.equal(await p1, 'swept');
  await assert.rejects(bad, /boom/);
  assert.equal(await good, 'ok');
  assert.deepEqual(order, ['sweep start', 'sweep end', 'bad', 'good']);
  assert.equal(queue.busy, false);
});
