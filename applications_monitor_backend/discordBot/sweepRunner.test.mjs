import test from 'node:test';
import assert from 'node:assert/strict';
import { createSerialQueue, createSweepRunner, runClientFromTrigger, runSweepFromCron } from './sweepRunner.js';

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

test('client runs wait for a running sweep instead of overlapping it', async () => {
  const queue = createSerialQueue();
  const order = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const sweep = createSweepRunner(async () => { order.push('sweep start'); await gate; order.push('sweep end'); return 'swept'; }, queue);
  const l = quiet();
  const p1 = sweep();
  const p2 = runClientFromTrigger({ queue, run: async (e) => { order.push(`client ${e}`); return { dryRun: false, considered: 1, posted: 1, failed: 0 }; }, email: 'a@x.com', label: 'realtime', logger: l });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(order, ['sweep start']);
  await assert.rejects(sweep(), (e) => e.busy === true);
  release();
  assert.equal(await p1, 'swept');
  await p2;
  assert.deepEqual(order, ['sweep start', 'sweep end', 'client a@x.com']);
  assert.match(l.lines[0], /realtime: dryRun=false considered=1 posted=1/);
});

test('client runs are serial, and a failing one never blocks the next or throws', async () => {
  const queue = createSerialQueue();
  const l = quiet();
  const order = [];
  const a = runClientFromTrigger({ queue, run: async () => { order.push('a'); throw new Error('discord down'); }, email: 'a@x.com', label: 'realtime', logger: l });
  const b = runClientFromTrigger({ queue, run: async () => { order.push('b'); return { skipped: 'disabled' }; }, email: 'b@x.com', label: 'realtime', logger: l });
  assert.equal(await a, null);
  assert.deepEqual(await b, { skipped: 'disabled' });
  assert.deepEqual(order, ['a', 'b']);
  assert.match(l.lines[0], /^ERR .*discord down/);
  assert.equal(queue.busy, false);
  const c = await runClientFromTrigger({ queue, run: async () => { throw Object.assign(new Error('x'), { notConfigured: true }); }, email: 'c@x.com', label: 'realtime', logger: l });
  assert.equal(c, null);
  assert.match(l.lines.at(-1), /not configured/);
});
