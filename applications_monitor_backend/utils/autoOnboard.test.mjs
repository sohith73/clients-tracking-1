// node --test utils/autoOnboard.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutoOnboard, callHandler, secretsEqual, DEFAULT_DASHBOARD_PASSWORD } from './autoOnboard.js';

const lean = (v) => ({ select: () => ({ lean: async () => v }), lean: async () => v });

function setup({ user = null, tracking = null, csms = [], managers = [], handler, onReady } = {}) {
  const calls = { create: [], jobUpdate: [], csmPick: 0, mgrPick: 0, order: [] };
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
    OnboardingJobModel: { updateOne: async (f, u) => { calls.jobUpdate.push({ f, u }); calls.order?.push('csm saved'); } },
    planWriteFields: (v) => (/^executive$/i.test(String(v)) ? { planLabel: 'Executive' } : null),
    logger: { log() {}, warn() {} },
    onReady,
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

test('Discord is triggered once, after the CSM is saved, with the dashboard email', async () => {
  let calls;
  const seen = [];
  const s = setup({ csms: CSMS(), managers: MGRS(), onReady: (e) => { seen.push(e); calls.order.push('discord'); } });
  calls = s.calls;
  const r = await s.auto({ email: 'New@Lead.com', name: 'New Lead', planType: 'Executive' });
  assert.equal(r.status, 'created');
  assert.deepEqual(seen, ['new@lead.com']);
  assert.deepEqual(calls.order, ['csm saved', 'discord']);
});

test('an existing client also triggers Discord, by the dashboard email not the CRM one', async () => {
  const seen = [];
  const s = setup({ tracking: { email: 'Real@Dash.com', clientNumber: 6077 }, onReady: (e) => seen.push(e) });
  const r = await s.auto({ email: 'crm@lead.com', name: 'Crm Lead', planType: 'Executive' });
  assert.deepEqual([r.status, r.dashboardEmail, r.clientNumber], ['exists', 'real@dash.com', 6077]);
  assert.deepEqual(seen, ['real@dash.com']);
});

test('a failing or throwing Discord trigger never breaks onboarding, and bad input never triggers it', async () => {
  const warnings = [];
  const s = setup({ csms: CSMS(), managers: MGRS(), onReady: () => Promise.reject(new Error('discord down')) });
  s.deps.logger.warn = (m) => warnings.push(m);
  assert.equal((await s.auto({ email: 'a@b.com', name: 'A', planType: 'Executive' })).status, 'created');
  const t = setup({ csms: CSMS(), managers: MGRS(), onReady: () => { throw new Error('sync boom'); } });
  assert.equal((await t.auto({ email: 'c@d.com', name: 'C', planType: 'Executive' })).status, 'created');
  const seen = [];
  const u = setup({ onReady: (e) => seen.push(e), handler: async (req, res) => res.status(500).json({ error: 'db' }) });
  assert.equal((await u.auto({ email: 'e@f.com', name: 'E', planType: 'Executive' })).status, 'failed');
  assert.equal((await u.auto({ email: 'bad', name: 'E', planType: 'Executive' })).status, 'invalid');
  assert.deepEqual(seen, []);
});

test('the create handler is told the call is automatic, so it does not trigger Discord before the CSM is set', async () => {
  let flag;
  const s = setup({ handler: async (req, res) => { flag = req.autoOnboard; res.status(200).json({}); } });
  await s.auto({ email: 'a@b.com', name: 'A', planType: 'Executive' });
  assert.equal(flag, true);
});

test('an existing client with an unknown plan is "exists", not refused; a new one is still refused', async () => {
  const seen = [];
  const a = setup({ user: { _id: 1 }, onReady: (e) => seen.push(e) });
  assert.equal((await a.auto({ email: 'old@x.com', name: 'Old', planType: 'Custom add-on' })).status, 'exists');
  assert.deepEqual(seen, ['old@x.com']);
  const b = setup({ csms: CSMS(), managers: MGRS() });
  assert.equal((await b.auto({ email: 'new@x.com', name: 'New', planType: 'Custom add-on' })).status, 'bad_plan');
  assert.equal(b.calls.create.length, 0);
  assert.equal(b.calls.csmPick + b.calls.mgrPick, 0);
});
