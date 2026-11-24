/**
 * Auto onboarding: a paid client becomes a dashboard user without anyone typing it in.
 *
 * Called by the website backend (CRM "paid" and Stripe payments) through
 * POST /api/internal/auto-onboard. It reuses the existing client-creation handler
 * (user, tracking record with a number from the shared counter, onboarding ticket),
 * so there is one place that knows how a client is made.
 *
 * Idempotent by email: a client that already exists is left alone. CSM and dashboard
 * manager are picked round robin, oldest assignment first.
 */
import crypto from 'node:crypto';

export const DEFAULT_DASHBOARD_PASSWORD = 'flashfire@123';
export const DASHBOARD_LOGIN_URL = 'https://portal.flashfirejobs.com/';

const EMAIL_RE = /^[^\s@()<>]+@[^\s@()<>]+\.[^\s@()<>]+$/;
const COUNTRIES = ['USA', 'Canada', 'UK', 'Australia', 'Europe'];
const HANDLER_TIMEOUT_MS = 30_000;

/** @returns {boolean} constant-time comparison of two secrets */
export function secretsEqual(provided, expected) {
  const a = String(provided || '');
  const b = String(expected || '');
  if (!b) return false;
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb) && a.length === b.length;
}

/**
 * Runs an express-style handler without a real request. Resolves with what it sent.
 * @param {(req: object, res: object) => unknown} handler
 * @param {object} body
 * @returns {Promise<{status: number, body: any}>}
 */
export function callHandler(handler, body) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('create-client handler timed out')), HANDLER_TIMEOUT_MS);
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { clearTimeout(timer); resolve({ status: this.statusCode, body: payload }); return this; },
    };
    Promise.resolve(handler({ body, autoOnboard: true, user: { email: 'auto-onboard@system', name: 'Auto onboard' } }, res)).catch((e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

/**
 * Round robin: the active CSM whose last assignment is oldest (never assigned goes first).
 * One atomic update both picks and stamps, so two payments at once never get the same person.
 */
export async function pickNextCsm(UserModel, now = new Date()) {
  const u = await UserModel.findOneAndUpdate(
    { $or: [{ role: 'csm' }, { roles: 'csm' }], isActive: true },
    { $set: { lastCsmAssignedAt: now } },
    { sort: { lastCsmAssignedAt: 1 }, new: true }
  ).lean();
  return u ? { email: String(u.email || '').toLowerCase(), name: u.name || u.email } : null;
}

/** Round robin over active dashboard managers, same rule as pickNextCsm. */
export async function pickNextDashboardManager(ManagerModel, now = new Date()) {
  const m = await ManagerModel.findOneAndUpdate(
    { isActive: true },
    { $set: { lastAssignedAt: now } },
    { sort: { lastAssignedAt: 1 }, new: true }
  ).lean();
  return m ? { email: String(m.email || '').toLowerCase(), name: m.fullName || m.email } : null;
}

/**
 * @param {{createClient: Function, UserModel: object, ManagerModel: object, NewUserModel: object, ClientModel: object,
 *   OnboardingJobModel: object, planWriteFields: (v: unknown) => ({planLabel: string}|null), now?: () => Date,
 *   onReady?: (dashboardEmail: string) => unknown,
 *   logger?: {log: Function, warn: Function}}} deps
 * @returns {(input: object) => Promise<{status: 'created'|'exists'|'invalid'|'bad_plan'|'failed', [k: string]: any}>}
 */
export function createAutoOnboard(deps) {
  const { createClient, UserModel, ManagerModel, NewUserModel, ClientModel, OnboardingJobModel, planWriteFields } = deps;
  const now = deps.now || (() => new Date());
  // Called with the dashboard email once the client is fully set up (or already was), to post in Discord right away.
  // Fire and forget: a Discord problem must never fail the onboarding, the 8:00 sweep is the fallback.
  const onReady = (dashboardEmail) => {
    try {
      Promise.resolve(deps.onReady?.(dashboardEmail)).catch((e) => logger.warn(`[auto-onboard] realtime Discord trigger failed: ${String(e?.message || e).slice(0, 150)}`));
    } catch (e) {
      logger.warn(`[auto-onboard] realtime Discord trigger failed: ${String(e?.message || e).slice(0, 150)}`);
    }
  };
  const logger = deps.logger || console;

  return async function autoOnboard(input = {}) {
    const email = String(input.email || '').trim().toLowerCase();
    const name = String(input.name || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!EMAIL_RE.test(email)) return { status: 'invalid', error: 'a valid email is required' };
    if (!name) return { status: 'invalid', error: 'name is required' };

    // Already a client under this email, or the CRM lead's email? Leave it alone.
    const [user, tracking] = await Promise.all([
      NewUserModel.findOne({ email }).select('_id').lean(),
      ClientModel.findOne({ $or: [{ email }, { crmEmail: email }] }).select('email clientNumber').lean(),
    ]);
    if (user || tracking) {
      // The dashboard login may differ from the CRM email (a hand-made client): the Discord post goes by the dashboard one.
      const dashboardEmail = String(tracking?.email || email).toLowerCase();
      onReady(dashboardEmail);
      return { status: 'exists', email, dashboardEmail, clientNumber: tracking?.clientNumber ?? null };
    }

    // Only a new client needs a plan. An existing client paying again (add-on, renewal) is never refused for its plan.
    // Never guess the plan: a wrong plan sets the wrong application cap and price.
    const plan = planWriteFields(input.planType);
    if (!plan) return { status: 'bad_plan', error: `unrecognised plan "${String(input.planType || '').slice(0, 40)}"` };

    const [csm, manager] = await Promise.all([pickNextCsm(UserModel, now()), pickNextDashboardManager(ManagerModel, now())]);
    if (!csm) logger.warn('[auto-onboard] no active CSM to assign');
    if (!manager) logger.warn('[auto-onboard] no active dashboard manager to assign');

    const country = COUNTRIES.includes(input.country) ? input.country : undefined;
    const body = {
      currentPath: '/auto-onboard',
      email,
      password: DEFAULT_DASHBOARD_PASSWORD,
      name,
      planType: plan.planLabel,
      dashboardTeamLeadName: manager?.name || '',
      paymentEmail: email,
      oldEmail: email,
      dashboardCredentials: { username: email, password: DEFAULT_DASHBOARD_PASSWORD, loginUrl: DASHBOARD_LOGIN_URL },
      ...(input.amountPaid ? { amountPaid: String(input.amountPaid) } : {}),
      ...(input.currency ? { currency: String(input.currency) } : {}),
      ...(country ? { clientCountry: country } : {}),
    };

    const out = await callHandler(createClient, body);
    if (out.status !== 200) {
      // A parallel call may have created the client between our check and the create.
      if (out.status === 400 && /already exists/i.test(String(out.body?.error || ''))) {
        onReady(email);
        return { status: 'exists', email, dashboardEmail: email, clientNumber: null };
      }
      logger.warn(`[auto-onboard] create failed for ${email}: ${out.status} ${String(out.body?.error || '').slice(0, 200)}`);
      return { status: 'failed', error: String(out.body?.error || `create returned ${out.status}`).slice(0, 300) };
    }

    // The ticket was just made by the create handler: attach the CSM so the Discord bot can tag them.
    if (csm) {
      await OnboardingJobModel.updateOne(
        { clientEmail: email },
        { $set: { csmEmail: csm.email, csmName: csm.name } }
      );
    }
    const created = await ClientModel.findOne({ email }).select('clientNumber').lean();
    onReady(email);
    logger.log(`[auto-onboard] created ${email} number=${created?.clientNumber ?? '?'} csm=${csm?.email || '-'} manager=${manager?.name || '-'}`);
    return {
      status: 'created',
      email,
      clientNumber: created?.clientNumber ?? null,
      csm: csm?.email || '',
      dashboardManager: manager?.name || '',
      source: String(input.source || '').slice(0, 40),
    };
  };
}
