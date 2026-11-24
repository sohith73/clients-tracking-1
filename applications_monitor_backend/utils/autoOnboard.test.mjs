// node --test utils/autoOnboard.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutoOnboard, callHandler, secretsEqual, DEFAULT_DASHBOARD_PASSWORD } from './autoOnboard.js';

const lean = (v) => ({ select: () => ({ lean: async () => v }), lean: async () => v });

function setup({ user = null, tracking = null, csms = [], managers = [], handler } = {}) {
  const calls = { create: [], jobUpdate: [], csmPick: 0, mgrPick: 0 };
  const rr = (list, key, counter) => ({
    findOneAndUpdate: (filter, upd) => ({
      lean: async () => {
        calls[counter]++;
        const sorted = [...list].sort((a, b) => (a[key] ?? 0) - (b[key] ?? 0));
        const pick = sorted[0];
        if (!pick) return null;
        pick[key] = Date.now() + calls[counter];
        return pick;
      },
    }),
  });
  const deps = {
    createClient: handler || (async (req, res) => { calls.create.push(req.body); res.status(200).json({ message: 'ok' }); }),
    UserModel: rr(csms, 'lastCsmAssignedAt', 'csmPick'),
    ManagerModel: rr(managers, 'lastAssignedAt', 'mgrPick'),
    NewUserModel: { findOne: () => lean(user) },
    ClientModel: { findOne: () => lean(tracking || { clientNumber: 5810 }) },
    OnboardingJobModel: { updateOne: async (f, u) => { calls.jobUpdate.push({ f, u }); } },
    planWriteFields: (v) => (/^executive$/i.test(String(v)) ? { planLabel: 'Executive' } : null),
    logger: { log() {}, warn() {} },
  };
  // A tracking row exists only for emails the create handler already made.
  const made = new Set();
  const origCreate = deps.createClient;
  deps.createClient = async (req, res) => { await origCreate(req, res); made.add(req.body.email); };
  deps.ClientModel = {
    findOne: (filter) => {
      const email = filter.email ?? filter.$or?.[0]?.email;
      return lean(tracking ?? (made.has(email) ? { clientNumber: 5810 } : null));
    },
  };
  return { deps, calls, auto: createAutoOnboard(deps) };
}

const CSMS = () => [{ email: 'a@x.com', name: 'A' }, { email: 'b@x.com', name: 'B' }];
const MGRS = () => [{ email: 'm1@x.com', fullName: 'Mgr One' }, { email: 'm2@x.com', fullName: 'Mgr Two' }];

test('creates the client with default login, manager, CSM and dashboard credentials', async () => {
  const { auto, calls } = setup({ csms: CSMS(), managers: MGRS() });
  const r = await auto({ email: ' Sohith@Flashfirejobs.com ', name: 'Sohith Reddy', planType: 'executive', amountPaid: '599', currency: 'USD', country: 'USA' });
  assert.equal(r.status, 'created');
  assert.equal(r.clientNumber, 5810);
  const body = calls.create[0];
  assert.equal(body.email, 'sohith@flashfirejobs.com');
  assert.equal(body.password, DEFAULT_DASHBOARD_PASSWORD);
  assert.equal(body.planType, 'Executive');
  assert.equal(body.clientCountry, 'USA');
  assert.deepEqual(body.dashboardCredentials, { username: 'sohith@flashfirejobs.com', password: DEFAULT_DASHBOARD_PASSWORD, loginUrl: 'https://portal.flashfirejobs.com/' });
  assert.equal(body.dashboardTeamLeadName, 'Mgr One');
  assert.equal(calls.jobUpdate[0].u.$set.csmEmail, 'a@x.com');
});

test('an existing user or tracking record is left alone, nobody is assigned', async () => {
  const a = setup({ user: { _id: 1 }, csms: CSMS(), managers: MGRS() });
  assert.equal((await a.auto({ email: 'x@y.com', name: 'X', planType: 'Executive' })).status, 'exists');
  assert.equal(a.calls.create.length, 0);
  assert.equal(a.calls.csmPick + a.calls.mgrPick, 0);
  const b = setup({ tracking: { clientNumber: 5700 }, csms: CSMS(), managers: MGRS() });
  const r = await b.auto({ email: 'x@y.com', name: 'X', planType: 'Executive' });
  assert.deepEqual([r.status, r.clientNumber], ['exists', 5700]);
});

test('round robin alternates CSMs and managers', async () => {
  const csms = CSMS();
  const managers = MGRS();
  const { auto, calls } = setup({ csms, managers });
  await auto({ email: 'a1@y.com', name: 'A', planType: 'Executive' });
  await auto({ email: 'a2@y.com', name: 'B', planType: 'Executive' });
  await auto({ email: 'a3@y.com', name: 'C', planType: 'Executive' });
  assert.deepEqual(calls.create.map((b) => b.dashboardTeamLeadName), ['Mgr One', 'Mgr Two', 'Mgr One']);
  assert.deepEqual(calls.jobUpdate.map((j) => j.u.$set.csmEmail), ['a@x.com', 'b@x.com', 'a@x.com']);
});

test('invalid input and unknown plans never create anything', async () => {
  const { auto, calls } = setup({ csms: CSMS(), managers: MGRS() });
  assert.equal((await auto({ email: 'nope', name: 'X', planType: 'Executive' })).status, 'invalid');
  assert.equal((await auto({ email: 'a@b.com', name: '', planType: 'Executive' })).status, 'invalid');
  assert.equal((await auto({ email: 'a@b.com', name: 'X', planType: 'Gold' })).status, 'bad_plan');
  assert.equal(calls.create.length, 0);
});

test('no CSM or manager available still creates the client', async () => {
  const { auto, calls } = setup({});
  const r = await auto({ email: 'a@b.com', name: 'X', planType: 'Executive', country: 'India' });
  assert.equal(r.status, 'created');
  assert.equal(calls.create[0].dashboardTeamLeadName, '');
  assert.equal('clientCountry' in calls.create[0], false);
  assert.equal(calls.jobUpdate.length, 0);
});

test('a failed or racing create is reported, not thrown', async () => {
  const fail = setup({ handler: async (req, res) => res.status(500).json({ error: 'db down' }) });
  assert.deepEqual([(await fail.auto({ email: 'a@b.com', name: 'X', planType: 'Executive' })).status], ['failed']);
  const race = setup({ handler: async (req, res) => res.status(400).json({ error: 'User with email a@b.com already exists in users collection' }) });
  assert.equal((await race.auto({ email: 'a@b.com', name: 'X', planType: 'Executive' })).status, 'exists');
});

test('callHandler resolves with what the handler sent and rejects when it throws', async () => {
  assert.deepEqual(await callHandler(async (req, res) => res.status(201).json({ a: 1 }), {}), { status: 201, body: { a: 1 } });
  await assert.rejects(callHandler(async () => { throw new Error('boom'); }, {}), /boom/);
});

test('secretsEqual is strict and never true for an empty secret', () => {
  assert.equal(secretsEqual('abc', 'abc'), true);
  assert.equal(secretsEqual('abd', 'abc'), false);
  assert.equal(secretsEqual('', ''), false);
  assert.equal(secretsEqual(undefined, 'abc'), false);
});
