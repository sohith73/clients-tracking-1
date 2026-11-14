import { attendanceRouter } from './attendance/router.js';
import express from 'express';
import Stripe from 'stripe';
import compression from 'compression';
import mongoose from 'mongoose';
import { JobModel } from './JobModel.js';
import { checkPlanCap as checkPlanCapGuard, enforcePlanCapPostInsert as enforcePlanCapGuard } from './utils/planCapGuard.js';
import { ClientModel } from './ClientModel.js';
import { ProfileModel, profileSchema } from './ProfileModel.js';
import { UserModel } from './UserModel.js';
import { SessionKeyModel } from './SessionKeyModel.js';
import { ManagerModel } from './ManagerModel.js';
import OperationsModel from './OperationsModel.js';
import cors from 'cors'
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import 'dotenv/config';
import CreateCampaign from './controllers/NewCampaign.js';
import { decode, encode } from './utils/CodeExaminer.js';
import { LinkCampaignUtm, Click } from './schema_models/UtmSchema.js';
import { CallLogModel } from './CallLogModel.js';
import Twilio from 'twilio';
import { Queue, Worker, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import {
  getAllManagers,
  getManagerById,
  createManager,
  updateManager,
  deleteManager,
  uploadProfilePhoto
} from './controllers/ManagerController.js';
import { upload } from './utils/cloudinary.js';
import { uploadFile } from './utils/storageService.js';
import { encrypt } from './utils/CryptoHelper.js';
import { NewUserModel } from './schema_models/UserModel.js';
import { PLAN_PRICES, normalisePlanType, planWriteFields, planPaymentMismatch, applyPlanToClientUpdate } from './utils/planCaps.js';
import { ClientTodosModel } from './ClientTodosModel.js';
import {
  createOnboardingJobPayload,
  addClientActionToJobMoveHistory,
  getNextClientNumber,
  previewNextClientNumber,
  getCurrentClientNumber,
  listOnboardingJobs,
  getOnboardingJobById,
  getOnboardingJobComments,
  patchOnboardingJob,
  resolveOnboardingComment,
  postOnboardingJob,
  getOnboardingRoles,
  getNextResumeMakerApi,
  postOnboardingJobAttachment,
  patchOnboardingJobAttachment,
  getOnboardingNotifications,
  markOnboardingNotificationRead,
  addCommentReply,
  reopenComment,
  markAdminRead,
  getNonResolvedIssues,
  requestMove,
  approveMove,
  rejectMove,
  invalidateJobListCache,
  runHighAppliedJobsNotifications
} from './controllers/onboardingController.js';
import {
  chatStream,
  listChatUsers,
  listConversations,
  openConversation,
  getMessages as getChatMessages,
  postMessage as postChatMessage,
  markConversationRead,
  getPresence,
  typingPing
} from './controllers/chatController.js';
import { runChatEscalationSweep, runAdminDailyDigest, runTagDiscordReminders } from './utils/chatCrons.js';
import { ClientCounterModel } from './ClientCounterModel.js';
import { BUCKET_EXPR, buildRow, capDayWindow, runState } from './utils/jobAddReport.js';
import { objectIdAt } from './utils/addWindow.js';
import {
  parseDeliveryQuery, buildHistoryAggregation, computeScheduled, filterScheduled, toCounts, istDayString,
  escapeRegex as escapeNotificationSearch, computeCoverage, ACTIVE_CLIENT_FILTER,
} from './utils/notificationsLog.js';
import { OnboardingJobModel } from './OnboardingJobModel.js';
import { ClientOperationsModel } from './ClientOperationsModel.js';
import { setOtp, getOtp, deleteOtp, decrementAttempts, otpHash } from './utils/otpCache.js';
import { sendOtpEmail } from './utils/sendOtpEmail.js';
import {
  getAnalysisCache,
  setAnalysisCache,
  clearAnalysisCache,
  analysisCacheGeneration,
  ANALYSIS_CACHE_TTL,
  LAST_APPLIED_CACHE_TTL
} from './utils/analysisCache.js';
import {
  pGetAnalysisCache,
  pSetAnalysisCache,
  pClearAnalysisCache
} from './utils/persistentAnalysisCache.js';
import { istDayStamp, decideAnalysisCacheAction, ANALYSIS_PAYLOAD_VERSION } from './utils/analysisCachePolicy.js';
import { JOBRIGHT_CLIENT_EMAILS } from './data/jobrightClients.js';
import { autoUnpauseIfEligible, runAutoUnpauseSweep, AUTO_UNPAUSE_MIN_JOB_CARDS } from './utils/autoUnpauseNewClients.js';
import { addWindowDayStamp } from './utils/addWindow.js';
import { computeClientAddStats, emptyAddStat } from './utils/clientAddStats.js';
import { computeClientApplyStats, emptyApplyStat, APPLY_LOOKBACK_DAYS } from './utils/clientApplyStats.js';
import { deriveClientAlerts, summariseAlerts } from './utils/clientAlerts.js';
import { sweepDormantClientPerks, PERKS_DORMANT_DAYS } from './utils/clientPerks.js';
import { ensureDbIndexes } from './utils/ensureDbIndexes.js';
import { ExtensionIncentiveComplaintModel } from './ExtensionIncentiveComplaintModel.js';
import { ExtensionDailyIncentiveModel } from './ExtensionDailyIncentiveModel.js';
import { DiscordReminderLogModel } from './DiscordReminderLogModel.js';
import {
  istYmdRangeToUtcBounds,
  getExtensionIncentiveMetrics,
  countQualifiedClients,
  todayIstYmd,
  istHourNow,
} from './utils/extensionReportHelpers.js';
import multer from 'multer';
import FormData from 'form-data';
import cron from 'node-cron';
import { ClientEmailLogModel } from './ClientEmailLogModel.js';
import { sendMilestoneEmail } from './utils/clientMilestoneEmails.js';
import { getActiveGmailSender } from './utils/gmailSender.js';
import { notifyMilestoneSweep } from './utils/discordMilestoneNotify.js';
import {
  startGoogleAuth,
  googleAuthCallback,
  gmailStatus,
  gmailDisconnect
} from './controllers/GmailOauthController.js';

// Milestone counting whitelist: only Applied / Interviewing / Offer / Rejected.
// Excludes Saved (not yet applied), Removed / Deleted / Session variants.
// Stored statuses vary ("Applied", "applied", "Offer Extended", "rejected by client" etc.),
// so anchor to the start of the string and rely on the prefix.
const MILESTONE_COUNT_STATUS_RE = /^(applied|interview|offer|reject)/i;

// `currentStatus` is free text: the dashboard appends an attribution suffix, so
// a card reads "saved by Sathya" or "applied by Ops", not a bare status word.
// Comparing it with === therefore counts only the handful of rows that never
// got a suffix - which is why the monitor showed 3 saved while the client's
// own Job Tracker showed 19. The client dashboard buckets with
// startsWith('saved') and flashfire-dashboard-backend's classifyStatus() uses
// /^saved/i; this matches both.
const SAVED_STATUS_RE = /^saved/i;
// appliedDate is a locale string, not a Date, and parsing it is where the
// client statistics went wrong.
//
// Every row in this collection looks like "9/5/2026, 8:32:36 pm" - en-IN, so
// DAY first, and with the clock time glued on after a comma. The aggregation
// that fed the monitor split the whole string on "/" and handed the third
// piece straight to $convert, which meant the year came from the literal
// "2026, 8:32:36 pm". That conversion fails, onError returned 0, and every
// single job landed in year 0 - so any date range matched nothing at all and
// the Applied column read 0 for every client on every day.
//
// Measured before changing it: of 2,523 rows where the first two numbers
// differ (so the format is unambiguous), 2,523 read as D/M/Y when checked
// against the job's own ObjectId creation time, and 0 read as M/D/Y. Rows like
// "31/12/2025" settle it on their own. D/M/Y is therefore the default, and the
// $gt 12 test below still rescues a stray M/D/Y row if one is ever written.
const APPLIED_DATE_RE = /^\d{1,2}\/\d{1,2}\/\d{4}/;

// Stages that turn $appliedDate into a real _dt Date. Append them after a
// $match that has already required appliedDate: APPLIED_DATE_RE.
const APPLIED_DATE_STAGES = [
  // Drop the time: "9/5/2026, 8:32:36 pm" -> "9/5/2026".
  { $addFields: { _dateOnly: { $trim: { input: { $arrayElemAt: [{ $split: ['$appliedDate', ','] }, 0] } } } } },
  { $addFields: { _dp: { $split: ['$_dateOnly', '/'] } } },
  {
    $addFields: {
      _n0: { $convert: { input: { $arrayElemAt: ['$_dp', 0] }, to: 'int', onError: 0, onNull: 0 } },
      _n1: { $convert: { input: { $arrayElemAt: ['$_dp', 1] }, to: 'int', onError: 0, onNull: 0 } },
      _yr: { $convert: { input: { $arrayElemAt: ['$_dp', 2] }, to: 'int', onError: 0, onNull: 0 } }
    }
  },
  {
    $addFields: {
      // A second part above 12 can only be a day, so that row is M/D/Y.
      // Everything else is read as D/M/Y, which is what the data is.
      _day: { $cond: [{ $gt: ['$_n1', 12] }, '$_n1', '$_n0'] },
      _mon: { $cond: [{ $gt: ['$_n1', 12] }, '$_n0', '$_n1'] }
    }
  },
  // Never hand $dateFromParts something it would silently roll over into a
  // different year. A row that fails this is dropped, not misdated.
  {
    $match: {
      _yr: { $gte: 1970, $lte: 2100 },
      _mon: { $gte: 1, $lte: 12 },
      _day: { $gte: 1, $lte: 31 }
    }
  },
  { $addFields: { _dt: { $dateFromParts: { year: '$_yr', month: '$_mon', day: '$_day' } } } }
];

// The UI sends plain YYYY-MM-DD. _dt above is a calendar date at UTC midnight,
// so the window has to be midnight-to-midnight too or the last day of the
// range loses every job on it.
function appliedDateWindow(startDate, endDate) {
  const start = new Date(`${String(startDate).slice(0, 10)}T00:00:00.000Z`);
  const end = new Date(`${String(endDate).slice(0, 10)}T23:59:59.999Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return { start, end };
}

function milestoneCountFilter(userEmail) {
  return {
    userID: userEmail,
    currentStatus: { $regex: MILESTONE_COUNT_STATUS_RE }
  };
}
import { getPlanCap, getPlanMilestones, MIN_JOBS_FOR_EMAIL, getEffectiveCap, computeClientMilestones, referralApplicationsFor } from './utils/planCaps.js';

const FLASHFIRE_API_BASE_URL = process.env.VITE_FLASHFIRE_API_BASE_URL || 'https://dashboard-api.flashfirejobs.com';

// Shared secret for the dashboard backend's ops-gated routes (x-ops-key).
// The default mirrors Middlewares/RequireOpsKey.js over there, so this works
// on a box where the variable was never set - exactly as that middleware does.
// Set OPS_SECRET_KEY in production and set it to the SAME value in both
// services, or every provisioning call below comes back 401.
const FLASHFIRE_OPS_KEY = process.env.OPS_SECRET_KEY || 'flashfire@2025';

// Team-standard logins the autopilot falls back to, so a client is never
// stopped at a login step just because nobody typed the usual values in.
//   JobRight: the client's email + the standard JobRight password.
//   Panel:    the client's email + the standard dashboard password, and the
//             extension's master operator code (accepted locally by
//             jr-direct-extension/sidepanel.js, never sent to the dashboard).
// A value already saved for a client always wins over these.
const DEFAULT_JR_PASSWORD = process.env.DEFAULT_JR_PASSWORD || 'Jobhunt@2026';
const DEFAULT_PANEL_PASSWORD = process.env.DEFAULT_PANEL_PASSWORD || 'flashfire@123';
const DEFAULT_PANEL_CODE = process.env.DEFAULT_PANEL_CODE || '00000';

// Write autopilot credential fields through the dashboard backend's ops-gated
// upsert (PUT /autopilot/creds/:email changes only the fields it is sent).
// Returns { ok, status, message } and never throws.
async function saveAutopilotCreds(email, fields, updatedBy = '') {
  const url = `${FLASHFIRE_API_BASE_URL.replace(/\/+$/, '')}/autopilot/creds/${encodeURIComponent(email)}`;
  try {
    const resp = await fetch(url, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-ops-key': FLASHFIRE_OPS_KEY },
      body: JSON.stringify({ ...fields, updatedBy }),
      signal: AbortSignal.timeout(15000),
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const message = resp.status === 401
        ? 'ops key rejected - OPS_SECRET_KEY must match the dashboard backend'
        : (body.message || `HTTP ${resp.status}`);
      return { ok: false, status: resp.status, message };
    }
    return { ok: true, status: 200, message: '' };
  } catch (e) {
    const message = e?.name === 'TimeoutError' ? 'dashboard backend timed out' : (e?.message || 'request failed');
    return { ok: false, status: 502, message };
  }
}

// Fill the panel half of a client's login with the team defaults, blanks only.
// Reads the raw record first because the dashboard's PUT overwrites whatever
// it is sent, and a client's own panel password must survive.
async function fillPanelDefaults(email, updatedBy = '') {
  const current = await fetchAutopilotJrCreds(email, true);
  if (current.reason && !current.onFile && current.reason !== 'no credentials on file') {
    return { ok: false, filled: [], message: current.reason };
  }
  const c = current.creds || {};
  const want = { extEmail: email, extPassword: DEFAULT_PANEL_PASSWORD, extCode: DEFAULT_PANEL_CODE };
  const fill = {};
  for (const [k, v] of Object.entries(want)) {
    if (!String(c[k] || '').trim()) fill[k] = v;
  }
  if (!Object.keys(fill).length) return { ok: true, filled: [], message: '' };
  const saved = await saveAutopilotCreds(email, fill, updatedBy);
  return { ok: saved.ok, filled: saved.ok ? Object.keys(fill) : [], message: saved.message };
}

// Give a client the JobRight credentials the autopilot needs.
//
// Fired when an operator flips Client Job Analysis -> JobRight -> Yes. The
// account has just been created by hand; this saves someone having to open the
// autopilot afterwards and type the same standard password for the 300th time.
//
// The dashboard backend owns the credential store, so the semantics live there
// (POST /autopilot/creds/:email/provision - idempotent, fills blanks only,
// never overwrites a client's own password). This is only the call.
//
// It NEVER throws. Marking the flag is the operator's actual intent and must
// succeed even if the dashboard backend is down or the keys have drifted; the
// caller reports what happened so a failure is visible rather than silent.
async function provisionAutopilotJrCreds(email, updatedBy = '') {
  const url = `${FLASHFIRE_API_BASE_URL.replace(/\/+$/, '')}/autopilot/creds/${encodeURIComponent(email)}/provision`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ops-key': FLASHFIRE_OPS_KEY },
      body: JSON.stringify({ updatedBy }),
      // A hung dashboard backend must not hold the operator's toggle open.
      signal: AbortSignal.timeout(15000),
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const reason = resp.status === 401
        ? 'ops key rejected - OPS_SECRET_KEY must match the dashboard backend'
        : (body.message || `HTTP ${resp.status}`);
      console.warn(`provisionAutopilotJrCreds(${email}): ${reason}`);
      return { provisioned: false, reason };
    }
    return {
      provisioned: true,
      created: body.created === true,
      filled: Array.isArray(body.filled) ? body.filled : [],
      autoLoginReady: body.autoLoginReady === true,
    };
  } catch (e) {
    const reason = e?.name === 'TimeoutError' ? 'dashboard backend timed out' : (e?.message || 'request failed');
    console.warn(`provisionAutopilotJrCreds(${email}): ${reason}`);
    return { provisioned: false, reason };
  }
}

// Read a client's autopilot credentials back out of the dashboard backend.
//
// The portal shows these on Client Job Analysis and AI Summaries so a manager
// who flips "JobRight: Yes" can confirm the account details landed, instead of
// trusting a toast that scrolled away.
//
// WHY THIS PROXIES INSTEAD OF THE BROWSER CALLING DIRECTLY
// GET /autopilot/creds/:email is behind x-ops-key, and that key also guards
// /operations/reminders/* which can email clients. Vite inlines env vars at
// build time, so putting the key in the frontend would publish it to every
// visitor (the same reason AutoExtensionReport.jsx sends no ops key). Here the
// key stays on the server and the caller proves itself with the portal's own
// JWT instead.
//
// Never throws: a credentials panel that cannot load must not 500 the page.
async function fetchAutopilotJrCreds(email, withCode = false) {
  const url = `${FLASHFIRE_API_BASE_URL.replace(/\/+$/, '')}/autopilot/creds/${encodeURIComponent(email)}`;
  try {
    const resp = await fetch(url, {
      headers: { 'x-ops-key': FLASHFIRE_OPS_KEY },
      signal: AbortSignal.timeout(15000),
    });
    // 404 is the documented "no credentials on file" answer, not a failure.
    if (resp.status === 404) return { onFile: false, creds: null, reason: 'no credentials on file' };
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const reason = resp.status === 401
        ? 'ops key rejected - OPS_SECRET_KEY must match the dashboard backend'
        : (body.message || `HTTP ${resp.status}`);
      return { onFile: false, creds: null, reason };
    }
    const d = body.data || {};
    const jrReady = !!String(d.jrEmail || '').trim() && !!String(d.jrPassword || '').trim();
    const panelReady = !!String(d.extEmail || '').trim() && !!String(d.extPassword || '').trim()
      && !!String(d.extCode || '').trim();
    return {
      onFile: true,
      reason: '',
      creds: {
        jrEmail: d.jrEmail || '',
        jrPassword: d.jrPassword || '',
        extEmail: d.extEmail || '',
        extPassword: d.extPassword || '',
        // extCode is deliberately not returned. It is the same operator code
        // for every client, so it is not information this panel exists to
        // show, and sending it would put a shared secret in the browser's
        // network tab on a screen that gets screenshotted. The UI only needs
        // to know whether one is saved. withCode is for server-side callers
        // (fillPanelDefaults) that must tell blank from set.
        ...(withCode ? { extCode: d.extCode || '' } : {}),
        hasExtCode: !!String(d.extCode || '').trim(),
        hcSearch: d.hcSearch || '',
        // The autopilot logs into JobRight AND the extension panel, and stops
        // at whichever login is missing ("Panel login needed"). So it is only
        // ready unattended when both halves are saved; say which half is not.
        jrReady,
        panelReady,
        autoLoginReady: jrReady && panelReady,
      },
    };
  } catch (e) {
    const reason = e?.name === 'TimeoutError' ? 'dashboard backend timed out' : (e?.message || 'request failed');
    return { onFile: false, creds: null, reason };
  }
}

// Short TTL cache for client profile from flashfire (avoids hammering external API, keeps dashboard details fast)
const PROFILE_CACHE_TTL_MS = 90 * 1000; // 90 seconds
const profileCache = new Map();
function getCachedProfile(email) {
  const entry = profileCache.get(email);
  if (!entry) return null;
  if (Date.now() > entry.exp) { profileCache.delete(email); return null; }
  return entry.data;
}
function setCachedProfile(email, data) {
  profileCache.set(email, { data, exp: Date.now() + PROFILE_CACHE_TTL_MS });
}

// If flashfire dashboard uses a different DB, set PROFILE_MONGODB_URI to its MONGODB_URI to read profiles from there
let profileConnection = null;
function getProfileModel() {
  const profileUri = process.env.PROFILE_MONGODB_URI || process.env.FLASHFIRE_MONGODB_URI;
  if (profileUri && profileUri !== process.env.MONGODB_URI) {
    if (!profileConnection) {
      profileConnection = mongoose.createConnection(profileUri);
    }
    return profileConnection.models.Profile || profileConnection.model('Profile', profileSchema);
  }
  return ProfileModel;
}

const fileUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});




// Environment Variables
const PORT = process.env.PORT || 10000;
const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET;
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY;
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET;

// Validate required environment variables
if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI environment variable is required');
  process.exit(1);
}

if (!JWT_SECRET) {
  console.error('❌ JWT_SECRET environment variable is required');
  process.exit(1);
}

if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
  console.error('❌ Cloudinary environment variables are required');
  process.exit(1);
}

const app = express();
// app.use(cors({
//   origin: process.env.CORS_ORIGIN || 'https://dashboardtracking.vercel.app',
//   credentials: true
// }));
// app.use(express.json());
const allowedOrigins = [
  // Development origins
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "http://localhost:5176",

  // Production origins
  "https://flashfire-frontend-hoisted.vercel.app",
  "https://flashfirejobs.com",
  "https://www.flashfirejobs.com",
  "https://flashfire-frontend-hoisted.vercel.app/",
  "https://utm-track-frontend.vercel.app",
  "https://dashboardtracking.vercel.app",
  "https://clients-tracking.vercel.app",
  "https://dashboardtracking.vercel.app/",
  "https://portal.flashfirejobs.com",
  "https://www.portal.flashfirejobs.com",
  "https://flashfire-dashboard-frontend.vercel.app",
  "https://flashfire-dashboard.vercel.app",
  "https://hq.flashfirejobs.com/",
  "https://hq.flashfirejobs.com",
  "https://portal.flashfirejobs.com",
  "https://portal.flashfirejobs.com/",
  "https://portal.flashfirejobs.com",

  // Additional origins from environment variable
  ...(process.env.ALLOWED_ORIGINS?.split(",") || [])
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true); // allow non-browser requests
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      } else {
        return callback(new Error("Not allowed by CORS"), false);
      }
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);
app.options(/.*/, cors());

// Gzip all JSON/text responses — cuts payload size 60-80%
app.use(compression());

// ── Stripe webhook (must be registered BEFORE express.json() so the raw body is preserved) ──
app.post('/api/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  const discordWebhookUrl = process.env.DISCORD_STRIPE_WEBHOOK_URL;

  if (!stripeSecret || !webhookSecret) {
    console.error('Stripe keys not configured');
    return res.status(500).send('Stripe not configured');
  }

  const stripe = new Stripe(stripeSecret);
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type !== 'checkout.session.completed') {
    return res.json({ received: true });
  }

  const session = event.data.object;
  const email = (session.client_reference_id || session.customer_details?.email || '').toLowerCase();
  const metadata = session.metadata || {};
  const type = metadata.type; // 'upgrade' or 'addon'
  const planTarget = metadata.plan; // e.g. 'professional', 'executive'
  const addonApps = metadata.addon; // e.g. '250', '500', '1000'
  const currency = (session.currency || 'usd').toUpperCase();
  const amountPaid = ((session.amount_total || 0) / 100).toFixed(2);
  const currentDate = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });

  if (!email) {
    console.error('Stripe webhook: no email in client_reference_id or customer_details');
    return res.status(200).json({ received: true, warning: 'no email found' });
  }

  try {
    const existingClient = await ClientModel.findOne({ email }).lean();
    if (!existingClient) {
      console.error(`Stripe webhook: client not found for email ${email}`);
      // Still return 200 so Stripe doesn't retry
      return res.status(200).json({ received: true, warning: 'client not found' });
    }

    if (type === 'upgrade' && planTarget) {
      const planFields = planWriteFields(planTarget);
      if (!planFields) {
        console.error(`Stripe webhook: unknown plan ${planTarget}`);
        return res.status(200).json({ received: true, warning: 'unknown plan' });
      }
      const { planType: planTypeLower, planPrice, planLabel: capitalizedPlan } = planFields;
      const currentAmountPaid = parseFloat(existingClient.amountPaid?.toString().replace(/[$₹£€,\s]|CAD|AUD/gi, '') || '0');
      const currentPlanPrice = existingClient.planPrice || 0;
      const newAmountPaid = currentAmountPaid + (planPrice - currentPlanPrice);
      const planChanged = String(existingClient.planType || '').toLowerCase() !== planTypeLower;

      const upgradeOps = {
        $set: { planType: planTypeLower, planPrice, amountPaid: newAmountPaid.toString(), amountPaidDate: currentDate, updatedAt: currentDate },
        $push: { upgradePayments: { amount: parseFloat(amountPaid), currency, for: `plan_upgrade_to_${planTypeLower}`, paidAt: currentDate } },
      };
      if (planChanged) {
        upgradeOps.$unset = {
          'milestonesNotified.count_250': '', 'milestonesNotified.count_350': '',
          'milestonesNotified.count_700': '', 'milestonesNotified.completed': ''
        };
      }
      await ClientModel.updateOne({ email }, upgradeOps, { runValidators: false });
      await NewUserModel.updateOne({ email }, { $set: { planType: capitalizedPlan, updatedAt: currentDate } }, { runValidators: false });
      console.log(`✅ Stripe webhook: upgraded ${email} to ${capitalizedPlan}`);

      if (discordWebhookUrl) {
        await fetch(discordWebhookUrl, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: `✅ **Plan Upgrade via Stripe**\n📧 ${email}\n📦 → ${capitalizedPlan}\n💰 ${currency} ${amountPaid}` }),
        }).catch(() => {});
      }

    } else if (type === 'addon' && addonApps) {
      const addonType = addonApps; // '250', '500', '1000'
      const addonPrice = parseFloat(amountPaid);
      const currentAmountPaid = parseFloat(existingClient.amountPaid?.toString().replace(/[$₹£€,\s]|CAD|AUD/gi, '') || '0');
      const newAmountPaid = currentAmountPaid + addonPrice;
      const existingAddons = existingClient.addons || [];
      const newAddon = { type: addonType, price: addonPrice, addedAt: currentDate };

      await ClientModel.updateOne(
        { email },
        {
          $set: { addons: [...existingAddons, newAddon], amountPaid: newAmountPaid.toString(), amountPaidDate: currentDate, updatedAt: currentDate },
          $push: { upgradePayments: { amount: addonPrice, currency, for: `addon_${addonType}`, paidAt: currentDate } },
        },
        { runValidators: false }
      );
      console.log(`✅ Stripe webhook: added ${addonType} addon to ${email}`);

      if (discordWebhookUrl) {
        await fetch(discordWebhookUrl, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: `✅ **Add-On Purchase via Stripe**\n📧 ${email}\n➕ +${addonType} applications\n💰 ${currency} ${amountPaid}` }),
        }).catch(() => {});
      }

    } else {
      console.warn(`Stripe webhook: unhandled metadata type="${type}" plan="${planTarget}" addon="${addonApps}"`);
    }

  } catch (err) {
    console.error('Stripe webhook processing error:', err);
    return res.status(500).json({ error: err.message });
  }

  res.json({ received: true });
});

app.use(express.json());
// Twilio webhooks send application/x-www-form-urlencoded by default
app.use(express.urlencoded({ extended: false }));
//Helpers
// function getClientIP(req) {
//   const xff = req.headers["x-forwarded-for"];
//   if (typeof xff === "string" && xff.length > 0) {
//     // may contain multiple IPs: "client, proxy1, proxy2"
//     return xff.split(",")[0].trim();
//   }
//   const ip = req.socket?.remoteAddress || req.ip || "";
//   // strip IPv6 prefix like '::ffff:'
//   return ip.replace(/^::ffff:/, "");
// }

// Middleware to verify JWT token
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(400).json({ error: 'Invalid token.' });
  }
};

// Optional auth: decode token if present and set req.user, but never fail (for audit logging)
const optionalVerifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return next();
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
  } catch (_) { /* ignore invalid token */ }
  next();
};

// Add a referral entry for a user
const addReferralForUser = async (req, res) => {
  try {
    const { email } = req.params;
    const { referredName, plan, notes } = req.body || {};

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email is required",
      });
    }

    if (!referredName || typeof referredName !== "string") {
      return res.status(400).json({
        success: false,
        error: "Referred client name is required",
      });
    }

    if (plan !== "Professional" && plan !== "Executive") {
      return res.status(400).json({
        success: false,
        error: 'Plan must be either "Professional" or "Executive"',
      });
    }

    const newReferral = {
      name: referredName.trim(),
      plan,
      notes: typeof notes === "string" ? notes.trim() : "",
      createdAt: new Date(),
    };

    const updateQuery = { $push: { referrals: newReferral } };

    if (newReferral.notes) {
      // Keep top-level notes in sync with the latest referral note
      updateQuery.$set = {
        notes: newReferral.notes,
      };
    }

    const updatedUser = await NewUserModel.findOneAndUpdate(
      { email: email.toLowerCase() },
      updateQuery,
      { new: true, select: "name email referralStatus referrals notes" }
    );

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    const referralsArray = Array.isArray(updatedUser.referrals)
      ? updatedUser.referrals
      : [];

    let referralApplicationsAdded = 0;
    referralsArray.forEach((ref) => {
      if (ref?.plan === "Professional") {
        referralApplicationsAdded += 200;
      } else if (ref?.plan === "Executive") {
        referralApplicationsAdded += 300;
      }
    });

    return res.status(200).json({
      success: true,
      message: "Referral added successfully",
      user: {
        _id: updatedUser._id,
        name: updatedUser.name,
        email: updatedUser.email,
        referrals: referralsArray,
        referralStatus: updatedUser.referralStatus,
        notes: updatedUser.notes || "",
        referralApplicationsAdded,
      },
    });
  } catch (error) {
    console.error("Error adding referral for user:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to add referral",
    });
  }
};

// Remove a referral entry for a user by index
const removeReferralForUser = async (req, res) => {
  try {
    const { email, index } = req.params;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email is required",
      });
    }

    const referralIndex = Number(index);
    if (Number.isNaN(referralIndex) || referralIndex < 0) {
      return res.status(400).json({
        success: false,
        error: "Valid referral index is required",
      });
    }

    const user = await NewUserModel.findOne({ email: email.toLowerCase() }).select(
      "name email referralStatus referrals notes"
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    const referralsArray = Array.isArray(user.referrals) ? user.referrals : [];

    if (referralIndex >= referralsArray.length) {
      return res.status(400).json({
        success: false,
        error: "Referral index out of range",
      });
    }

    referralsArray.splice(referralIndex, 1);

    let latestNotes = user.notes || "";
    if (referralsArray.length > 0) {
      const lastReferralWithNotes = [...referralsArray].reverse().find((r) => r?.notes);
      latestNotes = lastReferralWithNotes?.notes || latestNotes || "";
    } else {
      latestNotes = latestNotes || "";
    }

    user.referrals = referralsArray;
    user.notes = latestNotes;

    await user.save();

    let referralApplicationsAdded = 0;
    referralsArray.forEach((ref) => {
      if (ref?.plan === "Professional") {
        referralApplicationsAdded += 200;
      } else if (ref?.plan === "Executive") {
        referralApplicationsAdded += 300;
      }
    });

    return res.status(200).json({
      success: true,
      message: "Referral removed successfully",
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        referrals: referralsArray,
        referralStatus: user.referralStatus,
        notes: user.notes || "",
        referralApplicationsAdded,
      },
    });
  } catch (error) {
    console.error("Error removing referral for user:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to remove referral",
    });
  }
};

// Middleware to check admin role
const verifyAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied. Admin role required.' });
  }
  next();
};

// The JobRight toggle is gated by DIRECTION, not just by role.
//
// Marking a client Yes is the safe, routine direction: it records that the
// account exists and provisions the autopilot credentials, and it is the team
// lead's own job to do as they onboard a client. Setting it back to No is the
// destructive one - it hides the client from every "who still needs an
// account" view, and a careless revert is invisible until runs quietly stop
// producing jobs. So that direction stays with admins.
//
// Gating on the TARGET value is the whole rule: sending true is always the
// permissive direction and sending false always the restricted one, whatever
// the row currently says. Re-sending the value a row already holds is a no-op
// that lands in the same bucket, which is correct.
const verifyJobrightToggle = (req, res, next) => {
  const role = req.user?.role || '';
  if (role === 'admin') return next();

  const value = req.body?.jobrightCreated;
  if (value === true && role === 'team_lead') return next();

  return res.status(403).json({
    error: value === false
      ? 'Only admins can change JobRight back to No.'
      : 'Only admins and team leads can change JobRight status.',
  });
};

// Reading a client's JobRight credentials returns their real passwords, so it
// is limited to the same people who may set the toggle: admins and team leads.
// Unlike the write gate this allows team leads in both directions, because
// reading changes nothing.
const verifyJobrightRead = (req, res, next) => {
  const role = req.user?.role || '';
  if (role === 'admin' || role === 'team_lead') return next();
  return res.status(403).json({ error: 'Only admins and team leads can view JobRight credentials.' });
};

// Allow admin, CSM, or team_lead to manage operations (link/remove operations interns to clients)
const verifyOperationsManage = (req, res, next) => {
  const role = req.user?.role || '';
  const roles = req.user?.roles || [];
  if (role === 'admin' || role === 'csm' || role === 'team_lead' || roles.includes('csm')) return next();
  return res.status(403).json({ error: 'Access denied. Only admin, CSM, or team lead can manage operations.' });
};

const normalizeEmail = (email) => (email || '').toLowerCase().trim();

const getTeamLeadEmailSet = async () => {
  const teamLeads = await UserModel.find({
    role: 'team_lead'
  }).select('email').lean();

  return new Set(teamLeads.map(user => normalizeEmail(user.email)).filter(Boolean));
};

const ConnectDB = () => {
  if (!process.env.MONGODB_URI || String(process.env.MONGODB_URI).trim() === '') {
    console.error('❌ MONGODB_URI is not set. Add it to .env (e.g. mongodb+srv://... or mongodb://localhost:27017/dbname)');
    process.exit(1);
  }
  return mongoose.connect(process.env.MONGODB_URI, {
    maxPoolSize: 10,
    minPoolSize: 1,
    maxIdleTimeMS: 86_400_000,
    socketTimeoutMS: 86_400_000,
    serverSelectionTimeoutMS: 30_000,
  })
    .then(async () => {
      try {
        await ensureDbIndexes();
        console.log('✅ MongoDB connected and indexes ensured');
      } catch (idxErr) {
        console.error('❌ Failed to ensure DB indexes:', idxErr?.message || idxErr);
        throw idxErr;
      }
    })
    .catch((error) => {
      console.error('❌ Database connection failed:', error?.message || error);
      process.exit(1);
    });
};
/** Wait for this before listen() — avoids buffered query timeouts (10s) while MongoDB is still connecting. */
const dbReady = ConnectDB();

// Admin users are managed manually in the database
// No automatic admin user creation

// Clean up invalid session keys
const cleanupSessionKeys = async () => {
  try {
    // Try to drop and recreate the collection to fix index issues
    try {
      await SessionKeyModel.collection.drop();
    } catch (dropError) {
      // Collection might not exist, that's okay
    }

    // Recreate the collection
    await SessionKeyModel.createCollection();
  } catch (error) {
    console.error('❌ Error cleaning up session keys:', error);
  }
};

// Session cleanup runs after dbReady (see server start below), not on a blind timer
//get all the jobdatabase data..
const getAllJobs = async (req, res) => {
  const jobDB = await JobModel.find({ operatorEmail: req.body.email }).select('-jobDescription').lean();
  res.status(200).json({ jobDB });
}

// Client management endpoints
const getAllClients = async (req, res) => {
  try {
    const clients = await ClientModel.find()
      .select('email name clientNumber status planType planPrice jobStatus operationsName dashboardTeamLeadName isPaused onboardingPhase addons upgradePayments amountPaid createdAt updatedAt')
      .lean();
    res.status(200).json({ clients });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

const getClientByEmail = async (req, res) => {
  try {
    const { email } = req.params;
    const client = await ClientModel.findOne({ email: email.toLowerCase() }).lean();
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Get manager name from users collection and add it to client data
    const user = await NewUserModel.findOne({ email: email.toLowerCase() }).lean();
    const managerName = user?.dashboardManager || '';

    // Add manager name to client data while keeping everything else from dashboardtrackings
    const clientWithManager = {
      ...client,
      dashboardManager: managerName // Only this field comes from users collection
    };

    res.status(200).json({ client: clientWithManager });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

/**
 * POST /api/clients/addnumbers
 * Retroactively assign client numbers to clients ordered by creation date.
 * Body: { startNumber: number } - the number to assign to the first (oldest) client.
 * Subsequent clients get startNumber+1, startNumber+2, etc.
 * Also updates ClientCounter so future auto-generated numbers don't conflict.
 */
const addNumbersToClients = async (req, res) => {
  try {
    const { startNumber } = req.body;
    if (startNumber === undefined || startNumber === null) {
      return res.status(400).json({ error: 'startNumber is required in request body' });
    }
    const num = parseInt(String(startNumber).trim(), 10);
    if (isNaN(num) || num < 1) {
      return res.status(400).json({ error: 'startNumber must be a positive integer' });
    }

    // Get all clients ordered by creation (MongoDB _id is time-ordered)
    const clients = await ClientModel.find({})
      .sort({ _id: 1 })
      .select('_id email name clientNumber')
      .lean();

    if (clients.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No clients to update',
        updated: 0,
      });
    }

    const CLIENT_NUMBER_FLOOR = 5809;
    const bulkOps = clients.map((client, index) => ({
      updateOne: {
        filter: { _id: client._id },
        update: { $set: { clientNumber: num + index } },
      },
    }));

    await ClientModel.bulkWrite(bulkOps);

    const lastAssigned = num + clients.length - 1;
    // Ensure counter doesn't go backwards; future auto-gen uses max(lastNumber+1, FLOOR)
    await ClientCounterModel.findOneAndUpdate(
      { _id: 'client_number' },
      { $max: { lastNumber: Math.max(lastAssigned, CLIENT_NUMBER_FLOOR - 1) } },
      { upsert: true }
    );

    // Sync clientNumber to OnboardingJob documents so both views stay in sync
    const synced = await syncClientNumbersToOnboardingJobs().catch(() => 0);

    res.status(200).json({
      success: true,
      message: `Assigned numbers ${num} to ${lastAssigned} to ${clients.length} clients (ordered by creation)`,
      updated: clients.length,
      syncedOnboardingJobs: synced,
      range: { from: num, to: lastAssigned },
    });
  } catch (error) {
    console.error('addNumbersToClients error:', error);
    res.status(500).json({ error: error.message || 'Failed to add numbers to clients' });
  }
};

// Get client onboarding statistics grouped by month
const getClientStats = async (req, res) => {
  try {
    // Get all clients from ClientModel to ensure consistency with revenue stats
    const allClients = await ClientModel.find({}).lean();

    // Count clients by month from August 2025 onwards
    const monthlyStatsMap = {};
    let totalClients = 0;

    allClients.forEach(client => {
      // Parse createdAt string to Date
      let clientDate;
      try {
        clientDate = new Date(client.createdAt);
        if (isNaN(clientDate.getTime())) {
          return; // Skip invalid dates
        }
      } catch (error) {
        return; // Skip parsing errors
      }

      // Filter for August 2025 onwards
      const startDate = new Date('2025-08-01');
      if (clientDate < startDate) {
        return;
      }

      totalClients++;

      // Group by month
      const year = clientDate.getFullYear();
      const month = clientDate.getMonth() + 1;
      const monthKey = `${year}-${month.toString().padStart(2, '0')}`;

      if (!monthlyStatsMap[monthKey]) {
        monthlyStatsMap[monthKey] = {
          year,
          month,
          count: 0
        };
      }
      monthlyStatsMap[monthKey].count++;
    });

    // Convert to array format matching the old structure
    const monthlyStats = Object.values(monthlyStatsMap).sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      return a.month - b.month;
    }).map(stat => ({
      _id: { year: stat.year, month: stat.month },
      count: stat.count
    }));

    // Get current month stats
    const currentMonth = new Date().getMonth() + 1;
    const currentYear = new Date().getFullYear();
    const currentMonthCount = monthlyStats.find(
      stat => stat._id.month === currentMonth && stat._id.year === currentYear
    )?.count || 0;

    // Get last month stats
    const lastMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const lastMonthYear = currentMonth === 1 ? currentYear - 1 : currentYear;
    const lastMonthCount = monthlyStats.find(
      stat => stat._id.month === lastMonth && stat._id.year === lastMonthYear
    )?.count || 0;

    // Calculate growth percentage
    const growthPercentage = lastMonthCount > 0
      ? ((currentMonthCount - lastMonthCount) / lastMonthCount * 100).toFixed(1)
      : currentMonthCount > 0 ? 100 : 0;

    // Format monthly data for charts from August 2025 onwards
    const monthNames = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
    ];

    const formattedMonthlyData = [];
    const currentDate = new Date();
    const startDateForLoop = new Date('2025-08-01');

    // Generate months from August 2025 to current month
    for (let date = new Date(startDateForLoop); date <= currentDate; date.setMonth(date.getMonth() + 1)) {
      const year = date.getFullYear();
      const month = date.getMonth() + 1;

      const statsForMonth = monthlyStats.find(
        stat => stat._id.month === month && stat._id.year === year
      );

      formattedMonthlyData.push({
        month: `${monthNames[month - 1]} ${year}`,
        count: statsForMonth?.count || 0,
        year,
        monthNumber: month
      });
    }

    res.status(200).json({
      success: true,
      data: {
        totalClients,
        currentMonthCount,
        lastMonthCount,
        growthPercentage: parseFloat(growthPercentage),
        monthlyData: formattedMonthlyData,
        rawMonthlyStats: monthlyStats
      }
    });
  } catch (error) {
    console.error('Error fetching client statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch client statistics',
      error: error.message
    });
  }
};

// (Auth routes removed)

/** Sets/clears pausedAt when pause/onboarding phase changes (explicit Paused = isPaused && !onboardingPhase). */
async function mergePausedAtIntoClientUpdate(emailLower, clientUpdate) {
  delete clientUpdate.pausedAt;
  const touchesPause =
    Object.prototype.hasOwnProperty.call(clientUpdate, 'isPaused') ||
    Object.prototype.hasOwnProperty.call(clientUpdate, 'onboardingPhase');
  if (!touchesPause) return;
  const existing = await ClientModel.findOne({ email: emailLower }).select('isPaused onboardingPhase pausedAt').lean();
  const nextPaused = Object.prototype.hasOwnProperty.call(clientUpdate, 'isPaused')
    ? !!clientUpdate.isPaused
    : !!(existing?.isPaused);
  const nextOnboarding = Object.prototype.hasOwnProperty.call(clientUpdate, 'onboardingPhase')
    ? !!clientUpdate.onboardingPhase
    : !!(existing?.onboardingPhase);
  const effectivelyPausedOnly = nextPaused === true && nextOnboarding !== true;
  const wasPausedOnly = !!(existing?.isPaused) && existing?.onboardingPhase !== true;
  if (effectivelyPausedOnly && !wasPausedOnly) {
    clientUpdate.pausedAt = new Date();
  } else if (!effectivelyPausedOnly) {
    clientUpdate.pausedAt = null;
  }
}

export const createOrUpdateClient = async (req, res) => {
  try {
    const {
      currentPath,
      email,
      password,
      name,
      clientNumber,
      jobDeadline,
      applicationStartDate,
      dashboardInternName,
      dashboardTeamLeadName,
      planType,
      onboardingDate,
      whatsappGroupMade,
      whatsappGroupMadeDate,
      dashboardCredentialsShared,
      dashboardCredentialsSharedDate,
      resumeSent,
      resumeSentDate,
      coverLetterSent,
      coverLetterSentDate,
      portfolioMade,
      portfolioMadeDate,
      linkedinOptimization,
      linkedinOptimizationDate,
      gmailCredentials,
      dashboardCredentials,
      linkedinCredentials,
      amountPaid,
      amountPaidDate,
      modeOfPayment,
      status,
      paymentEmail,
      oldEmail,
      currency: currencyFromBody,
      clientCountry,
    } = req.body;

    const emailLower = email.toLowerCase();
    const dashboardManager = dashboardTeamLeadName;

    // Normalize + validate paymentEmail (milestone recipient). Empty is OK
    // (optional field). If provided but malformed, reject so a typo doesn't
    // silently persist and break milestone delivery.
    const paymentEmailNorm = typeof paymentEmail === 'string' ? paymentEmail.trim().toLowerCase() : '';
    if (paymentEmailNorm && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(paymentEmailNorm)) {
      return res.status(400).json({ error: 'Invalid Payment Email format', code: 'bad_payment_email' });
    }

    // One resolution of the plan for BOTH collections. planFields is null when
    // the request carried no plan (or an unknown one); every write below then
    // falls back to the same DEFAULT_PLAN rather than each picking its own —
    // the tracking row used to default to "ignite" while the user row defaulted
    // to "Free Trial", so a client registered without a plan started life with
    // the badge saying Ignite (250 applications) and the cap enforcing 160.
    const planFields = planWriteFields(planType);
    const capitalizedPlan = planFields?.planLabel || null;
    const DEFAULT_PLAN = planWriteFields('ignite'); // matches the ClientModel schema default
    const resolvedPlan = planFields || DEFAULT_PLAN;
    if (!planFields && planType) {
      console.warn(`[clients] unknown planType "${planType}" for ${emailLower} — defaulting to ${DEFAULT_PLAN.planLabel}`);
    }

    // Resolve currency: explicit value from body first (symbol or ISO code), then the
    // amountPaid prefix. Anything outside the supported list falls back to USD.
    const currencySymbolMap = { "$": "USD", "₹": "INR", "£": "GBP", "€": "EUR", "CAD": "CAD", "AUD": "AUD" };
    const SUPPORTED_CURRENCIES = ["USD", "INR", "GBP", "EUR", "CAD", "AUD"];
    const CURRENCY_PREFIX = { USD: "$", INR: "₹", GBP: "£", EUR: "€", CAD: "CAD", AUD: "AUD" };
    const CURRENCY_COUNTRY = { CAD: "Canada", AUD: "Australia", GBP: "UK", EUR: "Europe" };
    const amountPaidStr = String(amountPaid || "").trim();
    const amountDetected = amountPaidStr.toUpperCase().startsWith("CAD") ? "CAD"
      : amountPaidStr.toUpperCase().startsWith("AUD") ? "AUD"
      : amountPaidStr.startsWith("₹") ? "INR"
      : amountPaidStr.startsWith("£") ? "GBP"
      : amountPaidStr.startsWith("€") ? "EUR"
      : amountPaidStr.startsWith("$") ? "USD"
      : null;
    const bodyCurrency = typeof currencyFromBody === 'string' ? currencyFromBody.trim() : '';
    const bodyCurrencyCode = currencySymbolMap[bodyCurrency] || bodyCurrency.toUpperCase();
    const detectedCurrency = SUPPORTED_CURRENCIES.includes(bodyCurrencyCode)
      ? bodyCurrencyCode
      : (amountDetected || "USD");
    // Keep the stored amountPaid prefix in step with the resolved currency
    // (e.g. a bare "500" with currency AUD is stored as "AUD500").
    const amountPaidNormalized = amountPaidStr && /^[\d.,]+$/.test(amountPaidStr)
      ? `${CURRENCY_PREFIX[detectedCurrency]}${amountPaidStr}`
      : amountPaid;
    const resolvedClientCountry = clientCountry || CURRENCY_COUNTRY[detectedCurrency] || undefined;

    const userData = {
      name,
      email: emailLower,
      passwordHashed: password ? encrypt(password) : encrypt("flashfire@123"),
      ...(capitalizedPlan && { planType: capitalizedPlan }),
      userType: "User",
      dashboardManager,
      currency: detectedCurrency,
    };

    const existingUser = await NewUserModel.findOne({ email: emailLower });
    const hasNameForNewUser = name !== undefined && name !== null && String(name).trim() !== '';

    // Only create new user + new client when we have required fields (name). Otherwise treat as client-only update (e.g. Phase/Pause from Client Job Analysis).
    if (!existingUser && hasNameForNewUser) {
      const newUserData = {
        ...userData,
        planType: resolvedPlan.planLabel,
      };
      let newUser;
      try {
        newUser = await NewUserModel.create(newUserData);
      } catch (userErr) {
        console.error("❌ Error creating user:", userErr);
        // Check if it's a duplicate key error
        if (userErr.code === 11000) {
          return res.status(400).json({ 
            error: `User with email ${emailLower} already exists in users collection`,
            details: userErr.message 
          });
        }
        throw userErr;
      }

      let finalClientNumber;
      const CLIENT_NUMBER_FLOOR = 5809;
      if (clientNumber !== undefined && clientNumber !== null && clientNumber !== '') {
        const num = parseInt(String(clientNumber).trim(), 10);
        if (!isNaN(num) && num >= CLIENT_NUMBER_FLOOR) {
          finalClientNumber = num;
          await ClientCounterModel.findOneAndUpdate(
            { _id: 'client_number' },
            { $max: { lastNumber: num } },
            { upsert: true }
          );
        } else {
          finalClientNumber = await getNextClientNumber();
        }
      } else {
        finalClientNumber = await getNextClientNumber();
      }

      const fullClientData = {
        email: emailLower,
        name,
        clientNumber: finalClientNumber,
        jobDeadline: jobDeadline || " ",
        applicationStartDate: applicationStartDate || " ",
        dashboardInternName: dashboardInternName || " ",
        dashboardTeamLeadName,
        planType: resolvedPlan.planType,
        planPrice: resolvedPlan.planPrice,
        onboardingDate: onboardingDate || new Date().toISOString(),
        whatsappGroupMade: whatsappGroupMade ?? false,
        whatsappGroupMadeDate: whatsappGroupMadeDate || " ",
        dashboardCredentialsShared: dashboardCredentialsShared ?? false,
        dashboardCredentialsSharedDate: dashboardCredentialsSharedDate || " ",
        resumeSent: resumeSent ?? false,
        resumeSentDate: resumeSentDate || " ",
        coverLetterSent: coverLetterSent ?? false,
        coverLetterSentDate: coverLetterSentDate || " ",
        portfolioMade: portfolioMade ?? false,
        portfolioMadeDate: portfolioMadeDate || " ",
        linkedinOptimization: linkedinOptimization ?? false,
        linkedinOptimizationDate: linkedinOptimizationDate || " ",
        gmailCredentials: gmailCredentials || { email: "", password: "" },
        dashboardCredentials: dashboardCredentials || {
          username: "",
          password: "",
        },
        linkedinCredentials: linkedinCredentials || {
          username: "",
          password: "",
        },
        amountPaid: amountPaidNormalized || 0,
        currency: detectedCurrency,
        amountPaidDate: amountPaidDate || " ",
        modeOfPayment: modeOfPayment || "paypal",
        paymentEmail: paymentEmailNorm,
        crmEmail: typeof oldEmail === 'string' ? oldEmail.trim().toLowerCase() : '',
        ...(resolvedClientCountry && { clientCountry: resolvedClientCountry }),
        status: status !== undefined && status !== null && status !== '' ? status : "active",
        isPaused: true,
        onboardingPhase: true,
        pausedAt: null,
        updatedAt: new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
      };

      let newTracking;
      try {
        newTracking = await ClientModel.create(fullClientData);
      } catch (clientErr) {
        console.error("❌ Error creating client, rolling back user creation:", clientErr);
        // Rollback: Delete the user that was created
        try {
          await NewUserModel.deleteOne({ email: emailLower });
          console.log(`✅ Rolled back: Deleted user ${emailLower} from users collection`);
        } catch (rollbackErr) {
          console.error("❌ Error during rollback:", rollbackErr);
        }
        // Check if it's a duplicate key error
        if (clientErr.code === 11000) {
          return res.status(400).json({ 
            error: `Client with email ${emailLower} already exists in dashboardtrackings collection`,
            details: clientErr.message 
          });
        }
        throw clientErr;
      }
      try {
        await createOnboardingJobPayload({
          clientEmail: emailLower,
          clientName: name,
          clientNumber: finalClientNumber,
          planType: capitalizedPlan || 'Professional',
          dashboardManagerName: dashboardManager || '',
          dashboardCredentials: dashboardCredentials || { username: '', password: '', loginUrl: '' },
          createdBy: req.user?.email || ''
        });
      } catch (onbErr) {
        console.error('Onboarding job creation failed:', onbErr?.message || onbErr);
      }
      return res.status(200).json({
        message: "✅ New client created successfully",
        newUser,
        newTracking,
      });
    }

    // No existing user and no name in body → client-only update (e.g. Phase/Pause); only update ClientModel
    if (!existingUser) {
      const clientUpdate = { ...req.body };
      delete clientUpdate.currentPath;
      applyPlanToClientUpdate(clientUpdate);
      await mergePausedAtIntoClientUpdate(emailLower, clientUpdate);
      await ClientModel.updateOne(
        { email: emailLower },
        { $set: clientUpdate },
        { runValidators: false }
      );
      // Log pause/unpause/New (phase) changes to job move history for audit (who did it: email + name)
      const movedBy = { email: req.user?.email || 'unknown', name: req.user?.name || '' };
      if (req.body.isPaused === true && req.body.onboardingPhase === true) {
        await addClientActionToJobMoveHistory(emailLower, 'client_phase_set', movedBy);
      } else if (req.body.isPaused === true) {
        await addClientActionToJobMoveHistory(emailLower, 'client_paused', movedBy);
      } else if (req.body.isPaused === false) {
        await addClientActionToJobMoveHistory(emailLower, 'client_unpaused', movedBy);
      }
      const updatedClientsTracking = await ClientModel.findOne({ email: emailLower }).lean();
      if (req.body.isPaused !== undefined || req.body.onboardingPhase !== undefined || req.body.dashboardTeamLeadName !== undefined || req.body.status !== undefined) {
        clearAnalysisCache();
        pClearAnalysisCache().catch(() => {});
      }
      return res.status(200).json({
        message: "🔄 Client fields updated successfully",
        updatedClientsTracking,
      });
    }

    if (currentPath?.includes("/clients/new")) {
      await NewUserModel.updateOne({ email: emailLower }, { $set: userData });
      const clientSet = { dashboardTeamLeadName: dashboardManager };
      // Persist paymentEmail from registration form for existing-user re-register.
      if (paymentEmailNorm) {
        clientSet.paymentEmail = paymentEmailNorm;
      }
      await ClientModel.updateOne(
        { email: emailLower },
        { $set: clientSet },
        { runValidators: false }
      );
      return res.status(200).json({
        message: "🟢 Existing client updated (partial update)",
      });
    }

    // ✅ partial update for existing client (any other path)
    // Only set client fields on ClientModel (exclude currentPath and other non-schema keys if needed)
    const clientUpdate = { ...req.body };
    delete clientUpdate.currentPath;
    // Normalize paymentEmail if it came through this path (already validated above).
    if (Object.prototype.hasOwnProperty.call(clientUpdate, 'paymentEmail')) {
      clientUpdate.paymentEmail = paymentEmailNorm;
    }
    const updatePlanFields = applyPlanToClientUpdate(clientUpdate);
    await mergePausedAtIntoClientUpdate(emailLower, clientUpdate);
    await ClientModel.updateOne(
      { email: emailLower },
      { $set: clientUpdate },
      { runValidators: false }
    );
    // Log pause/unpause/New (phase) changes to job move history for audit (who did it: email + name)
    const movedBy = { email: req.user?.email || 'unknown', name: req.user?.name || '' };
    if (req.body.isPaused === true && req.body.onboardingPhase === true) {
      await addClientActionToJobMoveHistory(emailLower, 'client_phase_set', movedBy);
    } else if (req.body.isPaused === true) {
      await addClientActionToJobMoveHistory(emailLower, 'client_paused', movedBy);
    } else if (req.body.isPaused === false) {
      await addClientActionToJobMoveHistory(emailLower, 'client_unpaused', movedBy);
    }
    // Only update NewUserModel when we have name/dashboard/plan from the request (Phase/Pause only sends email, isPaused, onboardingPhase — no name)
    const updateFields = {};
    if (name !== undefined && name !== null && String(name).trim() !== '') {
      updateFields.name = name;
    }
    if (dashboardManager !== undefined && dashboardManager !== null) {
      updateFields.dashboardManager = dashboardManager;
    }
    // Mirror the plan to users.planType. This is not cosmetic: the badge reads
    // dashboardtrackings.planType while the application cap is enforced off
    // users.planType, so letting one move without the other means the screen
    // and the limit disagree. Prefer the plan actually written to the tracking
    // document over the one derived from the raw body.
    const planLabelForUser = updatePlanFields?.planLabel || capitalizedPlan;
    if (planLabelForUser) {
      updateFields.planType = planLabelForUser;
    }
    if (Object.keys(updateFields).length > 0) {
      await NewUserModel.updateOne(
        { email: emailLower },
        { $set: updateFields },
        { runValidators: false }
      );
    }
    const updatedClientsTracking = await ClientModel.findOne({ email: emailLower }).lean();
    if (req.body.isPaused !== undefined || req.body.onboardingPhase !== undefined || req.body.dashboardTeamLeadName !== undefined || req.body.status !== undefined) {
      clearAnalysisCache();
      pClearAnalysisCache().catch(() => {});
    }

    return res
      .status(200)
      .json({ message: "🔄 Client fields updated successfully", updatedClientsTracking });
  } catch (error) {
    console.error("❌ Error in createOrUpdateClient:", error);
    res.status(500).json({ error: error.message });
  }
};

// Get operations names for dropdown
const getOperationsNames = async (req, res) => {
  try {
    const operations = await OperationsModel.find().select('name').lean();
    const names = operations.map(op => op.name).filter(name => name).sort();
    res.status(200).json({ success: true, names });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Same roster as GET /api/managers (Manager Dashboard) — fullName list only; kept for older clients.
const getDashboardManagerNames = async (req, res) => {
  try {
    const managers = await ManagerModel.find({ isActive: true }).select('fullName').lean();
    const names = managers.map(m => m.fullName).filter(name => name).sort();
    res.status(200).json({ success: true, names });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Update client operations name
const updateClientOperationsName = async (req, res) => {
  try {
    const { email, operationsName } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }

    const client = await ClientModel.findOneAndUpdate(
      { email: email.toLowerCase() },
      {
        operationsName: operationsName || '',
        updatedAt: new Date().toLocaleString('en-US', 'Asia/Kolkata')
      },
      { new: true }
    ).select('email operationsName').lean();

    if (!client) {
      return res.status(404).json({ success: false, error: 'Client not found' });
    }

    // operationsName is a column on the analysis rows; drop cached payloads.
    clearAnalysisCache();
    pClearAnalysisCache().catch(() => {});

    res.status(200).json({ success: true, client });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Update client dashboard team lead name (syncs to Client + OnboardingJobs)
const updateClientDashboardTeamLead = async (req, res) => {
  try {
    const { email, dashboardTeamLeadName } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }

    const emailLower = email.toLowerCase();
    const newName = (dashboardTeamLeadName || '').trim();

    const client = await ClientModel.findOneAndUpdate(
      { email: emailLower },
      {
        dashboardTeamLeadName: newName,
        updatedAt: new Date().toLocaleString('en-US', 'Asia/Kolkata')
      },
      { new: true }
    ).select('email dashboardTeamLeadName').lean();

    if (!client) {
      return res.status(404).json({ success: false, error: 'Client not found' });
    }

    // Sync to onboarding jobs for this client
    await OnboardingJobModel.updateMany(
      { clientEmail: emailLower },
      { $set: { dashboardManagerName: newName } }
    );

    // Keep portal user record aligned with Client (same as createOrUpdateClient partial update)
    await NewUserModel.updateOne(
      { email: emailLower },
      { $set: { dashboardManager: newName } },
      { runValidators: false }
    ).catch(() => {});

    // Invalidate onboarding list/detail caches so GET /api/onboarding/jobs/:id is not stale
    invalidateJobListCache();
    clearAnalysisCache();
      pClearAnalysisCache().catch(() => {});

    res.status(200).json({ success: true, client });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

const upgradeClientPlan = async (req, res) => {
  try {
    const { email } = req.params;
    const { planType, paymentAmount, paymentCurrency } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }

    if (!planType) {
      return res.status(400).json({ success: false, error: 'Plan type is required' });
    }

    if (!paymentAmount || !paymentCurrency) {
      return res.status(400).json({ success: false, error: 'Payment amount and currency are required' });
    }

    const emailLower = email.toLowerCase();
    const planFields = planWriteFields(planType);
    if (!planFields) {
      return res.status(400).json({ success: false, error: 'Invalid plan type' });
    }
    const { planType: planTypeLower, planPrice, planLabel: capitalizedPlan } = planFields;
    const currentDate = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });

    const existingClient = await ClientModel.findOne({ email: emailLower }).lean();
    if (!existingClient) {
      return res.status(404).json({ success: false, error: 'Client not found' });
    }

    const currentAmountPaid = parseFloat(existingClient.amountPaid?.toString().replace(/[$₹£€,\s]|CAD|AUD/gi, '') || '0');
    const currentPlanPrice = existingClient.planPrice || 0;
    const upgradeDifference = planPrice - currentPlanPrice;
    const newAmountPaid = currentAmountPaid + upgradeDifference;

    const planChanged = String(existingClient.planType || '').toLowerCase() !== planTypeLower;
    const newUpgradePayment = {
      amount: parseFloat(paymentAmount),
      currency: paymentCurrency.toUpperCase(),
      for: `plan_upgrade_to_${planTypeLower}`,
      paidAt: currentDate
    };

    const upgradeOps = {
      $set: {
        planType: planTypeLower,
        planPrice: planPrice,
        amountPaid: newAmountPaid.toString(),
        amountPaidDate: currentDate,
        updatedAt: currentDate
      },
      $push: {
        upgradePayments: newUpgradePayment
      }
    };
    if (planChanged) {
      // Clear all count/completed milestone flags so cron re-evaluates against new plan thresholds.
      // Keep `started` flag — once sent, never re-send.
      upgradeOps.$unset = {
        'milestonesNotified.count_250': '',
        'milestonesNotified.count_350': '',
        'milestonesNotified.count_700': '',
        'milestonesNotified.completed': ''
      };
    }
    await ClientModel.updateOne(
      { email: emailLower },
      upgradeOps,
      { runValidators: false }
    );

    await NewUserModel.updateOne(
      { email: emailLower },
      {
        $set: {
          planType: capitalizedPlan,
          updatedAt: currentDate
        }
      },
      { runValidators: false }
    );

    const updatedClient = await ClientModel.findOne({ email: emailLower }).lean();

    // Plan drives the daily target and the plan-cap columns of the analysis rows.
    clearAnalysisCache();
    pClearAnalysisCache().catch(() => {});

    res.status(200).json({
      success: true,
      message: `Plan upgraded to ${capitalizedPlan} successfully`,
      client: updatedClient
    });
  } catch (error) {
    console.error('Error upgrading client plan:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const addClientAddon = async (req, res) => {
  try {
    const { email } = req.params;
    const { addonType, addonPrice, paymentAmount, paymentCurrency } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }

    if (!addonType || !addonPrice) {
      return res.status(400).json({ success: false, error: 'Addon type and price are required' });
    }

    if (!paymentAmount || !paymentCurrency) {
      return res.status(400).json({ success: false, error: 'Payment amount and currency are required' });
    }

    const emailLower = email.toLowerCase();
    const currentDate = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });

    const existingClient = await ClientModel.findOne({ email: emailLower }).lean();
    if (!existingClient) {
      return res.status(404).json({ success: false, error: 'Client not found' });
    }

    const currentAmountPaid = parseFloat(existingClient.amountPaid?.toString().replace(/[$₹£€,\s]|CAD|AUD/gi, '') || '0');
    const newAmountPaid = currentAmountPaid + parseFloat(addonPrice);

    const newAddon = {
      type: addonType,
      price: parseFloat(addonPrice),
      addedAt: currentDate
    };

    const existingAddons = existingClient.addons || [];
    const updatedAddons = [...existingAddons, newAddon];

    const newUpgradePayment = {
      amount: parseFloat(paymentAmount),
      currency: paymentCurrency.toUpperCase(),
      for: `addon_${addonType}`,
      paidAt: currentDate
    };

    await ClientModel.updateOne(
      { email: emailLower },
      {
        $set: {
          addons: updatedAddons,
          amountPaid: newAmountPaid.toString(),
          amountPaidDate: currentDate,
          updatedAt: currentDate
        },
        $push: {
          upgradePayments: newUpgradePayment
        }
      },
      { runValidators: false }
    );

    const updatedClient = await ClientModel.findOne({ email: emailLower }).lean();

    res.status(200).json({
      success: true,
      message: `Addon ${addonType} added successfully`,
      client: updatedClient
    });
  } catch (error) {
    console.error('Error adding client addon:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const addFreeApplications = async (req, res) => {
  try {
    const { email } = req.params;
    const { applicationCount } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }

    const parsedCount = parseInt(applicationCount, 10);
    if (!parsedCount || parsedCount <= 0) {
      return res.status(400).json({ success: false, error: 'A positive application count is required' });
    }

    const emailLower = email.toLowerCase();
    const currentDate = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });

    const existingClient = await ClientModel.findOne({ email: emailLower }).lean();
    if (!existingClient) {
      return res.status(404).json({ success: false, error: 'Client not found' });
    }

    const newAddon = {
      type: parsedCount.toString(),
      price: 0,
      source: 'admin_free',
      addedAt: currentDate
    };

    const existingAddons = existingClient.addons || [];
    const updatedAddons = [...existingAddons, newAddon];

    await ClientModel.updateOne(
      { email: emailLower },
      {
        $set: {
          addons: updatedAddons,
          updatedAt: currentDate
        }
      },
      { runValidators: false }
    );

    const updatedClient = await ClientModel.findOne({ email: emailLower }).lean();

    res.status(200).json({
      success: true,
      message: `${parsedCount} applications added successfully`,
      client: updatedClient
    });
  } catch (error) {
    console.error('Error adding free applications:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// const createOrUpdateClient = async (req, res) => {
//     try {
//       // const referer = req.headers.referer || "";
//         let {currentPath, email,password, name, jobDeadline, applicationStartDate, dashboardInternName, dashboardTeamLeadName, planType, onboardingDate, whatsappGroupMade, whatsappGroupMadeDate, dashboardCredentialsShared, dashboardCredentialsSharedDate, resumeSent, resumeSentDate,dashboardManager, coverLetterSent, coverLetterSentDate, portfolioMade, portfolioMadeDate, linkedinOptimization, linkedinOptimizationDate, gmailCredentials, dashboardCredentials, linkedinCredentials, amountPaid, amountPaidDate, modeOfPayment, status } = req.body;
//         dashboardManager = dashboardTeamLeadName;
//         // Set plan price based on plan type
//         const planPrices = {
//             ignite: 199,
//             professional: 349,
//             executive: 599,
//         };
//       const capitalizedPlan = (() => {
//       if (!planType) return "Free Trial";
//       const formatted = planType.trim().toLowerCase();
//       switch (formatted) {
//         case "ignite": return "Ignite";
//         case "professional": return "Professional";
//         case "executive": return "Executive";
//         default: return "Free Trial";
//       }
//     })();
//       const clientData = {
//             email: email.toLowerCase(),
//             name,
//             jobDeadline,
//             applicationStartDate,
//             dashboardInternName,
//             dashboardTeamLeadName,
//             planType,
//             planPrice: planPrices[planType] || 199,
//             onboardingDate,
//             whatsappGroupMade,
//             whatsappGroupMadeDate,
//             dashboardCredentialsShared,
//             dashboardCredentialsSharedDate,
//             resumeSent,
//             resumeSentDate,
//             coverLetterSent,
//             coverLetterSentDate,
//             portfolioMade,
//             portfolioMadeDate,
//             linkedinOptimization,
//             linkedinOptimizationDate,
//             gmailCredentials,
//             dashboardCredentials,
//             linkedinCredentials,
//             amountPaid,
//             amountPaidDate,
//             modeOfPayment,
//             status,
//             updatedAt: new Date().toLocaleString('en-US', 'Asia/Kolkata')
//         };
// const userData = {
//       name,
//       email,
//       passwordHashed: password? encrypt(password): encrypt('flashfire@123'),
//       planType: capitalizedPlan, // ✅ matches UserModel enum
//       userType: "User",
//       dashboardManager,

//     };


// if (currentPath.includes("/clients/new")) {
//   // const capitalizedPlan = (() => {
//   //
//    //   if (!planType) return "Free Trial";
//      // const formatted = planType.trim().toLowerCase();
//    //   switch (formatted) {
//    //     case "ignite": return "Ignite";
//        // case "professional": return "Professional";
//         //case "executive": return "Executive";
//        // default: return "Free Trial";
//      // }
//    // })();
//   //       const userData = {
// //      name,
//     //  email,
//   //    passwordHashed: password? encrypt(password): encrypt('flashfire@123'),
// //      planType: capitalizedPlan, // ✅ matches UserModel enum

//   //    planLimit: null,
// //      userType: "User",
//     //  dashboardManager,

//   //  };
//   const checkExistanceinNewUser = await NewUserModel.findOne({email});
//   if(!checkExistanceinNewUser){
//    const client = await NewUserModel.findOneAndUpdate(
//       {email },
//       userData,
//       { upsert: true, new: true, runValidators: true }
//    );
//  // const client = await NewUserModel.findOne({email});
//     const clientTracking = await ClientModel.findOneAndUpdate(
//       {email},
//       {clientData},
//       {upsert: true, new : true, runValidators : true}
//     );
//     return res.status(200).json({message : 'new client created',client, clientTracking});
// }
// else{
//   if(req?.body?.dashboardManager){
//     const client = await NewUserModel.findOneAndUpdate(
//       {email},
//       userData,
//       {upsert : true, new : true, runValidators : true}

//     );
//     const clientTracking = await UserModel.findOneAndUpdate(
//       {email},
//       {dashboardTeamLeadName : dashboardManager},
//       {upsert : true, runValidators : true , new : true}
//     );
//     return res.status(200).json({message : `client details updated in [UserModel] && [DashBoardTracking]`});
//   }

// }
// }


//         else {//if (currentPath.includes("/monitor-clients")) {
//            const clientData = {
//             email: email.toLowerCase(),
//             name,
//             jobDeadline,
//             applicationStartDate,
//             dashboardInternName,
//             dashboardTeamLeadName,
//             planType,
//             planPrice: planPrices[planType] || 199,
//             onboardingDate,
//             whatsappGroupMade,
//             whatsappGroupMadeDate,
//             dashboardCredentialsShared,
//             dashboardCredentialsSharedDate,
//             resumeSent,
//             resumeSentDate,
//             coverLetterSent,
//             coverLetterSentDate,
//             portfolioMade,
//             portfolioMadeDate,
//             linkedinOptimization,
//             linkedinOptimizationDate,
//             gmailCredentials,
//             dashboardCredentials,
//             linkedinCredentials,
//             amountPaid,
//             amountPaidDate,
//             modeOfPayment,
//             status,
//             updatedAt: new Date().toLocaleString('en-US', 'Asia/Kolkata')
//         };

//   const clientTracking = await ClientModel.findOneAndUpdate(
//             { email: email.toLowerCase() },
//             clientData,
//             { upsert: true, new: true, runValidators: true }
//         );
//        // return res.status(200).json({client});
//   const client = await NewUserModel.findOneAndUpdate(
//             {email},
//             {name, email, dashBoardManager : dashboardTeamLeadName, planType},
//             {upsert : true, new : true , runValidators : true}
//       );
//           res.status(200).json({message : `user details updated for client : ${ email} in [UserModel] && [DashboardTracking] `});
// }

// //         else {
// // //  console.log("⚠️ Unknown referer:", referer);
// // console.log(error)
// //   return res.status(400).json({
// //     success: false,
// //     message: "Invalid referer or unsupported frontend route",
// //   });
// // }


//     } catch (error) {
//       console.log(error)
//         res.status(500).json({error: error.message});
//     }
// }
// const createOrUpdateClient = async (req, res) => {
//   try {
//     const {
//       email,
//       password,
//       name,
//       jobDeadline,
//       applicationStartDate,
//       dashboardInternName,
//       dashboardTeamLeadName,
//       planType,
//       onboardingDate,
//       dashboardManager,
//       whatsappGroupMade,
//       whatsappGroupMadeDate,
//       dashboardCredentialsShared,
//       dashboardCredentialsSharedDate,
//       resumeSent,
//       resumeSentDate,
//       coverLetterSent,
//       coverLetterSentDate,
//       portfolioMade,
//       portfolioMadeDate,
//       linkedinOptimization,
//       linkedinOptimizationDate,
//       gmailCredentials,
//       dashboardCredentials,
//       linkedinCredentials,
//       amountPaid,
//       amountPaidDate,
//       modeOfPayment,
//       status,
//     } = req.body;

//     // -------------------- 🧩 Normalize planType for both schemas --------------------
//     // Capitalized for UserModel, lowercase for ClientModel
//     const capitalizedPlan = (() => {
//       if (!planType) return "Free Trial";
//       const formatted = planType.trim().toLowerCase();
//       switch (formatted) {
//         case "ignite": return "Ignite";
//         case "professional": return "Professional";
//         case "executive": return "Executive";
//         default: return "Free Trial";
//       }
//     })();

//     const lowercasePlan = (() => {
//       if (!planType) return "ignite";
//       const formatted = planType.trim().toLowerCase();
//       switch (formatted) {
//         case "ignite": return "ignite";
//         case "professional": return "professional";
//         case "executive": return "executive";
//         default: return "ignite";
//       }
//     })();

//     // -------------------- 💵 Set plan price --------------------
//     const planPrices = {
//       ignite: 199,
//       professional: 349,
//       executive: 599,
//     };

//     // -------------------- 👤 Create or Update NewUserModel --------------------
//     const userData = {
//       name,
//       email,
//       passwordHashed: await encrypt(password),
//       resumeLink: [],
//       coverLetters: [],
//       optimizedResumes: [],
//       planType: capitalizedPlan, // ✅ matches UserModel enum

//       planLimit: null,
//       userType: "User",
//       dashboardManager,

//     };

//     await NewUserModel.findOneAndUpdate(
//       { email },
//       userData,
//       { upsert: true, new: true, runValidators: true }
//     );

//     // -------------------- 📋 Create or Update ClientModel --------------------
//     const clientData = {
//       email: email.toLowerCase(),
//       name,
//       password,
//       jobDeadline,
//       applicationStartDate,
//       dashboardInternName,
//       dashboardTeamLeadName,
//       planType: lowercasePlan, // ✅ matches ClientModel enum
//       planPrice: planPrices[lowercasePlan] || 199,
//       onboardingDate,
//       whatsappGroupMade,
//       whatsappGroupMadeDate,
//       dashboardCredentialsShared,
//       dashboardCredentialsSharedDate,
//       resumeSent,
//       resumeSentDate,
//       coverLetterSent,
//       coverLetterSentDate,
//       portfolioMade,
//       portfolioMadeDate,
//       linkedinOptimization,
//       linkedinOptimizationDate,
//       gmailCredentials,
//       dashboardCredentials,
//       linkedinCredentials,
//       amountPaid,
//       amountPaidDate,
//       modeOfPayment,

//       status,
//       updatedAt: new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
//     };

//     const client = await ClientModel.findOneAndUpdate(
//       { email: email.toLowerCase() },
//       clientData,
//       { upsert: true, new: true, runValidators: true }
//     );

//     res.status(200).json({ client });

//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ error: error.message });
//   }
// };


// Authentication endpoints
const login = async (req, res) => {
  try {
    const { email, password, sessionKey, trustToken } = req.body;
    const emailLower = (email || '').toLowerCase();

    const user = await UserModel.findOne({ email: emailLower }).lean();
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const rolesRequiringSecondStep = ['bda', 'team_lead', 'operations_intern', 'onboarding_team', 'csm', 'admin'];
    if (rolesRequiringSecondStep.includes(user.role)) {
      let secondStepOk = false;
      if (trustToken) {
        try {
          const decoded = jwt.verify(trustToken, JWT_SECRET);
          if (decoded.purpose === 'otp-trust' && decoded.email === emailLower) {
            secondStepOk = true;
          }
        } catch (_) { }
      }
      if (!secondStepOk && sessionKey) {
        const sessionKeyDoc = await SessionKeyModel.findOne({
          key: sessionKey,
          userEmail: emailLower,
          isUsed: false,
          expiresAt: { $gt: new Date() }
        });
        if (sessionKeyDoc) {
          sessionKeyDoc.isUsed = true;
          sessionKeyDoc.usedAt = new Date().toLocaleString('en-US', 'Asia/Kolkata');
          await sessionKeyDoc.save();
          secondStepOk = true;
        }
      }
      if (!secondStepOk) {
        return res.status(400).json({ error: 'Session key or OTP required', code: 'SESSION_KEY_REQUIRED' });
      }
    }

    const token = jwt.sign(
      {
        userId: user._id,
        email: user.email,
        role: user.role,
        name: user.name,
        onboardingSubRole: user.onboardingSubRole,
        roles: user.roles || []
      },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.status(200).json({
      token,
      user: {
        email: user.email,
        role: user.role,
        name: user.name,
        onboardingSubRole: user.onboardingSubRole,
        roles: user.roles || []
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Sliding session: exchange a still-valid token for a fresh 30-day one.
// Claims are re-read from the DB so role changes and deactivation take effect
// on the next refresh instead of living for the full token lifetime.
const refreshToken = async (req, res) => {
  try {
    const user = await UserModel.findOne({ email: (req.user?.email || '').toLowerCase() })
      .select('email role name onboardingSubRole roles isActive')
      .lean();
    if (!user || user.isActive === false) {
      return res.status(401).json({ error: 'Account is disabled or no longer exists.' });
    }
    const token = jwt.sign(
      {
        userId: user._id,
        email: user.email,
        role: user.role,
        name: user.name,
        onboardingSubRole: user.onboardingSubRole,
        roles: user.roles || []
      },
      JWT_SECRET,
      { expiresIn: '30d' }
    );
    res.status(200).json({
      token,
      user: {
        email: user.email,
        role: user.role,
        name: user.name,
        onboardingSubRole: user.onboardingSubRole,
        roles: user.roles || []
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Create a new user (admin only)
const createUser = async (req, res) => {
  try {
    const { email, password, role = 'team_lead', name, onboardingSubRole, roles, otpEmail } = req.body;

    const existingUser = await UserModel.findOne({ email: email.toLowerCase() }).lean();
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const userData = {
      email: email.toLowerCase(),
      password: hashedPassword,
      role,
      name: name || '',
      updatedAt: new Date().toLocaleString('en-US', 'Asia/Kolkata')
    };
    if (role === 'onboarding_team' && onboardingSubRole) {
      userData.onboardingSubRole = onboardingSubRole;
    }
    if (Array.isArray(roles)) {
      userData.roles = roles;
    }
    if (otpEmail !== undefined && otpEmail !== null && String(otpEmail).trim()) {
      const val = String(otpEmail).trim().toLowerCase();
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) userData.otpEmail = val;
    }

    const user = new UserModel(userData);
    await user.save();
    res.status(201).json({
      message: 'User created successfully',
      user: {
        email: user.email,
        role: user.role,
        name: user.name,
        onboardingSubRole: user.onboardingSubRole,
        roles: user.roles
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const SESSION_KEY_VALID_DAYS = 90;

// Generate session key (admin only)
const generateSessionKey = async (req, res) => {
  try {
    const { userEmail } = req.body;

    const user = await UserModel.findOne({
      email: userEmail.toLowerCase(),
      role: { $in: ['bda', 'team_lead', 'operations_intern', 'onboarding_team', 'csm'] },
      isActive: true
    }).lean();

    if (!user) {
      return res.status(404).json({ error: 'User not found or invalid role' });
    }

    let sessionKey;
    let attempts = 0;
    const maxAttempts = 10;

    do {
      const timestamp = Date.now().toString(36);
      const random = Math.random().toString(36).substring(2, 10).toUpperCase();
      sessionKey = `FF${timestamp}${random}`;
      attempts++;

      const existingKey = await SessionKeyModel.findOne({ key: sessionKey }).lean();
      if (!existingKey) break;

      if (attempts >= maxAttempts) {
        return res.status(500).json({ error: 'Failed to generate unique session key after multiple attempts' });
      }
    } while (true);

    const expiresAt = new Date(Date.now() + SESSION_KEY_VALID_DAYS * 24 * 60 * 60 * 1000);
    const sessionKeyDoc = new SessionKeyModel({
      key: sessionKey,
      userEmail: userEmail.toLowerCase(),
      expiresAt
    });

    await sessionKeyDoc.save();

    res.status(201).json({
      message: 'Session key generated successfully',
      sessionKey,
      userEmail: userEmail.toLowerCase(),
      expiresAt: sessionKeyDoc.expiresAt,
      validDays: SESSION_KEY_VALID_DAYS
    });
  } catch (error) {
    console.error('Session key generation error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Get all users (admin only)
const getAllUsers = async (req, res) => {
  try {
    const users = await UserModel.find({}, { password: 0 }).lean();
    res.status(200).json({ users });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get session keys for a user (admin only)
const getUserSessionKeys = async (req, res) => {
  try {
    const { userEmail } = req.params;
    const sessionKeys = await SessionKeyModel.find({
      userEmail: userEmail.toLowerCase()
    }).sort({ createdAt: -1 }).lean();

    res.status(200).json({ sessionKeys });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Create a new job
const createJob = async (req, res) => {
  try {
    const jobData = {
      ...req.body,
      createdAt: new Date().toLocaleString('en-US', 'Asia/Kolkata'),
      updatedAt: new Date().toLocaleString('en-US', 'Asia/Kolkata')
    };

    // HARD lifetime plan-cap gate. Same rule as the dashboard backend:
    // effective cap = base plan (or planLimit override) + addons + referrals.
    // Once a client hits it, NO new job is created — strict, fail-closed on
    // DB error so a flaky read can't open the floodgates.
    const clientEmail = jobData.userID || jobData.email;
    if (clientEmail) {
      let planCheck;
      try {
        planCheck = await checkPlanCapGuard(clientEmail);
      } catch (e) {
        console.error('planCapGuard.checkPlanCap failed:', e.message);
        return res.status(503).json({
          success: false,
          error: 'PLAN_CAP_CHECK_FAILED',
          message: 'Could not verify plan limit (DB unavailable). Job creation refused — try again shortly.',
        });
      }
      if (!planCheck.allowed) {
        console.log(JSON.stringify({
          event: 'plan.cap.hit',
          source: 'applications-monitor',
          client: clientEmail,
          planType: planCheck.planType,
          cap: planCheck.cap,
          count: planCheck.count,
        }));
        return res.status(403).json({
          success: false,
          error: planCheck.reason || 'PLAN_LIMIT_REACHED',
          message: planCheck.message,
          cap: planCheck.cap,
          baseCap: planCheck.baseCap,
          addonBonus: planCheck.addonBonus,
          referralBonus: planCheck.referralBonus,
          current: planCheck.count,
          remaining: 0,
          planType: planCheck.planType,
        });
      }
    }

    const job = new JobModel(jobData);
    await job.save();

    // Post-insert race guard: re-count and roll back if a concurrent create
    // pushed us over the cap.
    if (clientEmail) {
      try {
        const enforce = await enforcePlanCapGuard(clientEmail, job._id);
        if (!enforce.kept) {
          return res.status(403).json({
            success: false,
            error: 'PLAN_LIMIT_REACHED',
            message: `Plan limit reached during race (${enforce.count}/${enforce.cap}). Job creation refused — this job was rolled back.`,
            cap: enforce.cap,
            current: enforce.count,
            remaining: 0,
            rolledBack: enforce.deleted,
          });
        }
      } catch (e) {
        console.error('planCapGuard.enforcePlanCapPostInsert failed:', e.message);
      }
    }

    // A client still flagged "New" who now has real job cards is not new.
    // Fire-and-forget on purpose: the job was created and the caller must be
    // told so, whatever the phase flip does. Runs after the cap race guard so
    // a job that gets rolled back can never unpause anybody.
    if (clientEmail) {
      autoUnpauseIfEligible(clientEmail, { trigger: 'job-created' })
        .catch((e) => console.error('[auto-unpause] post-create check failed:', e?.message || e));
    }

    res.status(201).json({ job });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Clean up session keys endpoint (admin only)
const cleanupSessionKeysEndpoint = async (req, res) => {
  try {
    // Drop the entire collection to remove corrupted indexes
    await SessionKeyModel.collection.drop().catch(() => {
      // Collection might not exist, that's okay
    });

    // Recreate the collection with proper schema
    await SessionKeyModel.createCollection();

    res.status(200).json({
      message: 'Session keys collection reset successfully'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Verify credentials (for two-step login)
const verifyCredentials = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await UserModel.findOne({
      email: email.toLowerCase(),
      isActive: true
    }).lean();

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const rolesRequiringSecondStep = ['bda', 'team_lead', 'operations_intern', 'onboarding_team', 'csm'];
    const needSecondStep = rolesRequiringSecondStep.includes(user.role);

    res.status(200).json({
      message: 'Credentials verified',
      role: user.role,
      email: user.email,
      needSecondStep
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

function resolveOtpDestinationEmail(loginEmail, user) {
  const e = (loginEmail || '').trim().toLowerCase();
  if (e.endsWith('@flashfirehq') && !e.endsWith('@flashfirehq.com')) {
    return e + '.com';
  }
  if (user?.otpEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.otpEmail.trim())) {
    return user.otpEmail.trim().toLowerCase();
  }
  return (user?.email || e).toLowerCase();
}

const requestOtp = async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = (email || '').trim().toLowerCase();
    if (!normalizedEmail || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const user = await UserModel.findOne({ email: normalizedEmail, isActive: true }).lean();
    if (!user) {
      return res.status(200).json({ message: 'If your email is authorized, you will receive an OTP.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(200).json({ message: 'If your email is authorized, you will receive an OTP.' });
    }

    // Admin OTP: send OTP to admin email (same flow as other roles)
    const otpDestination = resolveOtpDestinationEmail(normalizedEmail, user);
    if (!otpDestination || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(otpDestination)) {
      return res.status(400).json({ error: 'OTP email not configured for this account. Contact your admin.' });
    }

    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    const ttlSeconds = 300;
    const expiresAtMs = Date.now() + ttlSeconds * 1000;
    setOtp(normalizedEmail, {
      otpHash: otpHash(normalizedEmail, otp),
      expiresAtMs,
      attemptsLeft: 5
    });

    await sendOtpEmail(otpDestination, otp, user.name);

    res.status(200).json({ message: 'OTP sent' });
  } catch (error) {
    console.error('Request OTP error:', error?.message || error);
    res.status(500).json({ error: 'Server error' });
  }
};

const verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const normalizedEmail = (email || '').trim().toLowerCase();
    if (!normalizedEmail || !otp) {
      return res.status(400).json({ error: 'Email and OTP required' });
    }

    const entry = getOtp(normalizedEmail);
    if (!entry) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    const inputHash = otpHash(normalizedEmail, String(otp).trim());
    if (entry.otpHash !== inputHash) {
      decrementAttempts(normalizedEmail);
      return res.status(400).json({ error: 'Invalid OTP' });
    }

    deleteOtp(normalizedEmail);

    const trustToken = jwt.sign(
      { email: normalizedEmail, purpose: 'otp-trust' },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.status(200).json({
      message: 'OTP verified',
      trustToken,
      expiresIn: '30d'
    });
  } catch (error) {
    console.error('Verify OTP error:', error?.message || error);
    res.status(500).json({ error: 'Server error' });
  }
};

const validateOtpTrust = async (req, res) => {
  try {
    const { email, trustToken } = req.body;
    const normalizedEmail = (email || '').trim().toLowerCase();
    if (!normalizedEmail || !trustToken) {
      return res.status(400).json({ valid: false });
    }

    let decoded;
    try {
      decoded = jwt.verify(trustToken, JWT_SECRET);
    } catch {
      return res.status(200).json({ valid: false });
    }

    if (decoded.purpose !== 'otp-trust' || decoded.email !== normalizedEmail) {
      return res.status(200).json({ valid: false });
    }

    res.status(200).json({ valid: true });
  } catch (error) {
    console.error('Validate OTP trust error:', error?.message || error);
    res.status(500).json({ valid: false });
  }
};

// Delete user (admin only)
const deleteUser = async (req, res) => {
  try {
    const { userId } = req.params;

    // Check if user exists
    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Don't allow deleting admin users
    if (user.role === 'admin') {
      return res.status(403).json({ error: 'Cannot delete admin users' });
    }

    // Delete user
    await UserModel.findByIdAndDelete(userId);

    // Also delete any session keys for this user
    await SessionKeyModel.deleteMany({ userEmail: user.email });

    res.status(200).json({
      message: 'User deleted successfully',
      deletedUser: { email: user.email, role: user.role }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Change password for user (admin only)
const changePassword = async (req, res) => {
  try {
    const { userId } = req.params;
    const { newPassword } = req.body;

    // Validate new password
    if (!newPassword || typeof newPassword !== 'string') {
      return res.status(400).json({ error: 'New password is required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }

    // Check if user exists
    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Only allow changing password for admin users
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Can only change password for admin users' });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    user.password = hashedPassword;
    user.updatedAt = new Date().toLocaleString('en-US', 'Asia/Kolkata');
    await user.save();

    res.status(200).json({
      message: 'Password changed successfully',
      email: user.email
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const resetPasswordByEmail = async (req, res) => {
  try {
    const { email, newPassword } = req.body;
    const emailLower = (email || '').trim().toLowerCase();
    if (!emailLower) {
      return res.status(400).json({ error: 'Email is required' });
    }
    if (!newPassword || typeof newPassword !== 'string') {
      return res.status(400).json({ error: 'New password is required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }
    const user = await UserModel.findOne({ email: emailLower });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    user.updatedAt = new Date().toLocaleString('en-US', 'Asia/Kolkata');
    await user.save();
    res.status(200).json({
      message: 'Password reset successfully',
      email: user.email
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const updateUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { email, otpEmail, name, linkedDashboardManagerName, discordWebhookUrl } = req.body;

    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (email !== undefined && email !== null) {
      const newEmail = String(email).trim().toLowerCase();
      if (!newEmail) return res.status(400).json({ error: 'Email cannot be empty' });
      const isValidStandard = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail);
      const isValidFlashfirehq = /^[^\s@]+@flashfirehq$/.test(newEmail);
      if (!isValidStandard && !isValidFlashfirehq) return res.status(400).json({ error: 'Invalid email format' });
      const existing = await UserModel.findOne({ email: newEmail }).lean();
      if (existing && existing._id.toString() !== userId) return res.status(400).json({ error: 'Email already in use' });
      user.email = newEmail;
    }
    if (otpEmail !== undefined) {
      const val = otpEmail === '' || otpEmail === null ? '' : String(otpEmail).trim().toLowerCase();
      if (val && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) return res.status(400).json({ error: 'Invalid OTP email format' });
      user.otpEmail = val;
    }
    if (name !== undefined && typeof name === 'string') {
      user.name = name.trim();
    }
    if (linkedDashboardManagerName !== undefined && typeof linkedDashboardManagerName === 'string') {
      user.linkedDashboardManagerName = linkedDashboardManagerName.trim();
    }
    if (discordWebhookUrl !== undefined) {
      const val = discordWebhookUrl === null ? '' : String(discordWebhookUrl).trim();
      if (val && !/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(val)) {
        return res.status(400).json({ error: 'Invalid Discord webhook URL (must be https://discord.com/api/webhooks/...)' });
      }
      user.discordWebhookUrl = val;
    }

    user.updatedAt = new Date().toLocaleString('en-US', 'Asia/Kolkata');
    await user.save();

    res.status(200).json({
      message: 'User updated successfully',
      user: {
        email: user.email,
        name: user.name,
        otpEmail: user.otpEmail || '',
        linkedDashboardManagerName: user.linkedDashboardManagerName || '',
        discordWebhookUrl: user.discordWebhookUrl || '',
        role: user.role,
        onboardingSubRole: user.onboardingSubRole,
        roles: user.roles
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Change password for client (admin only) - updates users collection
const changeClientPassword = async (req, res) => {
  try {
    const { email } = req.params;
    const { newPassword } = req.body;

    // Validate new password
    if (!newPassword || typeof newPassword !== 'string') {
      return res.status(400).json({ error: 'New password is required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }

    // Check if client exists in users collection
    const client = await NewUserModel.findOne({ email: email.toLowerCase() }).lean();
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Encrypt new password using the same encrypt function used during creation
    const encryptedPassword = encrypt(newPassword);

    // Update password
    await NewUserModel.updateOne(
      { email: email.toLowerCase() },
      {
        $set: {
          passwordHashed: encryptedPassword,
          updatedAt: new Date().toLocaleString('en-US', 'Asia/Kolkata')
        }
      }
    );

    res.status(200).json({
      message: 'Client password changed successfully',
      email: email.toLowerCase()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Delete client with cascade deletion
const deleteClient = async (req, res) => {
  try {
    const { email } = req.params;
    const emailLower = email.toLowerCase();

    // Check if client exists
    const client = await ClientModel.findOne({ email: emailLower }).lean();
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Perform cascade deletion
    const deletionResults = {
      clientDeleted: false,
      userDeleted: false,
      jobsDeleted: 0,
      operationsUpdated: 0
    };

    const clientResult = await ClientModel.deleteOne({ email: emailLower });
    deletionResults.clientDeleted = clientResult.deletedCount > 0;

    const userResult = await NewUserModel.deleteOne({ email: emailLower });
    deletionResults.userDeleted = userResult.deletedCount > 0;

    const jobsResult = await JobModel.deleteMany({ userID: emailLower });
    deletionResults.jobsDeleted = jobsResult.deletedCount;
    const operationsResult = await OperationsModel.updateMany(
      { managedUsers: { $in: [emailLower] } },
      { $pull: { managedUsers: emailLower } }
    );
    deletionResults.operationsUpdated = operationsResult.modifiedCount;
    await SessionKeyModel.deleteMany({ userEmail: emailLower });

    res.status(200).json({
      message: 'Client deleted successfully with cascade deletion',
      deletedClient: { email: emailLower, name: client.name },
      deletionResults
    });
  } catch (error) {
    console.error('Error in deleteClient:', error);
    res.status(500).json({ error: error.message });
  }
};

//campaign routes

// app.post("/api/track/utm-campaign-lead", async (req, res) => {
//   try {
//     const { clientName, clientEmail, clientPhone, utmSource } = req.body;

//     if (!utmSource || !clientEmail) {
//       return res.status(400).json({ error: "utmSource and clientEmail are required" });
//     }

//     // 🔍 Find campaign that has a matching utm_source
//     const campaign = await LinkCampaignUtm.findOne({
//       "utm_source.utm_source": utmSource
//     });

//     if (!campaign) {
//       return res.status(404).json({ message: "No campaign found for this utmSource" });
//     }

//     // Get the specific UTM object inside the campaign
//     const utmEntry = campaign.utm_source.find(
//       (s) => s.utm_source === utmSource
//     );

//     if (!utmEntry) {
//       return res.status(404).json({ message: "UTM not found inside campaign" });
//     }

//     // Check if clientEmail already exists
//     const alreadyExists = utmEntry.conversions.some(
//       (c) => c.clientEmail.toLowerCase() === clientEmail.toLowerCase()
//     );

//     if (alreadyExists) {
//       return res.status(200).json({ message: "Client already exists, not added again" });
//     }

//     // Add new conversion
//     utmEntry.conversions.push({
//       clientName,
//       clientEmail,
//       clientPhone: clientPhone || "Not Provided",
//       bookingDate: new Date()
//     });

//     await campaign.save();

//     return res.status(201).json({
//       message: "✅ Conversion added successfully",
//       conversion: { clientName, clientEmail, clientPhone }
//     });
//   } catch (error) {
//     console.error("❌ Error in /api/track/utm-campaign-lead:", error);
//     res.status(500).json({ error: "Internal Server Error" });
//   }
// });
// app.post("/api/campaign/create", CreateCampaign);

// app.post("/api/track", async (req, res) => {
//   try {
//     const {
//       ref,
//       userAgent,
//       screenWidth,
//       screenHeight,
//       language,
//       timezone,
//     } = req.body;

//     if (!ref) {
//       return res.status(400).json({ ok: false, message: "Missing ref code" });
//     }

//     // Extract visitor IP
//     const ip =
//       req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
//       req.socket.remoteAddress;

//     // Decode ref back into campaign + campaigner
//     const { campaignName, campaignerName } = decode(ref);

//     // Find campaign
//     const campaign = await LinkCampaignUtm.findOne({
//       campaign_name: campaignName,
//     });
//     if (!campaign) {
//       return res.status(404).json({ ok: false, message: "Campaign not found" });
//     }

//     // Find campaigner in campaign
//     const source = campaign.utm_source.find(
//       (s) => s.utm_source.toLowerCase() === campaignerName.toLowerCase()
//     );
//     if (!source) {
//       return res
//         .status(404)
//         .json({ ok: false, message: "Campaigner not found" });
//     }

//     /* ------------------- Log Click (detailed) ------------------- */
//     await Click.create({
//       link_code: source.link_code,  // ✅ FIXED
//       utm_source: source.utm_source,
//       utm_campaign: campaignName,
//       ip,
//       timestamp: new Date(),
//       userAgent,
//       screenWidth,
//       screenHeight,
//       language,
//       timezone,
//     });

//     /* ------------------- Update Aggregates ------------------- */
//     source.total_clicks += 1;

//     if (!source.unique_ips.includes(ip)) {
//       source.unique_ips.push(ip);
//       source.unique_clicks = source.unique_ips.length;
//     }

//     await campaign.save();

//     return res.json({
//       ok: true,
//       message: "Click tracked successfully",
//       campaignName,
//       campaignerName,
//       utm_source: source.utm_source,
//       link_code: source.link_code,   // ✅ send back too
//       ip,
//       total: source.total_clicks,
//       unique: source.unique_clicks,
//     });
//   } catch (err) {
//     console.error("Error in tracking:", err);
//     return res.status(500).json({ ok: false, error: "server_error" });
//   }
// });

// // Track and (optionally) redirect
// app.get("/r/:code", async (req, res) => {
//   try {
//     const { code } = req.params;
//     const doc = await LinkCampaignUtm.findOne({ code });
//     if (!doc) return res.status(404).send("Invalid link");

//     const ip = getClientIP(req);
//     // total clicks increments always
//     doc.totalClicks += 1;

//     // unique IP logic
//     if (!doc.uniqueIPs.includes(ip)) {
//       doc.uniqueIPs.push(ip);
//       doc.uniqueCount = doc.uniqueIPs.length;
//     }
//     await doc.save();

//     // Simple landing message (you can change to a redirect if you want)
//     res.type("html").send(`
//       <html>
//         <head><title>Thanks for visiting</title></head>
//         <body style="font-family: sans-serif; padding: 24px;">
//           <h1>Thanks for visiting via ${doc.campaignerName}'s link</h1>
//           <p>Campaign: <b>${doc.campaignName}</b></p>
//           <p>This IP is counted once. Total unique visitors so far: <b>${doc.uniqueCount}</b></p>
//         </body>
//       </html>
//     `);
//   } catch (err) {
//     console.error(err);
//     res.status(500).send("Server error");
//   }
// });

// // Admin report: list all links with counts
// app.get("/api/report", async (_req, res) => {
//   try {
//     const baseUrl = "https://flashfirejobs.com";

//     const campaigns = await LinkCampaignUtm.find({}, { __v: 0 })
//       .sort({ createdAt: -1 })
//       .lean();

//     const rows = campaigns.map((campaign) => {
//       // calculate campaign-level totals
//       const totalClicks = campaign.utm_source.reduce(
//         (sum, s) => sum + (s.total_clicks || 0),
//         0
//       );
//       const totalUniques = campaign.utm_source.reduce(
//         (sum, s) => sum + (s.unique_clicks || 0),
//         0
//       );

//       return {
//         _id: campaign._id,
//         campaign_name: campaign.campaign_name,
//         link_code: campaign.link_code,
//         createdAt: campaign.createdAt,
//         totalClicks,
//         totalUniques,
//         campaigners: campaign.utm_source.map((s) => ({
//           utm_source: s.utm_source,
//           total_clicks: s.total_clicks,
//           unique_clicks: s.unique_clicks,
//           link: `${baseUrl}?ref=${encode(
//             campaign.campaign_name,
//             s.utm_source
//           )}`,
//           conversions: s.conversions || []   // ✅ include conversions here
//         })),
//       };
//     });

//     res.json({ ok: true, rows });
//   } catch (err) {
//     console.error("Error generating report:", err);
//     res.status(500).json({ ok: false, error: "server_error" });
//   }
// });



// // Optional: get report by campaign
// app.get("/api/report/:campaignName", async (req, res) => {
//   const { campaignName } = req.params;
//   const rows = await LinkCampaignUtm.find({ campaignName }, { __v: 0 }).sort({ createdAt: -1 }).lean();
//   res.json({ ok: true, rows });
// });

// Authentication routes
app.post('/api/auth/verify-credentials', verifyCredentials);
app.post('/api/auth/login', login);
app.use('/api/attendance', attendanceRouter);

app.post('/api/auth/refresh', verifyToken, refreshToken);
app.post('/api/auth/request-otp', requestOtp);
app.post('/api/auth/verify-otp', verifyOtp);
app.post('/api/auth/validate-otp-trust', validateOtpTrust);
app.post('/api/auth/users', verifyToken, verifyAdmin, createUser);
app.get('/api/auth/users', verifyToken, verifyAdmin, getAllUsers);
app.put('/api/auth/users/:userId', verifyToken, verifyAdmin, updateUser);
app.delete('/api/auth/users/:userId', verifyToken, verifyAdmin, deleteUser);
app.put('/api/auth/users/:userId/change-password', verifyToken, verifyAdmin, changePassword);
app.post('/api/auth/reset-password', resetPasswordByEmail);
app.post('/api/auth/session-key', verifyToken, verifyAdmin, generateSessionKey);
app.get('/api/auth/session-keys/:userEmail', verifyToken, verifyAdmin, getUserSessionKeys);
app.post('/api/auth/cleanup-session-keys', verifyToken, verifyAdmin, cleanupSessionKeysEndpoint);

// Gmail OAuth (system sender — replaces SendGrid for OTP / milestone / tag emails)
app.get('/auth/google', startGoogleAuth);
app.get('/auth/google/callback', googleAuthCallback);
app.get('/api/gmail/status', verifyToken, gmailStatus);
app.post('/api/gmail/disconnect', verifyToken, verifyAdmin, gmailDisconnect);

// Job routes
app.post('/', getAllJobs);
app.post('/api/jobs', createJob);

// Get one job (with full description) by id
app.get('/api/jobs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'Job id is required' });
    const job = await JobModel.findById(id).lean();
    if (!job) return res.status(404).json({ error: 'Job not found' });
    // Return only fields needed by frontend, including jobDescription
    const {
      _id,
      jobID,
      jobDescription,
      updatedAt,
      dateAdded
    } = job;
    return res.status(200).json({ job: { _id, jobID, jobDescription, updatedAt, dateAdded } });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// Auto-sync clients from jobdbs to dashboardtrackings
const syncClientsFromJobs = async (req, res) => {
  try {
    // Get all unique userIDs from jobs
    const jobs = await JobModel.find({}, 'userID').lean();
    const uniqueUserIDs = [...new Set(jobs.map(job => job.userID).filter(id =>
      id && /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(id)
    ))];

    // Check which clients already exist in dashboardtrackings
    const existingClients = await ClientModel.find({}, 'email').lean();
    const existingEmails = existingClients.map(client => client.email);

    // Find missing clients
    const missingClients = uniqueUserIDs.filter(userID => !existingEmails.includes(userID));

    // Create missing clients with default values
    const createdClients = [];
    for (const email of missingClients) {
      const clientData = {
        email: email.toLowerCase(),
        name: email.split('@')[0], // Use email prefix as default name
        jobDeadline: " ",
        applicationStartDate: " ",
        dashboardInternName: " ",
        dashboardTeamLeadName: " ",
        planType: "ignite",
        planPrice: 199,
        onboardingDate: new Date().toLocaleString('en-US', 'Asia/Kolkata'),
        whatsappGroupMade: false,
        whatsappGroupMadeDate: " ",
        dashboardCredentialsShared: false,
        dashboardCredentialsSharedDate: " ",
        resumeSent: false,
        resumeSentDate: " ",
        coverLetterSent: false,
        coverLetterSentDate: " ",
        portfolioMade: false,
        portfolioMadeDate: " ",
        linkedinOptimization: false,
        linkedinOptimizationDate: " ",
        gmailCredentials: {
          email: "",
          password: ""
        },
        dashboardCredentials: {
          username: "",
          password: ""
        },
        linkedinCredentials: {
          username: "",
          password: ""
        },
        amountPaid: 0,
        amountPaidDate: " ",
        modeOfPayment: "paypal",
        status: "active",
        companyName: " ",
        lastApplicationDate: " ",
        jobStatus: "still_searching",
        createdAt: new Date().toLocaleString('en-US', 'Asia/Kolkata'),
        updatedAt: new Date().toLocaleString('en-US', 'Asia/Kolkata')
      };

      const client = new ClientModel(clientData);
      await client.save();
      createdClients.push(client);
    }

    res.status(200).json({
      message: `Successfully synced clients from jobs`,
      totalJobsUsers: uniqueUserIDs.length,
      existingClients: existingEmails.length,
      createdClients: createdClients.length,
      createdClientsList: createdClients.map(c => c.email)
    });

  } catch (error) {
    console.error('Error syncing clients from jobs:', error);
    res.status(500).json({ error: error.message });
  }
};

// Operations endpoints
const getAllOperations = async (req, res) => {
  try {
    const operations = await OperationsModel.find().lean();
    res.status(200).json({ operations });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

const getOperationsByEmail = async (req, res) => {
  try {
    const { email } = req.params;
    const operation = await OperationsModel.findOne({ email: email.toLowerCase() }).lean();
    if (!operation) {
      return res.status(404).json({ error: 'Operation user not found' });
    }
    res.status(200).json({ operation });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

const createOrUpdateOperation = async (req, res) => {
  try {
    const { email, name, password, role, managedUsers } = req.body;

    const operationData = {
      email: email.toLowerCase(),
      name,
      password: password ? await bcrypt.hash(password, 10) : undefined,
      role,
      managedUsers,
      updatedAt: new Date().toLocaleString('en-US', 'Asia/Kolkata')
    };

    // Remove undefined values
    Object.keys(operationData).forEach(key => {
      if (operationData[key] === undefined) {
        delete operationData[key];
      }
    });

    const operation = await OperationsModel.findOneAndUpdate(
      { email: email.toLowerCase() },
      operationData,
      { upsert: true, new: true, runValidators: true }
    );

    res.status(200).json({ operation });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

const getJobsByOperatorEmail = async (req, res) => {
  try {
    const { email } = req.params;
    const { date, startDate, endDate } = req.query;

    let query = { operatorEmail: email.toLowerCase() };

    if (date) {
      // Single date filter (backward compatibility)
      const targetDate = new Date(date);
      const month = targetDate.getMonth() + 1;
      const day = targetDate.getDate();
      const year = targetDate.getFullYear();
      const dateString = `${day}/${month}/${year}`;

      query.appliedDate = {
        $regex: dateString,
        $options: 'i'
      };
    } else if (startDate && endDate) {
      // Date range filter
      const start = new Date(startDate);
      const end = new Date(endDate);

      // Create date strings for the range
      const startMonth = start.getMonth() + 1;
      const startDay = start.getDate();
      const startYear = start.getFullYear();
      const startDateString = `${startDay}/${startMonth}/${startYear}`;

      const endMonth = end.getMonth() + 1;
      const endDay = end.getDate();
      const endYear = end.getFullYear();
      const endDateString = `${endDay}/${endMonth}/${endYear}`;

      // If start and end are the same, use exact match
      if (startDateString === endDateString) {
        query.appliedDate = {
          $regex: startDateString,
          $options: 'i'
        };
      } else {
        // For date range, we'll need to get all jobs and filter by date
        // This is a simplified approach - in production you might want to optimize this
        const allJobs = await JobModel.find({ operatorEmail: email.toLowerCase() }).select('-jobDescription').lean();
        const filteredJobs = allJobs.filter(job => {
          if (!job.appliedDate) return false;

          // Parse the applied date from the job
          const jobDateParts = job.appliedDate.split('/');
          if (jobDateParts.length !== 3) return false;

          const jobDay = parseInt(jobDateParts[0]);
          const jobMonth = parseInt(jobDateParts[1]);
          const jobYear = parseInt(jobDateParts[2]);

          const jobDate = new Date(jobYear, jobMonth - 1, jobDay);

          return jobDate >= start && jobDate <= end;
        });

        return res.status(200).json({ jobs: filteredJobs });
      }
    }

    const jobs = await JobModel.find(query).select('-jobDescription').lean();
    res.status(200).json({ jobs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

const getUniqueClientsFromJobs = async (req, res) => {
  try {
    const { operatorEmail } = req.query;

    let query = {};
    if (operatorEmail) {
      query.operatorEmail = operatorEmail.toLowerCase();
    }

    const jobs = await JobModel.find(query, 'userID').lean();
    const uniqueUserIDs = [...new Set(jobs.map(job => job.userID).filter(id =>
      id && /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(id)
    ))];

    res.status(200).json({ clients: uniqueUserIDs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Get client statistics for an operator (applied and saved counts)
const getClientStatistics = async (req, res) => {
  try {
    const { email } = req.params;
    const { startDate, endDate } = req.query;
    const opEmail = email.toLowerCase();

    const operation = await OperationsModel.findOne({ email: opEmail }).lean();
    if (!operation) return res.status(404).json({ error: 'Operation not found' });

    const userIds = (operation.managedUsers || []).map(id => id.toString());
    if (!userIds.length) return res.status(200).json({ clientStats: [] });

    // Batch-fetch all users + fallback clients in parallel (eliminates N+1)
    const [users, fallbackClients] = await Promise.all([
      NewUserModel.find({ _id: { $in: userIds } }).select('name email').lean(),
      ClientModel.find({ userID: { $in: userIds } }).select('name email userID').lean()
    ]);

    const userMap = new Map(users.map(u => [u._id.toString(), u]));
    const fallbackMap = new Map(fallbackClients.map(c => [c.userID, { name: c.name, email: c.email || c.userID }]));

    // Resolve user details
    const resolvedUsers = userIds.map(id => {
      const u = userMap.get(id) || fallbackMap.get(id);
      if (!u) return null;
      return { email: u.email || id, name: u.name || (u.email || id).split('@')[0] };
    }).filter(Boolean);

    const userEmails = resolvedUsers.map(u => u.email);

    // Neither count is scoped to this operator any more.
    //
    // A client's cards are spread across whoever worked them - ushac had 287
    // from sarah, 274 from arjun and 4 of their own - so an operatorEmail
    // filter turned "this client's applications" into "the slice this operator
    // happened to add". It also made savedCount permanently 0, because a saved
    // card is stamped operatorEmail: "user@flashfirehq", never an operator's.
    // The Saved number rendered beside this one already comes from
    // getSavedJobCounts(), which is client-wide; these now agree with it and
    // with the client's own Job Tracker.
    const milestoneMatch = { userID: { $in: userEmails }, currentStatus: { $regex: MILESTONE_COUNT_STATUS_RE } };
    const savedPipeline = [
      { $match: { userID: { $in: userEmails }, currentStatus: SAVED_STATUS_RE } },
      { $group: { _id: '$userID', count: { $sum: 1 } } }
    ];

    if (startDate && endDate) {
      const window = appliedDateWindow(startDate, endDate);
      if (!window) return res.status(400).json({ error: 'Invalid startDate or endDate' });
      const { start, end } = window;

      // Single aggregation for all users: applied count + saved count
      const [appliedAgg, savedAgg] = await Promise.all([
        JobModel.aggregate([
          { $match: { ...milestoneMatch, appliedDate: { $regex: APPLIED_DATE_RE } } },
          ...APPLIED_DATE_STAGES,
          { $match: { _dt: { $gte: start, $lte: end } } },
          { $group: { _id: '$userID', count: { $sum: 1 } } }
        ]),
        JobModel.aggregate(savedPipeline)
      ]);

      const appliedMap = new Map(appliedAgg.map(r => [r._id, r.count]));
      const savedMap = new Map(savedAgg.map(r => [r._id, r.count]));

      const clientStats = resolvedUsers.map(u => ({
        name: u.name,
        email: u.email,
        appliedCount: appliedMap.get(u.email) || 0,
        savedCount: savedMap.get(u.email) || 0
      }));

      return res.status(200).json({ clientStats });
    }

    // No date range: lifetime counts.
    //
    // This branch used to count EVERY card the operator had touched and label
    // the result appliedCount - deleted, removed and saved cards all included.
    // maratherajat98 read 1254 where the real applied figure was 1071. It now
    // uses the same Applied/Interviewing/Offer/Rejected whitelist as every
    // other milestone count in this file.
    const [allAgg, savedAgg] = await Promise.all([
      JobModel.aggregate([
        { $match: milestoneMatch },
        { $group: { _id: '$userID', count: { $sum: 1 } } }
      ]),
      JobModel.aggregate(savedPipeline)
    ]);

    const allMap = new Map(allAgg.map(r => [r._id, r.count]));
    const savedMap = new Map(savedAgg.map(r => [r._id, r.count]));

    const clientStats = resolvedUsers.map(u => ({
      name: u.name,
      email: u.email,
      appliedCount: allMap.get(u.email) || 0,
      savedCount: savedMap.get(u.email) || 0
    }));

    res.status(200).json({ clientStats });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Get saved job counts for specific clients
const getSavedJobCounts = async (req, res) => {
  try {
    const { userEmails } = req.body;

    if (!userEmails || !Array.isArray(userEmails)) {
      return res.status(400).json({ error: 'userEmails array is required in request body' });
    }

    const savedCounts = {};

    // Get saved job counts for each user email
    for (const userEmail of userEmails) {
      const savedCount = await JobModel.countDocuments({
        userID: userEmail,
        currentStatus: SAVED_STATUS_RE
      });

      savedCounts[userEmail] = savedCount;
    }

    res.status(200).json({ savedCounts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Optimized helper function to parse date strings
const parseDateString = (dateStr) => {
  if (!dateStr) return null;

  try {
    // Handle different date formats.
    //
    // Was [month, day, year] - the wrong way round. appliedDate is written
    // en-IN, so it is DAY first ("31/12/2025, 11:15:15 pm"), and every other
    // parser in this file already reads it that way. Nothing calls this helper
    // today (both call sites shadow it with their own correct copy), but it
    // sat here reversing dates for whoever picked it up next.
    if (dateStr.includes(',')) {
      const datePart = dateStr.split(',')[0].trim();
      const [a, b, year] = datePart.split('/').map((n) => parseInt(n, 10));
      // A second part above 12 can only be a day, so that row is M/D/Y.
      const day = b > 12 ? b : a;
      const month = b > 12 ? a : b;
      return new Date(year, month - 1, day);
    }

    // Try standard Date parsing
    return new Date(dateStr);
  } catch (error) {
    return null;
  }
};

// Cache for job analytics data
const analyticsCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Performance monitoring
const performanceStats = {
  totalRequests: 0,
  cacheHits: 0,
  averageResponseTime: 0,
  lastReset: Date.now()
};

// Get jobs by date - OPTIMIZED VERSION with pagination
const getJobsByDate = async (req, res) => {
  const startTime = Date.now();
  performanceStats.totalRequests++;

  try {
    const { date, page = 1, limit = 1000, includeClients = true } = req.body;

    if (!date) {
      return res.status(400).json({ error: 'Date is required' });
    }

    // Validate pagination parameters
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(10000, Math.max(1, parseInt(limit))); // Max 10k records per page
    const skip = (pageNum - 1) * limitNum;

    // Check cache first (only for first page to avoid cache complexity)
    const cacheKey = `jobs_by_date_${date}_${pageNum}_${limitNum}`;
    const cached = analyticsCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL && pageNum === 1) {
      performanceStats.cacheHits++;
      const responseTime = Date.now() - startTime;
      performanceStats.averageResponseTime =
        (performanceStats.averageResponseTime * (performanceStats.totalRequests - 1) + responseTime) / performanceStats.totalRequests;

      return res.status(200).json({
        ...cached.data,
        _performance: {
          fromCache: true,
          responseTime: responseTime,
          cacheHitRate: (performanceStats.cacheHits / performanceStats.totalRequests * 100).toFixed(2) + '%'
        }
      });
    }

    // Parse input date flexibly: supports 'DD/MM/YYYY', 'MM/DD/YYYY', and 'YYYY-MM-DD'
    let year, month, day;
    if (typeof date === 'string') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        // YYYY-MM-DD
        const [y, m, d] = date.split('-').map(n => parseInt(n, 10));
        year = y; month = m; day = d;
      } else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(date)) {
        // D/M/YYYY or M/D/YYYY (ambiguous). We'll use the numbers as provided and
        // generate multi-format regex below that covers both interpretations.
        const [a, b, y] = date.split('/').map(n => parseInt(n, 10));
        // Prefer interpreting as D/M/YYYY because the DB example is '29/10/YYYY'
        day = a; month = b; year = y;
      } else {
        // Try JS Date as a last resort
        const tmp = new Date(date);
        if (!isNaN(tmp.getTime())) {
          year = tmp.getFullYear();
          month = tmp.getMonth() + 1;
          day = tmp.getDate();
        }
      }
    }
    if (!year || !month || !day) {
      return res.status(400).json({ error: 'Invalid date format' });
    }

    // Build robust regex that matches both D/M/YYYY and M/D/YYYY (with or without leading zeros)
    const dd = String(day).padStart(2, '0');
    const mm = String(month).padStart(2, '0');
    const dmY = `${day}/${month}/${year}`;      // D/M/YYYY
    const dmY0 = `${dd}/${mm}/${year}`;         // DD/MM/YYYY
    const mdY = `${month}/${day}/${year}`;      // M/D/YYYY
    const mdY0 = `${mm}/${dd}/${year}`;         // MM/DD/YYYY
    // Regex anchors to start of string; allow both zero-padded and non-padded variants
    const multiFormatDateRegex = new RegExp(`^(?:${dmY}|${dmY0}|${mdY}|${mdY0})`);

    // First, get total count for pagination using updatedAt
    const countPipeline = [
      {
        $match: {
          updatedAt: { $regex: multiFormatDateRegex }
        }
      },
      { $count: "total" }
    ];

    const totalCountResult = await JobModel.aggregate(countPipeline);
    const totalCount = totalCountResult.length > 0 ? totalCountResult[0].total : 0;
    const totalPages = Math.ceil(totalCount / limitNum);

    const pipeline = [
      {
        $match: {
          updatedAt: { $regex: multiFormatDateRegex }
        }
      },
      { $skip: skip },
      { $limit: limitNum },
      {
        $group: {
          _id: {
            status: {
              $switch: {
                branches: [
                  { case: { $regexMatch: { input: { $toLower: { $ifNull: ["$currentStatus", ""] } }, regex: /offer/ } }, then: "offer" },
                  { case: { $regexMatch: { input: { $toLower: { $ifNull: ["$currentStatus", ""] } }, regex: /appl/ } }, then: "applied" },
                  { case: { $regexMatch: { input: { $toLower: { $ifNull: ["$currentStatus", ""] } }, regex: /interview/ } }, then: "interviewing" },
                  { case: { $regexMatch: { input: { $toLower: { $ifNull: ["$currentStatus", ""] } }, regex: /reject/ } }, then: "rejected" },
                  { case: { $regexMatch: { input: { $toLower: { $ifNull: ["$currentStatus", ""] } }, regex: /delete|removed/ } }, then: "deleted" },
                  { case: { $regexMatch: { input: { $toLower: { $ifNull: ["$currentStatus", ""] } }, regex: /save/ } }, then: "saved" }
                ],
                default: "saved"
              }
            },
            userID: "$userID",
            userName: "$operatorName"
          },
          count: { $sum: 1 }
        }
      },
      {
        $group: {
          _id: "$_id.status",
          totalCount: { $sum: "$count" },
          clients: {
            $push: {
              email: "$_id.userID",
              name: "$_id.userName",
              count: "$count"
            }
          }
        }
      }
    ];

    let results;
    try {
      results = await JobModel.aggregate(pipeline);
    } catch (aggregationError) {
      console.warn('Aggregation failed, falling back to optimized find method:', aggregationError.message);

      // Fallback: Use optimized find with projection and pagination using updatedAt
      const jobs = await JobModel.find({
        updatedAt: { $regex: multiFormatDateRegex }
      })
        .select('currentStatus userID operatorName updatedAt')
        .lean()
        .skip(skip)
        .limit(limitNum);

      const statusData = {
        saved: { count: 0, clients: [] },
        applied: { count: 0, clients: [] },
        interviewing: { count: 0, clients: [] },
        offer: { count: 0, clients: [] },
        rejected: { count: 0, clients: [] },
        deleted: { count: 0, clients: [] }
      };

      const clientCounts = {};

      jobs.forEach(job => {
        if (job.updatedAt && job.updatedAt.startsWith(exactDatePattern)) {
          const status = (job.currentStatus || '').toLowerCase();
          const clientEmail = job.userID;
          const clientName = job.operatorName || 'Unknown';

          // Map status names
          let mappedStatus = 'saved';
          if (status.includes('offer')) mappedStatus = 'offer';
          else if (status.includes('appl')) mappedStatus = 'applied';
          else if (status.includes('interview')) mappedStatus = 'interviewing';
          else if (status.includes('reject')) mappedStatus = 'rejected';
          else if (status.includes('delete') || status.includes('removed')) mappedStatus = 'deleted';
          else if (status.includes('save')) mappedStatus = 'saved';

          if (statusData[mappedStatus]) {
            statusData[mappedStatus].count++;

            // Count per client with name
            if (!clientCounts[mappedStatus]) {
              clientCounts[mappedStatus] = {};
            }
            if (!clientCounts[mappedStatus][clientEmail]) {
              clientCounts[mappedStatus][clientEmail] = { count: 0, name: clientName };
            }
            clientCounts[mappedStatus][clientEmail].count++;
          }
        }
      });

      // Convert client counts to array format with names
      Object.keys(statusData).forEach(status => {
        if (clientCounts[status]) {
          statusData[status].clients = Object.keys(clientCounts[status]).map(email => ({
            email,
            name: clientCounts[status][email].name,
            count: clientCounts[status][email].count
          }));
        }
      });

      const totalJobs = Object.values(statusData).reduce((sum, status) => sum + status.count, 0);

      const responseTime = Date.now() - startTime;
      performanceStats.averageResponseTime =
        (performanceStats.averageResponseTime * (performanceStats.totalRequests - 1) + responseTime) / performanceStats.totalRequests;

      const responseData = {
        success: true,
        date: date,
        totalJobs,
        ...statusData,
        pagination: {
          currentPage: pageNum,
          totalPages: Math.ceil(totalCount / limitNum),
          totalCount: totalCount,
          limit: limitNum,
          hasNextPage: pageNum < Math.ceil(totalCount / limitNum),
          hasPrevPage: pageNum > 1
        },
        _performance: {
          fromCache: false,
          responseTime: responseTime,
          cacheHitRate: (performanceStats.cacheHits / performanceStats.totalRequests * 100).toFixed(2) + '%',
          method: 'fallback'
        }
      };

      // Cache the result
      analyticsCache.set(cacheKey, {
        data: responseData,
        timestamp: Date.now()
      });

      return res.status(200).json(responseData);
    }

    // Initialize status data
    const statusData = {
      saved: { count: 0, clients: [] },
      applied: { count: 0, clients: [] },
      interviewing: { count: 0, clients: [] },
      offer: { count: 0, clients: [] },
      rejected: { count: 0, clients: [] },
      deleted: { count: 0, clients: [] }
    };

    // Process aggregation results
    let totalJobs = 0;
    results.forEach(result => {
      const status = result._id;
      if (statusData[status]) {
        statusData[status].count = result.totalCount;
        statusData[status].clients = result.clients;
        totalJobs += result.totalCount;
      }
    });

    const responseTime = Date.now() - startTime;
    performanceStats.averageResponseTime =
      (performanceStats.averageResponseTime * (performanceStats.totalRequests - 1) + responseTime) / performanceStats.totalRequests;

    const responseData = {
      success: true,
      date: date,
      totalJobs,
      ...statusData,
      pagination: {
        currentPage: pageNum,
        totalPages: totalPages,
        totalCount: totalCount,
        limit: limitNum,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1
      },
      _performance: {
        fromCache: false,
        responseTime: responseTime,
        cacheHitRate: (performanceStats.cacheHits / performanceStats.totalRequests * 100).toFixed(2) + '%',
        method: 'aggregation'
      }
    };

    analyticsCache.set(cacheKey, {
      data: responseData,
      timestamp: Date.now()
    });


    if (analyticsCache.size > 100) {
      const entries = Array.from(analyticsCache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      // Remove oldest 20 entries
      for (let i = 0; i < 20 && i < entries.length; i++) {
        analyticsCache.delete(entries[i][0]);
      }
    }

    res.status(200).json(responseData);

  } catch (error) {
    console.error('Error fetching jobs by date:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Simple job analytics - removed complex version

// Add the job analytics route after function definition
app.post('/api/jobs/by-date', getJobsByDate);

/**
 * JobDB `operatorName` is sometimes stored as an ops email (e.g. sarah@flashfirehq) instead of a display name.
 * Strip the domain for Client Job Analysis, todos API, and Discord reminders so UI matches the main dashboard intent.
 */
function formatLastAppliedOperatorDisplayName(raw, { keepUser = false } = {}) {
  if (raw == null || typeof raw !== 'string') return '';
  const t = raw.trim();
  if (!t) return '';
  // "user" means the CLIENT applied it themselves. Two callers want opposite
  // things from that, so it is a parameter rather than a fixed rule:
  //   • Client Job Analysis wants to show it — a dash there reads as "nobody has
  //     ever applied", which is wrong and hides an entire class of active client.
  //   • runJobCardReminder must NOT, because it opens "Hi {name}, please apply"
  //     and addressing the message to "User" is nonsense.
  if (t.toLowerCase() === 'user') return keepUser ? 'user' : '';
  const at = t.indexOf('@');
  if (at > 0) {
    const local = t.slice(0, at).trim();
    if (local) return local;
  }
  return t;
}

/** Same source as main dashboard Application Timeline: `UpdateChanges` pushes `applied by {operationsName}`. */
function lastAppliedActorFromTimeline(timeline) {
  if (!Array.isArray(timeline) || timeline.length === 0) return '';
  for (let i = timeline.length - 1; i >= 0; i--) {
    const m = String(timeline[i] || '').match(/\bapplied\s+by\s+(.+)/i);
    if (m) return m[1].trim();
  }
  return '';
}

function resolveLastAppliedOperatorDisplayName(job, opts) {
  const fromTimeline = lastAppliedActorFromTimeline(job?.timeline);
  const raw = fromTimeline || (job?.operatorName || '');
  return formatLastAppliedOperatorDisplayName(raw, opts);
}

/** Recompute paused duration from row fields (used on cache hit so days stay current). */
function freshPausedDaysFromRow(row) {
  if (!row || !row.isPaused || row.onboardingPhase) return null;
  if (!row.pausedAt) return null;
  const t = new Date(row.pausedAt).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

// Client Job Analysis (Recent Activity) - per active client status counts and applied-on-date
// Dedupe concurrent cold computes of the same analysis key within this instance
// (avoids a thundering herd of full-collection scans when the cache is empty).
const _analysisInFlight = new Map();

app.post('/api/analytics/client-job-analysis', async (req, res) => {
  try {
    const { date, refresh } = req.body || {};
    const cacheKey = date || '__all__';
    // The response carries a day-scoped number (removedByAI, which defaults to
    // TODAY when no date filter is set), so a cached
    // payload is only valid on the IST day it was computed. See
    // utils/analysisCachePolicy.js for why freshness alone is not enough.
    const istDay = istDayStamp();
    // The add columns (addedToday and friends) belong to the 22:00 IST operator
    // window, which is NOT the calendar day. Both stamps go on the payload and
    // both are checked before a cached entry is reused.
    const addWindowDay = addWindowDayStamp();
    const sameIstDay = (val) => !!val && val.istDay === istDay;
    // Explicit operator Refresh (see fetchAnalysis in ClientJobAnalysis.jsx).
    const forceFresh = refresh === true;

    // Re-apply time-sensitive formatting to cached rows before serving: operator
    // display name + "paused days" (grows with wall-clock time, so must be recomputed).
    const freshenForResponse = (result, servedFrom) => {
      if (!result || !Array.isArray(result.rows)) return result;
      // cacheAgeMs is derived from generatedAt NOW, never read from the stored
      // payload: the stored copy was written at compute time, so its age would
      // be frozen at ~0 and every cached answer would claim to be live.
      const genMs = Date.parse(result.generatedAt);
      return {
        ...result,
        servedFrom,
        cacheAgeMs: Number.isFinite(genMs) ? Math.max(0, Date.now() - genMs) : null,
        rows: result.rows.map((row) => ({
          ...row,
          lastAppliedOperatorName: formatLastAppliedOperatorDisplayName(row.lastAppliedOperatorName || '', { keepUser: true }),
          pausedDays: freshPausedDaysFromRow(row)
        }))
      };
    };
    const serve = (result, servedFrom) => {
      const out = freshenForResponse(result, servedFrom);
      // Only when the numbers were just computed. The notice is idempotent, but it
      // costs sequential Mongo reads per qualifying row, and with 60s polling from
      // several tabs every cache hit would repeat them for data that has not moved.
      if (servedFrom === 'compute' && out && Array.isArray(out.rows)) {
        runHighAppliedJobsNotifications(out.rows).catch((err) =>
          console.error('[client-job-analysis] runHighAppliedJobsNotifications:', err?.message || err)
        );
      }
      return res.status(200).json(out);
    };

    // Heavy compute (cold path). Closes over date/cacheKey; stores to both cache layers.
    const computeFull = async () => {
    // Snapshot time and cache generation at the START. generatedAt must describe
    // when the data was read, not when the referral lookup finished seconds later,
    // and a cache clear that lands mid-compute (an operator edit) must stop this
    // run from storing its now-outdated payload.
    const startedAt = new Date();
    const genAtStart = analysisCacheGeneration();
    // Build multi-format date regex if provided (for appliedDate)
    let multiFormatDateRegex = null;
    if (date && typeof date === 'string' && /^(\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})$/.test(date)) {
      let y, m, d;
      if (date.includes('-')) {
        const [yy, mm, dd] = date.split('-').map(n => parseInt(n, 10));
        y = yy; m = mm; d = dd;
      } else {
        const [a, b, yy] = date.split('/').map(n => parseInt(n, 10));
        d = a; m = b; y = yy; // Prefer D/M/YYYY
      }
      const dayPattern = d < 10 ? `[0]?${d}` : `${d}`;
      const monthPattern = m < 10 ? `[0]?${m}` : `${m}`;
      multiFormatDateRegex = new RegExp(`^${dayPattern}/${monthPattern}/${y}(?=$|\\D)`);
    }

    // Classify a raw currentStatus string into a bucket. Runs in JS on the small
    // GROUPED result (a few thousand {userID,status} rows) instead of inside the
    // aggregation per-document (millions of regex evals) — the previous $switch
    // of $regexMatch was the single biggest cost of this endpoint.
    const classifyStatus = (status) => {
      const s = (status || '').toLowerCase();
      if (s.includes('offer')) return 'offer';
      if (s.includes('appl')) return 'applied';
      if (s.includes('interview')) return 'interviewing';
      if (s.includes('reject')) return 'rejected';
      if (s.includes('delete') || s.includes('removed')) return 'deleted';
      if (s.includes('save')) return 'saved';
      return 'saved';
    };

    // "Removed by AI today" is matched on removalDate, which is written once, at
    // removal, as an IST locale string ("10/07/2026, 3:45:12 pm") by both AI
    // removal paths. updatedAt would be wrong here — it moves on every later
    // write, so a job removed last week but touched today would count as today's.
    const istNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    const iD = istNow.getUTCDate();
    const iM = istNow.getUTCMonth() + 1;
    const iY = istNow.getUTCFullYear();
    const todayRemovalDateRegex = new RegExp(
      `^${iD < 10 ? `0?${iD}` : iD}/${iM < 10 ? `0?${iM}` : iM}/${iY}(?=$|\\D)`
    );

    // ── Phase 1: Run ALL aggregations + client query in parallel ──
    // The last-applied aggregation does a $sort over every applied job (the
    // heaviest stage), so it gets its own longer-lived cache, backed cross-instance.
    // Version is IN THE KEY, not compared after the read: this entry is a bare
    // array with nowhere to hang a stamp, and a deploy that changes what the
    // aggregation returns must not keep serving the previous shape for the rest
    // of the TTL.
    const lastAppliedKey = `__lastAppliedOperator__v${ANALYSIS_PAYLOAD_VERSION}`;
    // A forced Refresh skips this cache entirely (and rewrites it below), or the
    // "last applied operator" column would lag by up to LAST_APPLIED_CACHE_TTL
    // behind a button that promises live data.
    let cachedLastApplied = forceFresh ? null : getAnalysisCache(lastAppliedKey);
    if (!cachedLastApplied && !forceFresh) {
      const pLA = await pGetAnalysisCache(lastAppliedKey);
      if (pLA && pLA.fresh) cachedLastApplied = pLA.val;
    }
    const [overall, appliedOnDate, removedOnDate, removedByAiOnDate, lastAppliedAgg, clientInfo, aiRemovedAgg, firstAppliedAgg, addStats, applyStats] = await Promise.all([
      // 1) Overall counts per client, grouped on the RAW status. No regex/$switch
      //    in the pipeline — Mongo can satisfy this from the { userID:1, currentStatus:1 }
      //    index (covered scan, no document fetch). Buckets are folded in JS below.
      JobModel.aggregate([
        { $group: { _id: { userID: "$userID", status: "$currentStatus" }, count: { $sum: 1 } } }
      ], { allowDiskUse: true }),
      // 2) Applied-on-date per client (only if date provided)
      multiFormatDateRegex
        ? JobModel.aggregate([
          { $match: { appliedDate: { $regex: multiFormatDateRegex } } },
          { $group: { _id: "$userID", count: { $sum: 1 } } },
          { $project: { _id: 0, userID: "$_id", count: 1 } }
        ])
        : Promise.resolve([]),
      // 3) Removed-on-date per client (only if date provided)
      multiFormatDateRegex
        ? JobModel.aggregate([
          {
            $match: {
              $and: [
                { $or: [{ currentStatus: { $regex: /delete/i } }, { currentStatus: { $regex: /removed/i } }] },
                { updatedAt: { $regex: multiFormatDateRegex } }
              ]
            }
          },
          { $group: { _id: "$userID", count: { $sum: 1 } } },
          { $project: { _id: 0, userID: "$_id", count: 1 } }
        ])
        : Promise.resolve([]),
      // 3b) AI-removed-on-date per client (only if date provided). Mirrors (3)
      //     but restricted to removedBy:'AI' (second judge + exclusion AI).
      multiFormatDateRegex
        ? JobModel.aggregate([
          {
            $match: {
              $and: [
                { $or: [{ removedBy: 'AI' }, { currentStatus: { $regex: /by ai\s*$/i } }] },
                { updatedAt: { $regex: multiFormatDateRegex } }
              ]
            }
          },
          { $group: { _id: "$userID", count: { $sum: 1 } } },
          { $project: { _id: 0, userID: "$_id", count: 1 } }
        ])
        : Promise.resolve([]),
      // 4) Last applied operator per client — use dedicated 5-min cache; skip heavy aggregation if cached
      cachedLastApplied
        ? Promise.resolve(cachedLastApplied)
        : JobModel.aggregate([
          {
            $match: {
              // Matched on the TIMELINE alone. appliedDate used to be required
              // here as well, and that is what emptied this column: appliedDate
              // is only stamped by UpdateChanges.shouldSetAppliedDate(), which
              // compared the stored status against the literal string "saved".
              // Every operator status write appends " by <name>", so once a card
              // had been moved to Saved by a person its status read
              // "saved by Sathya", the comparison could never match, and the
              // stamp was skipped. Requiring it here dropped every one of those
              // jobs even though their timeline plainly records who applied.
              //
              // The timeline entry is the authoritative answer to "who applied
              // this" anyway: UpdateChanges pushes the attributed status string
              // itself, so "applied by Sathya" IS the timeline entry. Dropping
              // the appliedDate condition fixes the historical rows immediately,
              // with no backfill needed.
              // Any apply at all, including the client's own. The $not clause
              // that used to sit here excluded "applied by user", so a client
              // who applies for themselves showed a dash forever — indistinguishable
              // from one nobody has ever touched. Whoever applied the last card
              // is the answer; "user" is a valid answer.
              timeline: { $elemMatch: { $regex: /applied\s+by\s/i } }
            }
          },
          // Newest-CREATED job that has an apply entry. This is an approximation
          // of "most recently applied" and it is the best one available: the only
          // stored apply timestamp is appliedDate, a free-form string Mongo can
          // order lexicographically at best, and it is null on a large slice of
          // the collection (see UpdateChanges.shouldSetAppliedDate). ObjectIds
          // are monotonic in creation time, so this is at least deterministic and
          // always resolves to a real card.
          { $sort: { _id: -1 } },
          { $group: { _id: '$userID', timeline: { $first: '$timeline' } } },
          { $project: { _id: 0, userID: '$_id', timeline: 1 } }
        ], { allowDiskUse: true }),
      // 5) Client info — runs in parallel with aggregations (no dependency)
      ClientModel.find({})
        .select('email name clientNumber planType planPrice status jobStatus operationsName dashboardTeamLeadName isPaused onboardingPhase addons pausedAt clientCountry amountPaid upgradePayments jobrightCreated')
        .lean(),
      // 6) AI-REMOVED per client, lifetime + today. Jobs the AI actually moved to
      //    the Removed column, never jobs it merely FLAGGED — a flag leaves the
      //    job exactly where it was, and only an operator may remove it. Two
      //    sources stamp removedBy:'AI': second-stage screening (closed/expired
      //    postings) and the client exclusion list (blocked company/location).
      //    Same match as pipeline (3b), minus its date filter.
      JobModel.aggregate([
        {
          $match: {
            $and: [
              // Must actually BE removed. Without this, a job that was AI-removed
              // and later restored would still carry removedBy:'AI' and could make
              // "AI removed" exceed "Removed", which is its parent bucket. The
              // status test mirrors classifyStatus(), which feeds that column.
              { $or: [{ currentStatus: { $regex: /delete/i } }, { currentStatus: { $regex: /removed/i } }] },
              { $or: [{ removedBy: 'AI' }, { currentStatus: { $regex: /by ai\s*$/i } }] }
            ]
          }
        },
        {
          $group: {
            _id: '$userID',
            count: { $sum: 1 },
            todayCount: {
              $sum: {
                $cond: [
                  { $regexMatch: { input: { $ifNull: ['$removalDate', ''] }, regex: todayRemovalDateRegex } },
                  1,
                  0
                ]
              }
            }
          }
        },
        { $project: { _id: 0, userID: '$_id', count: 1, todayCount: 1 } }
      ]),
      // 7) FIRST application per client — powers the "Days Since 1st Apply"
      //    column.
      //
      //    Match on EITHER signal. appliedDate is only stamped by newer code
      //    paths, so plenty of long-standing clients have hundreds of applied
      //    jobs and not one appliedDate; matching on that field alone left the
      //    column blank for exactly the clients it matters most for. The status
      //    test mirrors classifyStatus() above (s.includes('appl')), which is
      //    what the Applied column counts, and it also catches jobs applied and
      //    later removed — those were still applications that went out.
      //
      //    appliedDate is a free-form STRING, so Mongo can only order it
      //    lexicographically. Take the earliest-created matching job by _id
      //    (ObjectIds are monotonic in creation time) and resolve its date in
      //    JS below.
      JobModel.aggregate([
        {
          $match: {
            $or: [
              { appliedDate: { $nin: [null, '', ' '] } },
              { currentStatus: { $regex: /appl/i } }
            ]
          }
        },
        { $sort: { _id: 1 } },
        { $group: { _id: '$userID', firstId: { $first: '$_id' }, firstAppliedDate: { $first: '$appliedDate' } } },
        { $project: { _id: 0, userID: '$_id', firstId: 1, firstAppliedDate: 1 } }
      ], { allowDiskUse: true }),
      // 8) JOBS ADDED per client, bucketed by the 22:00 IST operator window.
      //    This is the number the whole under-delivery problem turns on: every
      //    other column here is either a lifetime total or counts jobs APPLIED,
      //    so a day on which an operator added nothing at all was previously
      //    invisible on this screen. Keyed on ObjectId timestamps because
      //    dateAdded is written in mixed day-first/month-first orientations and
      //    cannot be bucketed by day. See utils/clientAddStats.js.
      computeClientAddStats({ JobModel, ProfileModel: getProfileModel() })
        .catch((err) => {
          // Never let the new columns take down an endpoint the CRM depends on.
          // An empty map degrades to dashes in the UI, not a 500.
          console.error('[client-job-analysis] computeClientAddStats:', err?.message || err);
          // null, not an empty Map: an empty Map reads as "nobody ever had a job
          // added" and would raise a critical NO_ADDS on every active client.
          return null;
        }),
      // 9) APPLY RECENCY per client. Powers the "saved but nothing applied"
      //    alert. Deliberately independent of the date picker: the alert asks
      //    "is work going out RIGHT NOW", which is a question about today, not
      //    about whichever day the operator happens to be inspecting.
      computeClientApplyStats({ JobModel })
        .catch((err) => {
          console.error('[client-job-analysis] computeClientApplyStats:', err?.message || err);
          // null for the same reason: an empty Map would read as "nothing applied
          // today" for every client with a saved column.
          return null;
        })
    ]);

    // Cache last-applied operator separately with a longer TTL than the payload (see LAST_APPLIED_CACHE_TTL)
    if (!cachedLastApplied) {
      setAnalysisCache(lastAppliedKey, lastAppliedAgg, LAST_APPLIED_CACHE_TTL);
      pSetAnalysisCache(lastAppliedKey, lastAppliedAgg, LAST_APPLIED_CACHE_TTL).catch(() => {});
    }

    // JobModel.userID is free text and is not lowercased on write, while
    // ClientModel.email is. Keying job-side counts on the raw value split a client
    // whose jobs sit under "Foo@Gmail.com" into a ghost row carrying the jobs and
    // a real row showing saved: 0, which hid NOT_APPLIED. Fold on trim+lower, the
    // same key the add and apply stats already use, and SUM on collision.
    const normId = (v) => String(v ?? '').trim().toLowerCase();
    const sumByEmail = (list) => {
      const m = new Map();
      for (const r of list || []) {
        const k = normId(r.userID);
        if (k) m.set(k, (m.get(k) || 0) + (r.count || 0));
      }
      return m;
    };
    const appliedMap = sumByEmail(appliedOnDate);
    // email -> { at: Date, days: number } for the client's FIRST application.
    // Days are whole IST calendar days elapsed, floored, so an application made
    // earlier today reads as 0 rather than rounding up to 1.
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const nowMs = Date.now();
    // appliedDate is written DAY-first (verified against the collection: 2996
    // rows are unambiguously D/M — first component > 12 — and zero are M/D).
    // parseFlexibleDate() is wrong for it: that helper tries new Date() first,
    // which reads "1/8/2026" as 8 January instead of 1 August whenever both
    // components are <= 12, silently shifting most dates by months.
    const parseDayFirstDate = (val) => {
      const str = String(val ?? '').trim();
      if (!str || str === ' ') return null;
      const m = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
      if (m) {
        const day = Number(m[1]), mon = Number(m[2]), yr = Number(m[3]);
        if (day >= 1 && day <= 31 && mon >= 1 && mon <= 12) {
          const dt = new Date(Date.UTC(yr, mon - 1, day));
          if (!Number.isNaN(dt.getTime())) return dt;
        }
      }
      const native = new Date(str);
      return Number.isNaN(native.getTime()) ? null : native;
    };
    // A FIRST application dated in the future is never real. It means the
    // string was read with the wrong day/month orientation — and because the
    // day count is floored at 0, that used to surface as a confident "0 days"
    // rather than as an error. Distrust anything beyond the tolerance and fall
    // back to the job document's own creation time, which cannot be misread.
    // Tolerance covers clock skew and the IST/UTC gap, not a genuine mistake.
    const FUTURE_TOLERANCE_MS = 36 * 60 * 60 * 1000;
    const firstAppliedMap = new Map();
    let futureRejected = 0;
    for (const r of (firstAppliedAgg || [])) {
      const email = normId(r.userID);
      if (!email) continue;
      // Prefer the stamped appliedDate; otherwise use when the job doc itself
      // was created. dateAdded is NOT used as a fallback — it is written in
      // mixed orientations (6564 day-first vs 1688 month-first rows), so it
      // cannot be parsed reliably. The ObjectId timestamp always can.
      let at = parseDayFirstDate(r.firstAppliedDate);
      if (at && at.getTime() - nowMs > FUTURE_TOLERANCE_MS) {
        futureRejected++;
        at = null;
      }
      if (!at && r.firstId?.getTimestamp) {
        try { at = r.firstId.getTimestamp(); } catch { at = null; }
      }
      if (!at) continue;
      const days = Math.max(0, Math.floor((nowMs - at.getTime()) / MS_PER_DAY));
      // Case variants of one email group separately upstream; the earliest wins.
      const prevFirst = firstAppliedMap.get(email);
      if (!prevFirst || at.getTime() < prevFirst.at.getTime()) firstAppliedMap.set(email, { at, days });
    }
    console.log(
      `[client-job-analysis] first-apply resolved for ${firstAppliedMap.size}/${(firstAppliedAgg || []).length} client(s)` +
      (futureRejected ? ` — ${futureRejected} had a future appliedDate and fell back to the job's creation time` : '')
    );
    const removedMap = sumByEmail(removedOnDate);
    const removedByAiMap = sumByEmail(removedByAiOnDate);
    const aiRemovedMap = new Map();
    for (const r of aiRemovedAgg || []) {
      const k = normId(r.userID);
      if (!k) continue;
      const prev = aiRemovedMap.get(k) || { count: 0, todayCount: 0 };
      aiRemovedMap.set(k, { count: prev.count + (r.count || 0), todayCount: prev.todayCount + (r.todayCount || 0) });
    }
    // Fold raw {userID,status} groups into per-user bucket counts (JS, cheap).
    const overallMap = new Map();
    for (const g of overall) {
      const userID = normId(g._id?.userID);
      if (!userID) continue;
      const bucket = classifyStatus(g._id?.status);
      let counts = overallMap.get(userID);
      if (!counts) { counts = {}; overallMap.set(userID, counts); }
      counts[bucket] = (counts[bucket] || 0) + g.count;
      // Track the AI-removed subset separately (currentStatus "… by AI" — set
      // by the second judge + exclusion reconciliation) so the CRM can show
      // "Removed" and "Removed by AI" as distinct columns.
      if (bucket === 'deleted' && /by ai\s*$/i.test(String(g._id?.status || ''))) {
        counts.deletedByAI = (counts.deletedByAI || 0) + g.count;
      }
    }
    const lastAppliedOperatorMap = new Map(
      lastAppliedAgg.map((r) => [
        normId(r.userID),
        resolveLastAppliedOperatorDisplayName(r, { keepUser: true })
      ])
    );
    const jobUserIDs = Array.from(new Set([...overallMap.keys(), ...appliedMap.keys(), ...removedMap.keys()]));

    const allUserIDs = Array.from(new Set([...jobUserIDs, ...clientInfo.map(c => c.email)]));

    const referralUsers = await NewUserModel.find({ email: { $in: allUserIDs } }, 'email referrals').lean();

    // Summary from dashboardtrackings: status (active/inactive), isPaused, onboardingPhase (new/paused/unpaused)
    const summary = { active: 0, inactive: 0, new: 0, paused: 0, unpaused: 0 };
    for (const c of clientInfo) {
      const s = (c.status || '').toLowerCase();
      if (s === 'active') summary.active++;
      else summary.inactive++;
      if (c.onboardingPhase) summary.new++;
      else if (c.isPaused) summary.paused++;
      else summary.unpaused++;
    }

    const clientMap = new Map(clientInfo.map(c => [c.email, {
      name: c.name,
      clientNumber: c.clientNumber,
      planType: c.planType,
      planPrice: c.planPrice,
      status: c.status,
      jobStatus: c.jobStatus,
      operationsName: c.operationsName || '',
      dashboardTeamLeadName: c.dashboardTeamLeadName || '',
      isPaused: !!c.isPaused,
      onboardingPhase: !!c.onboardingPhase,
      pausedAt: c.pausedAt != null ? new Date(c.pausedAt).toISOString() : null,
      clientCountry: (() => {
        if (c.clientCountry === 'USA' || c.clientCountry === 'Canada' || c.clientCountry === 'UK' || c.clientCountry === 'Australia' || c.clientCountry === 'Europe') return c.clientCountry;
        const amt = String(c.amountPaid || '');
        if (amt.startsWith('CAD')) return 'Canada';
        if (amt.startsWith('AUD')) return 'Australia';
        if (amt.startsWith('£')) return 'UK';
        if (amt.startsWith('€')) return 'Europe';
        if (amt.startsWith('$') || amt.startsWith('₹')) return 'USA';
        return null;
      })(),
      addonLimit: (c.addons || []).reduce((sum, a) => {
        const v = parseInt(a.type || a.addonType || 0, 10);
        return sum + (isNaN(v) ? 0 : v);
      }, 0),
      amountPaid: c.amountPaid ?? null,
      upgradePayments: Array.isArray(c.upgradePayments) ? c.upgradePayments : [],
      // Non-null when the plan on this document disagrees with its own payment
      // fields. Computed server-side so the screen and any future report can
      // never apply two different definitions of "mismatch".
      planMismatch: planPaymentMismatch(c),
      // Coerced here so a document written before the field existed arrives as
      // false rather than undefined, which the UI would otherwise have to treat
      // as a third state.
      jobrightCreated: c.jobrightCreated === true
    }]));

    const referralMap = new Map();
    referralUsers.forEach((user) => {
      const email = (user.email || '').toLowerCase();
      const referralsArray = Array.isArray(user.referrals) ? user.referrals : [];
      let referralApplicationsAdded = 0;
      referralsArray.forEach((ref) => {
        if (ref?.plan === 'Professional') referralApplicationsAdded += 200;
        else if (ref?.plan === 'Executive') referralApplicationsAdded += 300;
      });
      const latestReferral = referralsArray.length > 0 ? referralsArray[referralsArray.length - 1] : null;
      referralMap.set(email, { referrals: referralsArray, referralApplicationsAdded, latestReferralName: latestReferral?.name || null });
    });

    // ── Build response rows ──
    let rows = allUserIDs.map(email => {
      const counts = overallMap.get(email) || {};
      const client = clientMap.get(email) || {};
      const referralMeta = referralMap.get(email.toLowerCase()) || {};
      const removedCount = multiFormatDateRegex ? (removedMap.get(email) || 0) : (counts.deleted || 0);
      // ONE AI-removed number, and it always answers "on the day you are looking
      // at": the selected date when a date filter is set, otherwise TODAY. Two
      // columns (today + lifetime) made the operator read a total and a daily
      // figure side by side and decide which one the date picker applied to.
      // Lifetime is deliberately NOT exposed here — "Removed" already carries the
      // running total, and an AI lifetime number next to a per-day one is exactly
      // the ambiguity being removed.
      const removedByAICount = multiFormatDateRegex
        ? (removedByAiMap.get(email) || 0)
        : (aiRemovedMap.get(email)?.todayCount || 0);
      // A client with no add row at all added nothing in seven days, which is
      // the loudest signal on this screen — fall back to a zeroed stat rather
      // than leaving the columns undefined.
      const addStat = addStats?.get(email.toLowerCase()) || emptyAddStat();
      // No entry means no application in the lookback window at all, which is
      // exactly what the alert needs to know — not an error case.
      const applyStat = applyStats?.get(email.toLowerCase()) || emptyApplyStat();
      // Mirrors clientFilterActiveUnpaused(), the filter the reminder crons use,
      // so "under target" means the same thing on the screen and in Discord.
      const owesWork = (client.status || '') === 'active'
        && !client.isPaused
        && !client.onboardingPhase;
      return {
        email,
        name: client.name || email,
        clientNumber: client.clientNumber ?? null,
        planType: client.planType || null,
        planPrice: client.planPrice || null,
        planPriceExpected: PLAN_PRICES[normalisePlanType(client.planType)] ?? null,
        planMismatch: client.planMismatch ?? null,
        amountPaid: client.amountPaid ?? null,
        upgradePayments: client.upgradePayments || [],
        status: client.status || null,
        jobStatus: client.jobStatus || null,
        operationsName: client.operationsName || '',
        isPaused: client.isPaused ?? false,
        onboardingPhase: client.onboardingPhase ?? false,
        pausedAt: client.pausedAt ?? null,
        pausedDays: freshPausedDaysFromRow({
          isPaused: client.isPaused ?? false,
          onboardingPhase: client.onboardingPhase ?? false,
          pausedAt: client.pausedAt ?? null
        }),
        clientCountry: client.clientCountry ?? null,
        // Whole days since this client's FIRST application went out. null when
        // they have never applied — the UI must show a dash, not "0 days".
        firstAppliedAt: firstAppliedMap.get(email.toLowerCase())?.at?.toISOString() ?? null,
        daysSinceFirstApplication: firstAppliedMap.get(email.toLowerCase())?.days ?? null,
        dashboardTeamLeadName: client.dashboardTeamLeadName || '',
        // Whether a JobRight account exists for this client. False covers both
        // "synced and not on the list" and "never synced". Operationally the
        // same thing: somebody still has to create it.
        jobrightCreated: client.jobrightCreated === true,
        lastAppliedOperatorName: lastAppliedOperatorMap.get(email.toLowerCase()) || '',
        referrals: referralMeta.referrals || [],
        referralApplicationsAdded: referralMeta.referralApplicationsAdded || 0,
        latestReferralName: referralMeta.latestReferralName || null,
        addonLimit: client.addonLimit || 0,
        saved: counts.saved || 0,
        applied: counts.applied || 0,
        interviewing: counts.interviewing || 0,
        offer: counts.offer || 0,
        rejected: counts.rejected || 0,
        removed: removedCount,
        // Counts REMOVALS only — never AI flags, which leave the job in place for
        // an operator to decide. Scoped to the selected date, or today.
        removedByAI: removedByAICount,
        appliedOnDate: appliedMap.get(email) || 0,
        // ── Jobs ADDED, on the 22:00 IST operator window ──
        // addedToday is always the LIVE window and deliberately ignores the date
        // picker: the picker filters appliedDate, and there is no reliable
        // per-day added history to filter on (dateAdded is unparseable). Showing
        // a date-scoped "added" next to a live one would invite exactly the
        // ambiguity the removedByAI column was collapsed to avoid.
        addedToday: addStat.addedToday,
        addedYesterday: addStat.addedYesterday,
        added7dAvg: addStat.added7dAvg,
        dailyTarget: addStat.dailyTarget,
        isDefaultTarget: addStat.isDefaultTarget,
        addShortfall: addStat.addShortfall,
        addFulfillmentPct: addStat.addFulfillmentPct,
        // Only meaningful for a client we actually owe work to. A paused or
        // inactive client legitimately gets nothing added, and flagging them red
        // trains operators to ignore the colour.
        isUnderTarget: addStat.isUnderTarget && owesWork,
        // Whether a daily add target applies at all. Without this the UI cannot
        // tell "hit the target" apart from "paused, so there was no target" —
        // both arrive as isUnderTarget:false and used to render identically.
        addTargetTracked: owesWork,
        lastAddedAt: addStat.lastAddedAt ? new Date(addStat.lastAddedAt).toISOString() : null,
        daysSinceLastAdd: addStat.daysSinceLastAdd,
        addedTodayBy: addStat.todayOperators,
        // ── Applications going OUT, on the IST calendar day ──
        // Separate boundary from the add columns above, and deliberately so:
        // appliedDate is an IST wall-clock stamp with no window in it. See the
        // header comment in utils/clientApplyStats.js.
        appliedToday: applyStat.appliedToday,
        daysSinceLastApply: applyStat.daysSinceLastApply,
        lastAppliedYmd: applyStat.lastAppliedYmd,
        applyLookbackDays: APPLY_LOOKBACK_DAYS,
        // True when the stats query failed and the figures above are zero
        // placeholders, not data. deriveClientAlerts stays silent on them.
        addStatsUnavailable: !addStats,
        applyStatsUnavailable: !applyStats
      };
    });

    // Attention alerts, derived once here so the screen and any future digest
    // can never disagree about what "needs attention" means.
    for (const r of rows) r.alerts = deriveClientAlerts(r);

    // Sort: active first, then by clientNumber ascending (same as Client Onboarding)
    const getSortingNumber = (r) => {
      if (r.clientNumber != null) return Number(r.clientNumber);
      const name = r.name || '';
      const m = name.match(/^(\d{4,})/);
      if (m) return parseInt(m[1], 10);
      const m2 = name.match(/^(\d+)/);
      if (m2) return parseInt(m2[1], 10);
      return 0;
    };
    rows.sort((a, b) => {
      const statusOrder = { 'active': 0, 'inactive': 1 };
      const statusA = statusOrder[a.status] ?? 2;
      const statusB = statusOrder[b.status] ?? 2;
      if (statusA !== statusB) return statusA - statusB;
      const numA = getSortingNumber(a);
      const numB = getSortingNumber(b);
      return numA - numB;
    });

    // Headline counts for the tiles above the table. Computed from rows rather
    // than clientInfo because isUnderTarget already folds in the owesWork test.
    summary.underTarget = rows.filter((r) => r.isUnderTarget).length;
    summary.addedToday = rows.reduce((n, r) => n + (r.addedToday || 0), 0);
    summary.staleClients = rows.filter((r) => r.isUnderTarget && (r.daysSinceLastAdd ?? 0) >= 1).length;
    summary.alerts = summariseAlerts(rows);

    // istDay stamps which IST calendar day removedByAI belongs to; the
    // cache readers below refuse an entry from a different day.
    // payloadVersion stamps the row SHAPE. Without it a deploy that adds a field
    // is invisible to anyone holding a cached entry until the next day boundary.
    const result = { success: true, date: date || null, istDay, addWindowDay, payloadVersion: ANALYSIS_PAYLOAD_VERSION, generatedAt: startedAt.toISOString(), rows, summary };
    // A payload built while a stats query failed carries zero placeholders. Serve
    // it once, but never store it: the next request should retry the query instead
    // of replaying the gap for the whole TTL.
    if (addStats && applyStats && analysisCacheGeneration() === genAtStart) {
      setAnalysisCache(cacheKey, result);
      pSetAnalysisCache(cacheKey, result, ANALYSIS_CACHE_TTL).catch(() => {});
    }
    return result;
    }; // end computeFull

    // A forced Refresh must never join a compute that a non-forced request
    // started: that run read the DB (and the last-applied cache) before whatever
    // the operator just changed, so joining it would hand back pre-edit rows
    // labelled as live. A forced request starts its own run instead; it takes the
    // in-flight slot, and a non-forced run finishing later leaves the slot alone.
    const computeWithLock = () => {
      const cur = _analysisInFlight.get(cacheKey);
      if (cur && (!forceFresh || cur.forced)) return cur.p;
      const slot = { forced: forceFresh };
      slot.p = computeFull().finally(() => {
        if (_analysisInFlight.get(cacheKey) === slot) _analysisInFlight.delete(cacheKey);
      });
      _analysisInFlight.set(cacheKey, slot);
      return slot.p;
    };

    // L1: in-memory cache (dev / single-instance prod; disabled in multi-instance
    // prod). L2 is only read when L1 cannot answer, so a hit costs no Mongo call.
    const memHit = forceFresh ? null : getAnalysisCache(cacheKey);
    const entry = sameIstDay(memHit) ? null : await pGetAnalysisCache(cacheKey);

    switch (decideAnalysisCacheAction({ forceFresh, memHit, entry, istDay, addWindowDay, payloadVersion: ANALYSIS_PAYLOAD_VERSION })) {
      case 'l1':
        return serve(memHit, 'l1');

      case 'l2-fresh':
        setAnalysisCache(cacheKey, entry.val); // warm L1 (no-op when memory cache disabled)
        return serve(entry.val, 'l2-fresh');

      case 'l2-stale':
        // Stale-while-revalidate: answer instantly, recompute in the background.
        // Deliberately NOT warmed into L1: L1 would give this up-to-60s-old
        // payload a fresh TTL and serve it past MAX_STALE_MS.
        if (!_analysisInFlight.has(cacheKey)) {
          computeWithLock().then((fresh) => {
            // This recompute is never passed to serve(), which only notifies on a
            // compute it answers with, so notify from here.
            if (fresh && Array.isArray(fresh.rows)) return runHighAppliedJobsNotifications(fresh.rows);
          }).catch((err) =>
            console.error('[client-job-analysis] background refresh:', err?.message || err)
          );
        }
        return serve(entry.val, 'l2-stale');

      default: {
        // Cold miss, an entry from another IST day, an entry too old to serve
        // stale (MAX_STALE_MS), or a forced Refresh of a stale entry: compute
        // now (deduped across concurrent requests here).
        const result = await computeWithLock();
        return serve(result, 'compute');
      }
    }
  } catch (e) {
    console.error('client-job-analysis error', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Applied-by-date: count jobs whose appliedDate falls on the given day, grouped by userID
app.post('/api/analytics/applied-by-date', async (req, res) => {
  try {
    const { date } = req.body || {};
    if (!date || typeof date !== 'string') {
      return res.status(400).json({ success: false, error: 'date is required' });
    }

    // Build multi-format date regex for appliedDate matching
    let y, m, d;
    if (date.includes('-')) { // YYYY-MM-DD
      const [yy, mm, dd] = date.split('-').map(n => parseInt(n, 10));
      y = yy; m = mm; d = dd;
    } else { // D/M/YYYY or M/D/YYYY
      const [a, b, yy] = date.split('/').map(n => parseInt(n, 10));
      d = a; m = b; y = yy;
    }
    if (!y || !m || !d) return res.status(400).json({ success: false, error: 'Invalid date' });
    const dayPattern = d < 10 ? `[0]?${d}` : `${d}`;
    const monthPattern = m < 10 ? `[0]?${m}` : `${m}`;
    const dateRegex = new RegExp(`^${dayPattern}/${monthPattern}/${y}(?=$|\\D)`);

    const results = await JobModel.aggregate([
      { $match: { appliedDate: { $regex: dateRegex } } },
      { $group: { _id: '$userID', count: { $sum: 1 } } },
      { $project: { _id: 0, userID: '$_id', count: 1 } }
    ]);

    // Return both array and map for convenience
    const counts = {};
    for (const r of results) counts[r.userID] = r.count;
    res.status(200).json({ success: true, date, results, counts });
  } catch (e) {
    console.error('applied-by-date error', e);
    res.status(500).json({ success: false, error: e.message });
  }
});


app.get('/api/analytics/performance', (req, res) => {
  res.json({
    success: true,
    stats: {
      ...performanceStats,
      cacheSize: analyticsCache.size,
      uptime: Date.now() - performanceStats.lastReset
    }
  });
});

app.post('/api/analytics/clear-cache', (req, res) => {
  analyticsCache.clear();
  performanceStats.totalRequests = 0;
  performanceStats.cacheHits = 0;
  performanceStats.averageResponseTime = 0;
  performanceStats.lastReset = Date.now();
  res.json({ success: true, message: 'Cache cleared' });
});

// ==========================
// Call Scheduler (BullMQ)
// ==========================
const REDIS_URL = process.env.REDIS_CLOUD_URL || process.env.UPSTASH_REDIS_URL;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM = process.env.TWILIO_FROM;
const CALL_STATUS_WEBHOOK_URL = process.env.CALL_STATUS_WEBHOOK_URL || process.env.PUBLIC_BASE_URL ? `${process.env.PUBLIC_BASE_URL}/api/calls/status` : undefined;

let redisConnection;
let callQueue;
let callWorker;
let callQueueEvents;
let twilioClient;

try {
  if (!REDIS_URL) {
    console.warn('⚠️  REDIS URL not set; call scheduler disabled');
  } else {
    redisConnection = new IORedis(REDIS_URL, {
      // Required by BullMQ to avoid throwing on blocking ops in serverless/managed redis
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true, // Don't connect immediately
      retryStrategy: () => null, // Disable automatic retries completely
      reconnectOnError: () => false, // Disable auto-reconnect
      showFriendlyErrorStack: false,
    });

    // Suppress ALL connection-related errors to prevent console spam
    const originalEmit = redisConnection.emit.bind(redisConnection);
    redisConnection.emit = function (event, ...args) {
      if (event === 'error') {
        const err = args[0];
        // Suppress connection errors completely
        if (err && err.message && (
          err.message.includes('EAI_AGAIN') ||
          err.message.includes('ECONNREFUSED') ||
          err.message.includes('getaddrinfo') ||
          err.code === 'EAI_AGAIN'
        )) {
          return false; // Suppress the error event
        }
      }
      return originalEmit(event, ...args);
    };

    // Try to connect asynchronously, but don't block
    redisConnection.connect().catch(() => {
      // Connection failed silently - call scheduler will be disabled
    });

    // Create queue and events with error suppression
    callQueue = new Queue('callQueue', {
      connection: redisConnection,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: true,
      }
    });

    callQueueEvents = new QueueEvents('callQueue', {
      connection: redisConnection
    });

    // Suppress all errors from Queue and QueueEvents
    const suppressConnectionError = (err) => {
      if (err && err.message && (
        err.message.includes('EAI_AGAIN') ||
        err.message.includes('ECONNREFUSED') ||
        err.message.includes('getaddrinfo') ||
        err.code === 'EAI_AGAIN'
      )) {
        return; // Suppress
      }
    };

    callQueue.on('error', suppressConnectionError);
    callQueueEvents.on('error', suppressConnectionError);
  }
  if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
    twilioClient = Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  }
} catch (e) {
  console.error('❌ Error initializing Call Scheduler:', e.message);
  redisConnection = null;
  callQueue = null;
  callQueueEvents = null;
}

if (callQueue && twilioClient && TWILIO_FROM) {
  callWorker = new Worker(
    'callQueue',
    async (job) => {
      const { phoneNumber } = job.data || {};
      if (!phoneNumber) throw new Error('phoneNumber missing');

      // Mark processing in logs
      await CallLogModel.findOneAndUpdate(
        { jobId: job.id },
        { status: 'in_progress', attemptAt: new Date(), $push: { statusHistory: { event: 'in_progress', status: 'in_progress', timestamp: new Date() } } }
      );

      // Build dynamic TwiML with meeting time = scheduled time + 10 minutes
      let meetingTimeText = 'the scheduled time';
      try {
        const log = await CallLogModel.findOne({ jobId: String(job.id) }).lean();
        // Priority: explicit announceTimeText from job -> from log -> fallback +10 minutes
        const explicitText = job?.data?.announceTimeText || log?.announceTimeText;
        if (explicitText && explicitText.trim().length > 0) {
          meetingTimeText = explicitText.trim();
        } else {
          const baseTime = log?.scheduledFor ? new Date(log.scheduledFor) : new Date();
          const meetingDate = new Date(baseTime.getTime() + 10 * 60 * 1000);
          meetingTimeText = meetingDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        }
      } catch { }

      const { VoiceResponse } = Twilio.twiml;
      const twiml = new VoiceResponse();
      twiml.pause({ length: 1 });
      twiml.say(
        { voice: 'alice', language: 'en-US' },
        `Hi, this is FlashFire. This is a quick reminder for your meeting scheduled at ${meetingTimeText}.`
      );
      twiml.say(
        { voice: 'alice', language: 'en-US' },
        'See you in the meeting. Thank you and good luck.'
      );

      const call = await twilioClient.calls.create({
        to: phoneNumber,
        from: TWILIO_FROM,
        twiml: twiml.toString(),
        ...(CALL_STATUS_WEBHOOK_URL
          ? {
            statusCallback: CALL_STATUS_WEBHOOK_URL,
            statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
            statusCallbackMethod: 'POST',
          }
          : {}),
      });

      await CallLogModel.findOneAndUpdate(
        { jobId: job.id },
        { twilioCallSid: call.sid, callStatus: 'initiated', status: 'calling', $push: { statusHistory: { event: 'initiated', status: 'calling', raw: { sid: call.sid }, timestamp: new Date() } } }
      );

      return { ok: true, sid: call.sid };
    },
    { connection: redisConnection }
  );

  // Suppress connection errors from Worker
  callWorker.on('error', (err) => {
    if (err && err.message && (
      err.message.includes('EAI_AGAIN') ||
      err.message.includes('ECONNREFUSED') ||
      err.message.includes('getaddrinfo') ||
      err.code === 'EAI_AGAIN'
    )) {
      return; // Suppress connection errors
    }
  });

  callWorker.on('failed', async (job, err) => {
    try {
      await CallLogModel.findOneAndUpdate(
        { jobId: job?.id },
        { status: 'failed', error: err?.message || 'Unknown error', attemptAt: new Date() }
      );
    } catch { }
  });
}


// Schedule a call
app.post('/api/calls/schedule', verifyToken, async (req, res) => {
  try {
    const { phoneNumber, scheduleTime, announceTimeText } = req.body || {};
    if (!callQueue || !twilioClient || !TWILIO_FROM) {
      return res.status(503).json({ success: false, error: 'Call scheduler not configured' });
    }
    if (!phoneNumber || !scheduleTime) {
      return res.status(400).json({ success: false, error: 'phoneNumber and scheduleTime are required' });
    }
    // Validate E.164-like number quickly
    if (!/^\+?[1-9]\d{7,14}$/.test(phoneNumber)) {
      return res.status(400).json({ success: false, error: 'Invalid phone number. Use country code, e.g. +14155551234' });
    }
    const scheduledAt = new Date(scheduleTime);
    if (isNaN(scheduledAt.getTime())) {
      return res.status(400).json({ success: false, error: 'Invalid scheduleTime' });
    }
    const delayMs = Math.max(0, scheduledAt.getTime() - Date.now());

    const job = await callQueue.add(
      'makeCall',
      { phoneNumber, announceTimeText: (announceTimeText || '').trim() || undefined },
      {
        delay: delayMs,
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
      }
    );

    await CallLogModel.create({
      phoneNumber,
      scheduledFor: scheduledAt,
      announceTimeText: (announceTimeText || '').trim() || undefined,
      status: 'queued',
      jobId: String(job.id),
      statusHistory: [{ event: 'queued', status: 'queued', raw: { jobId: String(job.id) }, timestamp: new Date() }]
    });

    res.status(201).json({ success: true, jobId: job.id, scheduledFor: scheduledAt });
  } catch (e) {
    console.error('schedule call error', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// List recent call logs
async function sweepOverdueCalls(graceMs = 120000) {
  const now = Date.now();
  let updatedCount = 0;

  try {
    const overdueCandidates = await CallLogModel.find({
      scheduledFor: { $lte: new Date(now - graceMs) },
      status: { $in: ['queued', 'in_progress', 'calling'] }
    }).limit(200).lean();

    for (const c of overdueCandidates) {
      await CallLogModel.updateOne(
        { _id: c._id },
        {
          status: 'completed',
          callStatus: c.callStatus || 'completed',
          callEndAt: new Date(),
          $push: { statusHistory: { event: 'auto-completed', status: 'completed', timestamp: new Date(), raw: { reason: 'overdue_sweep' } } }
        }
      );
      updatedCount++;
    }

    // Auto-complete calls stuck in "calling" status for more than 30 seconds - NO MATTER WHAT
    const callingTimeoutMs = 30 * 1000; // 30 seconds - aggressive timeout to ensure calls never stay stuck
    const callingCandidates = await CallLogModel.find({
      status: 'calling',
      updatedAt: { $lte: new Date(now - callingTimeoutMs) }
    }).limit(200).lean();

    for (const c of callingCandidates) {
      const stuckForSeconds = Math.round((now - new Date(c.updatedAt).getTime()) / 1000);
      await CallLogModel.updateOne(
        { _id: c._id },
        {
          status: 'completed',
          callStatus: 'completed',
          callEndAt: new Date(),
          $push: { statusHistory: { event: 'auto-completed', status: 'completed', timestamp: new Date(), raw: { reason: 'calling_timeout_30sec', originalStatus: c.status, originalCallStatus: c.callStatus, stuckForSeconds } } }
        }
      );
      updatedCount++;
      console.log(`✅ [Call Sweep] Auto-completed call ${c._id} (phone: ${c.phoneNumber}) - was stuck in "calling" for ${stuckForSeconds}s (30s timeout enforced)`);
    }

    if (updatedCount > 0) {
      console.log(`[Call Sweep] Auto-completed ${updatedCount} stuck calls`);
    }

    return updatedCount;
  } catch (error) {
    console.error('❌ [Call Sweep] Error sweeping overdue calls:', error);
    return 0;
  }
}

app.get('/api/calls/logs', verifyToken, async (req, res) => {
  try {
    await sweepOverdueCalls(2 * 60 * 1000);
    const pageNum = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '5'), 10) || 5));
    const skip = (pageNum - 1) * limitNum;
    const [raw, total] = await Promise.all([
      CallLogModel.find({})
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      CallLogModel.countDocuments({}),
    ]);
    const mapDerived = (l) => {
      const hist = Array.isArray(l.statusHistory) ? l.statusHistory : [];
      const last = hist.length ? hist[hist.length - 1] : null;
      // Derive a friendly status priority
      let derived = l.status;
      if (l.callStatus) {
        const cs = String(l.callStatus).toLowerCase();
        if (cs.includes('complete')) derived = 'completed';
        else if (cs.includes('answer') || cs.includes('progress')) derived = 'in_progress';
        else if (cs.includes('ring')) derived = 'calling';
        else if (cs.includes('init')) derived = 'calling';
        else if (cs.includes('busy') || cs.includes('no-answer') || cs.includes('cancel')) derived = 'failed';
      } else if (last) {
        derived = last.status || last.event || derived;
      }
      const lastUpdated = last?.timestamp || l.updatedAt || l.createdAt;
      return { ...l, derivedStatus: derived, lastUpdated };
    };
    const logs = raw.map(mapDerived);
    res.json({
      success: true,
      logs,
      total,
      page: pageNum,
      pageSize: limitNum,
      totalPages: Math.ceil(total / limitNum) || 0,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete('/api/calls/logs', verifyToken, verifyAdmin, async (req, res) => {
  try {
    await CallLogModel.deleteMany({});
    res.status(200).json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message || 'Failed to clear logs' });
  }
});

// Optional: list queued jobs
app.get('/api/calls/jobs', verifyToken, async (req, res) => {
  try {
    if (!callQueue) return res.json({ success: true, jobs: [] });
    const jobs = await callQueue.getJobs(['delayed', 'waiting', 'active']);
    res.json({
      success: true,
      jobs: jobs.map((j) => ({ id: j.id, name: j.name, delay: j.delay, timestamp: j.timestamp, data: j.data })),
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Twilio status webhook (no auth; configure CALL_STATUS_WEBHOOK_URL)
app.post('/api/calls/status', async (req, res) => {
  try {
    const {
      CallSid,
      CallStatus,
      CallDuration,
      From,
      To,
      Timestamp,
      SequenceNumber,
    } = req.body || {};

    // Find by Sid if available, otherwise by To number (latest)
    let log = null;
    if (CallSid) {
      log = await CallLogModel.findOne({ twilioCallSid: CallSid }).lean();
    }
    if (!log && To) {
      log = await CallLogModel.findOne({ phoneNumber: To }).sort({ createdAt: -1 }).lean();
    }

    if (log) {
      const historyEntry = {
        event: CallStatus,
        status: CallStatus,
        timestamp: Timestamp ? new Date(Timestamp) : new Date(),
        raw: req.body,
      };

      const update = {
        callStatus: CallStatus,
        $push: { statusHistory: historyEntry },
      };

      if (CallDuration) {
        update.callDurationSec = Number(CallDuration);
      }
      if (CallStatus === 'in-progress' || CallStatus === 'answered') {
        update.callStartAt = new Date();
      }
      if (CallStatus === 'completed' || CallStatus === 'busy' || CallStatus === 'failed' || CallStatus === 'no-answer' || CallStatus === 'canceled') {
        update.callEndAt = new Date();
        if (CallStatus === 'completed') {
          update.status = 'completed';
        } else if (CallStatus === 'failed') {
          update.status = 'failed';
        }
      }

      await CallLogModel.updateOne({ _id: log._id }, update);
    }

    // Always 200 OK to Twilio
    res.type('text/plain').send('OK');
  } catch (e) {
    // Still return 200 to prevent Twilio retries storm, but log server-side
    console.error('Twilio status webhook error', e);
    res.type('text/plain').send('OK');
  }
});

// Get plan type statistics
const getPlanTypeStats = async (req, res) => {
  try {
    // Aggregate clients by plan type
    const planTypeStats = await NewUserModel.aggregate([
      {
        $group: {
          _id: "$planType",
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);

    // Get total clients
    const totalClients = await NewUserModel.countDocuments();

    // Format data for charts
    const formattedData = planTypeStats.map(stat => ({
      planType: stat._id,
      count: stat.count,
      percentage: ((stat.count / totalClients) * 100).toFixed(1)
    }));

    res.status(200).json({
      success: true,
      data: {
        totalClients,
        planTypeStats: formattedData,
        rawStats: planTypeStats
      }
    });
  } catch (error) {
    console.error('Error fetching plan type statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch plan type statistics',
      error: error.message
    });
  }
};

// Get revenue statistics
const getRevenueStats = async (req, res) => {
  try {
    // Get all clients from ClientModel to calculate real revenue from amountPaid
    const allClients = await ClientModel.find({}).lean();

    // Sum up all amountPaid values (parsing strings to numbers)
    let totalRevenue = 0;

    allClients.forEach(client => {
      let amountPaid = client.amountPaid || 0;

      // If amountPaid is a string, parse it to a number
      if (typeof amountPaid === 'string') {
        // Remove currency symbols ($, ₹, £, CAD, AUD) and any whitespace
        amountPaid = amountPaid.replace(/[$₹£€,\s]|CAD|AUD/gi, '').trim();
        // Convert to number, default to 0 if invalid
        amountPaid = parseFloat(amountPaid) || 0;
      }

      // Ensure it's a number before adding
      totalRevenue += Number(amountPaid) || 0;
    });

    res.status(200).json({
      success: true,
      data: {
        totalRevenue
      }
    });
  } catch (error) {
    console.error('Error fetching revenue statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch revenue statistics',
      error: error.message
    });
  }
};

// Google-mail connection status per client — backs the "Google Mail" Yes/No
// column in Client Job Analysis. Lightweight and separate from the heavy
// analytics endpoint on purpose. Reads the SHARED collections directly (no
// model import needed): a client is "connected" when a connected mailbox's
// email OR ownerEmail matches their account email; "reconnect" when their only
// mailbox has a dead Google token (gmailpollstates.authErrorAt, written by the
// dashboard mail poller).
// Which clients have no payment email on file, for the email-reach badge on
// Client Job Analysis. Every client notification (reminders, onboarding,
// milestones, inbox alerts) goes to the payment email, so a client without one
// hears nothing from us.
app.get('/api/clients/payment-email-status', verifyToken, async (req, res) => {
  try {
    const clients = await mongoose.connection.db
      .collection('dashboardtrackings')
      .find({}, { projection: { email: 1, paymentEmail: 1 } })
      .toArray();
    const noPaymentEmail = clients
      .filter((c) => !String(c.paymentEmail || '').trim())
      .map((c) => String(c.email || '').toLowerCase())
      .filter(Boolean);
    res.json({ noPaymentEmail });
  } catch (e) {
    console.error('payment-email-status error', e?.message || e);
    res.status(500).json({ error: 'payment_email_status_failed' });
  }
});

app.get('/api/clients/mail-connection', async (req, res) => {
  try {
    const db = mongoose.connection.db;
    const oauthMailboxes = await db
      .collection('gmailusers')
      .find({ refreshToken: { $exists: true, $ne: '' } }, { projection: { email: 1, ownerEmail: 1 } })
      .toArray();
    // Gmail app passwords (IMAP + SMTP), set by operators on the dashboard
    // Profile page. They take precedence over OAuth on the same address, and a
    // rejected one (authFailedAt) needs replacing just like a dead token.
    let appMailboxes = [];
    try {
      appMailboxes = await db
        .collection('mailapppasswords')
        .find({}, { projection: { gmailEmail: 1, ownerEmail: 1, authFailedAt: 1 } })
        .toArray();
    } catch (_) { /* collection may not exist yet — no app passwords */ }
    const appBoxes = new Set(appMailboxes.map((a) => String(a.gmailEmail || '').toLowerCase()));
    const mailboxes = [
      ...appMailboxes.map((a) => ({ email: a.gmailEmail, ownerEmail: a.ownerEmail, appPasswordFailed: !!a.authFailedAt })),
      ...oauthMailboxes.filter((m) => !appBoxes.has(String(m.email || '').toLowerCase()))
    ];

    let dead = new Set();
    try {
      const states = await db
        .collection('gmailpollstates')
        .find({ authErrorAt: { $ne: null } }, { projection: { gmailEmail: 1 } })
        .toArray();
      dead = new Set(states.map((s) => String(s.gmailEmail || '').toLowerCase()));
    } catch (_) { /* poll-state collection may not exist yet — treat as no dead tokens */ }

    const connected = new Set();
    const reconnect = new Set();
    for (const m of mailboxes) {
      const box = String(m.email || '').toLowerCase();
      const isDead = m.appPasswordFailed === true || (!appBoxes.has(box) && dead.has(box));
      for (const addr of [box, String(m.ownerEmail || '').toLowerCase()].filter(Boolean)) {
        if (isDead) reconnect.add(addr);
        else connected.add(addr);
      }
    }
    // A healthy mailbox wins: if any mailbox for an address is alive, it's connected.
    for (const a of connected) reconnect.delete(a);

    // Addresses (mailbox + owner) connected through an app password, so the
    // dot can say how a client is connected.
    const viaAppPassword = new Set();
    for (const a of appMailboxes) {
      for (const addr of [a.gmailEmail, a.ownerEmail].map((x) => String(x || '').toLowerCase()).filter(Boolean)) viaAppPassword.add(addr);
    }
    res.json({ connected: [...connected], reconnect: [...reconnect], appPassword: [...viaAppPassword], mailboxes: mailboxes.length });
  } catch (e) {
    console.error('mail-connection error', e?.message || e);
    res.status(500).json({ error: 'mail_connection_failed' });
  }
});

// Client routes
app.get('/api/clients', getAllClients);
app.get('/api/clients/stats', getClientStats);
app.get('/api/clients/plan-stats', getPlanTypeStats);
app.get('/api/clients/revenue-stats', getRevenueStats);
app.get('/api/clients/latest-number', async (req, res) => {
  try {
    const current = await getCurrentClientNumber();
    res.status(200).json({ latestClientNumber: current, nextClientNumber: current + 1 });
  } catch (error) {
    console.error('Get latest client number error:', error);
    res.status(500).json({ error: error.message || 'Failed to get latest client number' });
  }
});
app.get('/api/clients/:email', getClientByEmail);
app.get('/api/clients/all', async (req, res) => {
  try {
    // Exclude large fields using .select()
    // Example: '-jobDescription' excludes the JD field
    // You can also exclude multiple: .select('-jobDescription -timeline -notes')
    const clients = await ClientModel.find({}).lean(); // returns plain JS objects (faster)
    // console.log(`Fetched ${clients.length} clients`);
    res.status(200).json({
      success: true,
      count: clients.length,
      data: clients,
    });
  } catch (error) {
    console.error('Error fetching clients:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching clients',
    });
  }
});

/**
 * PATCH /api/clients/:email/client-number
 * Update a single client's clientNumber. Syncs to OnboardingJob. Admin only.
 * Body: { clientNumber: number } - can be null to clear the number.
 */
const updateClientNumber = async (req, res) => {
  try {
    const { email } = req.params;
    const { clientNumber } = req.body;
    const emailLower = (email || '').toLowerCase().trim();
    if (!emailLower) return res.status(400).json({ error: 'Email is required' });

    const client = await ClientModel.findOne({ email: emailLower });
    if (!client) return res.status(404).json({ error: 'Client not found' });

    let finalNumber = null;
    if (clientNumber !== undefined && clientNumber !== null && clientNumber !== '') {
      const num = parseInt(String(clientNumber).trim(), 10);
      if (isNaN(num) || num < 1) return res.status(400).json({ error: 'clientNumber must be a positive integer' });
      finalNumber = num;
      const CLIENT_NUMBER_FLOOR = 5809;
      await ClientCounterModel.findOneAndUpdate(
        { _id: 'client_number' },
        { $max: { lastNumber: Math.max(num, CLIENT_NUMBER_FLOOR - 1) } },
        { upsert: true }
      );
    }

    await ClientModel.updateOne({ email: emailLower }, { $set: { clientNumber: finalNumber } });
    await OnboardingJobModel.updateMany(
      { clientEmail: emailLower },
      { $set: { clientNumber: finalNumber } }
    );

    res.status(200).json({
      success: true,
      clientNumber: finalNumber,
      message: `Client number ${finalNumber != null ? `set to ${finalNumber}` : 'cleared'} and synced to onboarding jobs`,
    });
  } catch (error) {
    console.error('updateClientNumber:', error);
    res.status(500).json({ error: error.message || 'Failed to update client number' });
  }
};

// Europe clients scrape Indeed, Glassdoor and HiringCafe (the weekday Europe
// run in the autopilot). Setting a client's country to Europe adds the three
// to profile.scrapeSources, keeping whatever is already ticked. A client with
// no list saved is JobRight only. The dashboard backend's 3 AM Europe job does
// the same daily, which covers clients whose profile does not exist yet.
// Must match EUROPE_SOURCES in the dashboard backend's Utils/europeClients.js.
const EUROPE_SOURCES = ['indeed', 'glassdoor', 'hiringcafe'];

/** Returns the saved list, or null when the client has no dashboard profile yet. */
async function enableEuropeSources(Profile, email) {
  const profile = await Profile.collection.findOne({ email }, { projection: { scrapeSources: 1 } });
  if (!profile) return null;
  const had = Array.isArray(profile.scrapeSources) && profile.scrapeSources.length
    ? [...new Set(profile.scrapeSources.map((s) => String(s || '').toLowerCase().trim()).filter(Boolean))]
    : ['jobright'];
  const next = [...had, ...EUROPE_SOURCES.filter((s) => !had.includes(s))];
  const same = Array.isArray(profile.scrapeSources) && profile.scrapeSources.length === next.length;
  if (!same) await Profile.collection.updateOne({ email }, { $set: { scrapeSources: next } });
  return next;
}

/** PATCH /api/clients/:email/client-country — Body: { clientCountry: 'USA' | 'Canada' | 'UK' | 'Australia' | 'Europe' | null }; null clears. Admin only. */
const updateClientCountry = async (req, res) => {
  try {
    const { email } = req.params;
    const raw = req.body?.clientCountry;
    const emailLower = (email || '').toLowerCase().trim();
    if (!emailLower) return res.status(400).json({ error: 'Email is required' });

    const updatedAt = new Date().toLocaleString('en-US', 'Asia/Kolkata');
    let client;
    if (raw === '' || raw === null || raw === undefined) {
      client = await ClientModel.findOneAndUpdate(
        { email: emailLower },
        { $unset: { clientCountry: '' }, $set: { updatedAt } },
        { new: true }
      ).select('email clientCountry').lean();
    } else {
      const v = String(raw).trim();
      if (!['USA', 'Canada', 'UK', 'Australia', 'Europe'].includes(v)) {
        return res.status(400).json({ error: 'clientCountry must be USA, Canada, UK, Australia, or Europe' });
      }
      client = await ClientModel.findOneAndUpdate(
        { email: emailLower },
        { $set: { clientCountry: v, updatedAt } },
        { new: true }
      ).select('email clientCountry').lean();
    }

    if (!client) return res.status(404).json({ error: 'Client not found' });

    // undefined: not Europe. null: Europe, but no dashboard profile yet.
    let europeSources;
    if (client.clientCountry === 'Europe') {
      try {
        europeSources = await enableEuropeSources(getProfileModel(), emailLower);
      } catch (err) {
        // The country is saved; the 3 AM Europe job retries the sources.
        console.error('updateClientCountry: could not enable Europe sources:', err.message);
        europeSources = null;
      }
    }

    clearAnalysisCache();
      pClearAnalysisCache().catch(() => {});
    res.status(200).json({
      success: true,
      clientCountry: client.clientCountry ?? null,
      ...(europeSources !== undefined && { europeSources }),
      message: 'Client country updated',
    });
  } catch (error) {
    console.error('updateClientCountry:', error);
    res.status(500).json({ error: error.message || 'Failed to update client country' });
  }
};

// ─── Gmail app password (Client Job Analysis "G" dot) ─────────────────
//
// A client's Gmail app password lets Flashfire read their inbox (IMAP) and
// send recruiter mail as them (SMTP). The dashboard backend owns it: it checks
// the password against Gmail, encrypts it and stores it in the shared
// `mailapppasswords` collection. This portal only relays, server to server
// with the ops key, so the key never reaches a browser and there is exactly
// one place that encrypts and verifies.
//
// Same audience as the JobRight credentials: admins and team leads.
const verifyAppPasswordManage = (req, res, next) => {
  const role = req.user?.role || '';
  if (role === 'admin' || role === 'team_lead') return next();
  return res.status(403).json({ error: 'Only admins and team leads can manage a client\'s Gmail app password.' });
};

async function dashboardAppPassword(email, { method = 'GET', body, timeoutMs = 15000 } = {}) {
  const url = `${FLASHFIRE_API_BASE_URL.replace(/\/+$/, '')}/gmail/app-password/ops/${encodeURIComponent(email)}`;
  try {
    const resp = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', 'x-ops-key': FLASHFIRE_OPS_KEY },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await resp.json().catch(() => ({}));
    if (resp.status === 401) {
      return { status: 502, data: { error: 'ops_key_rejected', message: 'The dashboard refused this portal (OPS_SECRET_KEY must match on both services).' } };
    }
    return { status: resp.status, data };
  } catch (e) {
    const timedOut = e?.name === 'TimeoutError';
    return {
      status: timedOut ? 504 : 502,
      data: { error: timedOut ? 'dashboard_timeout' : 'dashboard_unreachable', message: timedOut ? 'Gmail took too long to answer. Try again.' : 'Could not reach the dashboard backend. Try again.' },
    };
  }
}

// GET /api/clients/:email/app-password -> { connected, gmailEmail, connectedAt, lastVerifiedAt, needsReplacing }
const getClientAppPassword = async (req, res) => {
  const emailLower = String(req.params.email || '').toLowerCase().trim();
  if (!emailLower) return res.status(400).json({ error: 'Email is required' });
  const { status, data } = await dashboardAppPassword(emailLower);
  return res.status(status).json(data);
};

// PUT /api/clients/:email/app-password { gmailEmail, appPassword }
// The dashboard logs into Gmail (IMAP and SMTP) before saving, so this can
// take several seconds. The password is relayed, never stored or logged here.
const putClientAppPassword = async (req, res) => {
  const emailLower = String(req.params.email || '').toLowerCase().trim();
  if (!emailLower) return res.status(400).json({ error: 'Email is required' });
  const { gmailEmail, appPassword } = req.body || {};
  if (typeof gmailEmail !== 'string' || typeof appPassword !== 'string') {
    return res.status(400).json({ error: 'invalid_body', message: 'Send gmailEmail and appPassword.' });
  }
  const client = await ClientModel.findOne({ email: emailLower }).select('email').lean();
  if (!client) return res.status(404).json({ error: 'client_not_found', message: 'Client not found.' });
  const { status, data } = await dashboardAppPassword(emailLower, {
    method: 'PUT',
    body: { gmailEmail, appPassword },
    timeoutMs: 60000,
  });
  if (status === 200) console.log(`app-password: ${req.user?.email || 'someone'} connected ${data.gmailEmail} for ${emailLower}`);
  return res.status(status).json(data);
};

// Toggle "JobRight account created" from the Client Job Analysis row.
//
// GET /scripts/jobrightsync seeds this flag in bulk from data/jobrightClients.js;
// this route is the per-client correction an operator makes afterwards, so the
// two write the same two fields and cannot drift.
// GET /api/clients/:email/jobright-creds
//
// The credentials behind the "JobRight: Yes" toggle, for the managers who set
// it. Same audience as the toggle itself (admin or team lead), because this
// returns the client's actual passwords.
const getClientJobrightCreds = async (req, res) => {
  try {
    const emailLower = String(req.params.email || '').toLowerCase().trim();
    if (!emailLower) return res.status(400).json({ error: 'Email is required' });

    const client = await ClientModel.findOne({ email: emailLower })
      .select('email jobrightCreated jobrightCreatedAt')
      .lean();
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const result = await fetchAutopilotJrCreds(emailLower);
    res.status(200).json({
      success: true,
      email: client.email,
      jobrightCreated: client.jobrightCreated === true,
      jobrightCreatedAt: client.jobrightCreatedAt || null,
      ...result,
    });
  } catch (error) {
    console.error('getClientJobrightCreds:', error);
    res.status(500).json({ error: error.message || 'Failed to load JobRight credentials' });
  }
};

// PUT /api/clients/:email/jobright-creds
//
// Save the autopilot logins for one client from the portal, so a manager can
// fix "Panel login needed" without opening the desktop app. Same audience as
// reading them (admin or team lead).
//
// Body (all optional): jrEmail, jrPassword, extEmail, extPassword, extCode,
// useDefaults. A field that is missing or blank is left as it is, so the
// form can be saved without retyping passwords. useDefaults: true fills every
// still-blank field with the team defaults (client email, standard passwords,
// master operator code). Answers with the fresh credentials, same shape as GET.
const CREDS_TEXT_FIELDS = ['jrEmail', 'jrPassword', 'extEmail', 'extPassword', 'extCode'];
const putClientJobrightCreds = async (req, res) => {
  try {
    const emailLower = String(req.params.email || '').toLowerCase().trim();
    if (!emailLower) return res.status(400).json({ error: 'Email is required' });
    const body = req.body || {};

    const set = {};
    for (const k of CREDS_TEXT_FIELDS) {
      if (body[k] === undefined || body[k] === null) continue;
      if (typeof body[k] !== 'string') return res.status(400).json({ error: `${k} must be text` });
      const v = body[k].trim();
      if (!v) continue;
      if (v.length > 200) return res.status(400).json({ error: `${k} is too long` });
      set[k] = v;
    }
    for (const k of ['jrEmail', 'extEmail']) {
      if (set[k] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(set[k])) {
        return res.status(422).json({ error: `${k === 'jrEmail' ? 'JobRight' : 'Panel'} email is not a valid email address` });
      }
    }
    if (set.extCode && !/^\d{5}$/.test(set.extCode)) {
      return res.status(422).json({ error: 'Operator code must be exactly 5 digits' });
    }
    if (body.useDefaults !== undefined && typeof body.useDefaults !== 'boolean') {
      return res.status(400).json({ error: 'useDefaults must be true or false' });
    }

    const client = await ClientModel.findOne({ email: emailLower }).select('email jobrightCreated jobrightCreatedAt').lean();
    if (!client) return res.status(404).json({ error: 'Client not found' });

    if (body.useDefaults === true) {
      const current = await fetchAutopilotJrCreds(emailLower, true);
      if (!current.onFile && current.reason !== 'no credentials on file') {
        return res.status(502).json({ error: `Could not read the saved credentials: ${current.reason}` });
      }
      const c = current.creds || {};
      const defaults = {
        jrEmail: emailLower,
        jrPassword: DEFAULT_JR_PASSWORD,
        extEmail: emailLower,
        extPassword: DEFAULT_PANEL_PASSWORD,
        extCode: DEFAULT_PANEL_CODE,
      };
      for (const [k, v] of Object.entries(defaults)) {
        if (!set[k] && !String(c[k] || '').trim()) set[k] = v;
      }
    }

    if (!Object.keys(set).length) {
      return res.status(400).json({ error: 'Nothing to save: every field was left blank.' });
    }

    const by = `clients-tracking:creds-form:${req.user?.email || 'unknown'}`;
    const saved = await saveAutopilotCreds(emailLower, set, by);
    if (!saved.ok) {
      // A 400 from the dashboard is a validation answer (for example a
      // FlashFire address as the JobRight login); pass it on as such.
      const status = saved.status === 400 ? 422 : 502;
      return res.status(status).json({ error: saved.message });
    }
    // Log which fields changed, never their values.
    console.log(`jobright-creds: ${req.user?.email || 'someone'} saved ${Object.keys(set).join(',')} for ${emailLower}`);

    const result = await fetchAutopilotJrCreds(emailLower);
    res.status(200).json({
      success: true,
      email: client.email,
      jobrightCreated: client.jobrightCreated === true,
      jobrightCreatedAt: client.jobrightCreatedAt || null,
      saved: Object.keys(set),
      ...result,
    });
  } catch (error) {
    console.error('putClientJobrightCreds:', error);
    res.status(500).json({ error: error.message || 'Failed to save JobRight credentials' });
  }
};

const updateClientJobright = async (req, res) => {
  try {
    const emailLower = String(req.params.email || '').toLowerCase().trim();
    if (!emailLower) return res.status(400).json({ error: 'Email is required' });

    // Strict boolean. A missing or string body would otherwise be coerced, and
    // "false" is truthy — the one mistake that would silently mark a client as
    // having an account they do not have.
    const value = req.body?.jobrightCreated;
    if (typeof value !== 'boolean') {
      return res.status(400).json({ error: 'jobrightCreated must be true or false' });
    }

    const updatedAt = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
    const client = await ClientModel.findOneAndUpdate(
      { email: emailLower },
      { $set: { jobrightCreated: value, jobrightCreatedAt: value ? new Date() : null, updatedAt } },
      { new: true }
    ).select('email jobrightCreated jobrightCreatedAt').lean();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    // Client Job Analysis serves this flag from a cache keyed on the IST day,
    // the add window and the payload version. None of those move when a single
    // flag is toggled, so without this the row would snap back to its old value
    // on the next reload. Same clear updateClientCountry does, for the same
    // reason.
    clearAnalysisCache();
    pClearAnalysisCache().catch(() => {});

    // Saying "yes, the JobRight account exists" is exactly the moment the
    // autopilot can start using it, so provision the credentials now instead
    // of leaving it as a second manual step someone forgets.
    //
    // Awaited, not fire-and-forget: the operator is told whether it worked.
    // A silent background call that fails leaves a client looking provisioned
    // and quietly never scraping - which is the failure this whole change
    // exists to remove, not one to reintroduce.
    //
    // Turning the flag OFF deliberately leaves the credentials alone. The
    // account still exists on JobRight's side; deleting the row would only
    // strand a run that is mid-flight, and re-toggling restores nothing that
    // was not already there.
    let autopilotCreds = null;
    if (value === true) {
      const by = `clients-tracking:jobright-toggle:${req.user?.email || 'admin'}`;
      autopilotCreds = await provisionAutopilotJrCreds(client.email, by);
      // The panel login is the second half the autopilot needs. Without it a
      // run opens JobRight fine and then stops at "Panel login needed".
      if (autopilotCreds.provisioned) {
        const panel = await fillPanelDefaults(client.email, by);
        autopilotCreds.panelFilled = panel.filled;
        if (!panel.ok) autopilotCreds.panelReason = panel.message;
      }
    }

    res.status(200).json({
      success: true,
      email: client.email,
      jobrightCreated: client.jobrightCreated === true,
      jobrightCreatedAt: client.jobrightCreatedAt || null,
      autopilotCreds,
      message: 'JobRight status updated'
    });
  } catch (error) {
    console.error('updateClientJobright:', error);
    res.status(500).json({ error: error.message || 'Failed to update JobRight status' });
  }
};

app.post('/api/clients', optionalVerifyToken, createOrUpdateClient);
app.post('/api/clients/addnumbers', addNumbersToClients);
app.patch('/api/clients/:email/client-number', verifyToken, verifyAdmin, updateClientNumber);
app.patch('/api/clients/:email/client-country', verifyToken, verifyAdmin, updateClientCountry);
app.patch('/api/clients/:email/jobright', verifyToken, verifyJobrightToggle, updateClientJobright);
app.get('/api/clients/:email/jobright-creds', verifyToken, verifyJobrightRead, getClientJobrightCreds);
app.put('/api/clients/:email/jobright-creds', verifyToken, verifyJobrightRead, putClientJobrightCreds);
app.get('/api/clients/:email/app-password', verifyToken, verifyAppPasswordManage, getClientAppPassword);
app.put('/api/clients/:email/app-password', verifyToken, verifyAppPasswordManage, putClientAppPassword);
app.post('/api/clients/sync-client-numbers', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const synced = await syncClientNumbersToOnboardingJobs();
    res.status(200).json({ success: true, synced, message: `Synced ${synced} onboarding job(s) with clientNumber from Client model` });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message || 'Sync failed' });
  }
});
app.post('/api/clients/sync-from-jobs', syncClientsFromJobs);
app.delete('/api/clients/delete/:email', deleteClient);
app.put('/api/clients/:email/change-password', verifyToken, verifyAdmin, changeClientPassword);
app.post('/api/clients/update-operations-name', updateClientOperationsName);
app.post('/api/clients/update-dashboard-team-lead', updateClientDashboardTeamLead);
app.put('/api/clients/:email/upgrade-plan', verifyToken, upgradeClientPlan);
app.post('/api/clients/:email/add-addon', verifyToken, addClientAddon);
app.post('/api/clients/:email/add-free-applications', verifyToken, addFreeApplications);
// Admin-only: export client milestone email logs.
// Body: { mode: 'all'|'selected', clientEmails?: [], example?: bool }
// Returns { rows: [...] }. Frontend converts to CSV/JSON file.
app.post('/api/clients/email-export', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { mode = 'all', clientEmails = [], example = false } = req.body || {};
    const senderEmail = process.env.SENDGRID_FROM_EMAIL || 'noreply@flashfirehq.com';
    const senderName = 'FlashFire Team';

    if (example) {
      const now = Date.now();
      const day = 86400000;
      const exampleRows = [
        {
          clientEmail: 'dondaviswanth2@gmail.com',
          clientName: 'Viswanth Donda',
          receiverEmail: 'donda.payments@gmail.com',
          senderEmail,
          senderName,
          subject: 'Your FlashFire applications have started — resume is ready',
          template: 'started',
          templateLabel: 'Applications started + resume',
          sentAt: new Date(now - 14 * day).toISOString(),
          status: 'success',
          errorMessage: '',
          planType: 'executive',
          planCap: 1200,
          currentCount: 12,
          percent: 1
        },
        {
          clientEmail: 'dondaviswanth2@gmail.com',
          clientName: 'Viswanth Donda',
          receiverEmail: 'donda.payments@gmail.com',
          senderEmail,
          senderName,
          subject: 'Update: 350 applications submitted on your Executive plan',
          template: 'count_350',
          templateLabel: '350 applications',
          sentAt: new Date(now - 6 * day).toISOString(),
          status: 'success',
          errorMessage: '',
          planType: 'executive',
          planCap: 1200,
          currentCount: 350,
          percent: 29
        }
      ];
      return res.json({
        rows: exampleRows,
        total: exampleRows.length,
        pending: [
          { template: 'count_700', templateLabel: '700 applications', threshold: 700 },
          { template: 'completed', templateLabel: 'Applications completed', threshold: 1200 }
        ],
        summary: {
          clientEmail: 'dondaviswanth2@gmail.com',
          clientName: 'Viswanth Donda',
          planType: 'executive',
          planCap: 1200,
          currentCount: 517,
          sent: 2,
          remaining: 2
        }
      });
    }

    const q = {};
    if (mode === 'selected') {
      const list = (Array.isArray(clientEmails) ? clientEmails : [])
        .map((e) => String(e || '').toLowerCase().trim())
        .filter(Boolean);
      if (!list.length) return res.status(400).json({ error: 'clientEmails required for selected mode' });
      q.clientEmail = { $in: list };
    }

    const logs = await ClientEmailLogModel.find(q).sort({ createdAt: -1 }).lean();

    const clientEmailsSet = Array.from(new Set(logs.map((l) => l.clientEmail))).filter(Boolean);
    const clients = clientEmailsSet.length
      ? await ClientModel.find({ email: { $in: clientEmailsSet } }).select('email name').lean()
      : [];
    const nameByEmail = new Map(clients.map((c) => [c.email, c.name || '']));

    const labelByType = {
      started: 'Applications started + resume',
      count_250: '250 applications',
      count_350: '350 applications',
      count_700: '700 applications',
      completed: 'Applications completed',
      resume_ready: 'Resume ready (legacy)',
      apps_started: 'Applications started (legacy)',
      pct30: '30% milestone (legacy)',
      pct50: '50% milestone (legacy)',
      pct75: '75% milestone (legacy)',
      pct100: '100% milestone (legacy)'
    };

    const rows = logs.map((l) => ({
      clientEmail: l.clientEmail,
      clientName: nameByEmail.get(l.clientEmail) || '',
      receiverEmail: l.paymentEmail || '',
      // Show the ACTUAL sender stored on the log (the connected Google account,
      // e.g. support@flashfirejobs.com). Fall back to the default only for
      // legacy rows that predate fromEmail being recorded.
      senderEmail: l.fromEmail || senderEmail,
      senderName,
      subject: l.subject || '',
      template: l.type || '',
      templateLabel: labelByType[l.type] || l.type || '',
      sentAt: l.createdAt ? new Date(l.createdAt).toISOString() : '',
      status: l.status || '',
      errorMessage: l.errorMessage || '',
      planType: l.snapshot?.planType || '',
      planCap: l.snapshot?.planCap || 0,
      currentCount: l.snapshot?.currentCount || 0,
      percent: l.snapshot?.percent || 0
    }));

    res.json({ rows, total: rows.length });
  } catch (e) {
    console.error('[email-export] error:', e?.message);
    res.status(500).json({ error: 'export failed' });
  }
});

// Admin: dispatch catch-up milestone email for a single client (any active client, paused included).
app.post('/api/clients/:email/send-pending-milestones', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const emailLower = String(req.params.email || '').toLowerCase().trim();
    if (!emailLower) return res.status(400).json({ error: 'email required' });
    const client = await ClientModel.findOne({ email: emailLower }).lean();
    if (!client) return res.status(404).json({ error: 'client not found' });
    // Milestone emails fire regardless of status — Inactive and Paused clients
    // still receive them. Only a recipient address is required.
    if (!client.paymentEmail) return res.status(400).json({ error: 'paymentEmail not set', code: 'no_payment_email' });

    const referralUser = await NewUserModel.findOne({ email: emailLower }, 'referrals').lean();
    const referralAdded = referralApplicationsFor(referralUser?.referrals);
    const planCap = getEffectiveCap(client, referralAdded);
    const milestones = computeClientMilestones(client, referralAdded);
    if (!milestones.length) return res.status(400).json({ error: 'plan has no milestones', code: 'no_plan' });

    const currentCount = await JobModel.countDocuments(milestoneCountFilter(emailLower));
    const notified = client.milestonesNotified || {};

    const reached = milestones.filter((m) => currentCount >= m.threshold);
    // Re-fire `completed` if effective cap grew since last send.
    const reachedUnsent = reached.filter((m) => {
      const prev = notified[m.key];
      if (!prev?.sent) return true;
      if (m.type === 'completed' && typeof prev.cap === 'number' && prev.cap < m.threshold) return true;
      return false;
    });
    if (!reachedUnsent.length) {
      return res.json({ sent: false, skipped: true, reason: 'no_pending_milestones', currentCount, planCap });
    }

    const highest = reachedUnsent.reduce((a, b) => (a.threshold > b.threshold ? a : b));
    const sendResult = await sendMilestoneEmail({
      client,
      type: highest.type,
      milestoneKey: highest.key,
      snapshot: { planCap, currentCount, threshold: highest.threshold },
      trigger: 'manual'
    });

    // Only mark milestones sent when the email actually went out. A failed
    // send stays unsent so it shows as pending/failed and can be retried.
    if (sendResult?.success) {
      const setOps = {};
      for (const m of reachedUnsent) {
        setOps[`milestonesNotified.${m.key}.sent`] = true;
        setOps[`milestonesNotified.${m.key}.at`] = new Date();
        setOps[`milestonesNotified.${m.key}.count`] = currentCount;
        if (m.type === 'completed') setOps[`milestonesNotified.${m.key}.cap`] = m.threshold;
      }
      await ClientModel.updateOne({ email: emailLower }, { $set: setOps });
    }

    await recordMilestoneInMoveHistory(emailLower, highest.key, sendResult, client.paymentEmail, { currentCount, planCap, threshold: highest.threshold });
    for (const m of reachedUnsent) {
      if (m.key === highest.key) continue;
      await recordMilestoneInMoveHistory(emailLower, m.key, { skipped: true, reason: 'caught_up_via_admin_trigger' }, client.paymentEmail, { currentCount, planCap, threshold: m.threshold });
    }

    res.json({
      sent: !!sendResult?.success,
      skipped: !!sendResult?.skipped,
      milestone: highest.key,
      threshold: highest.threshold,
      currentCount,
      planCap,
      caughtUp: reachedUnsent.filter((m) => m.key !== highest.key).map((m) => m.key),
      error: sendResult?.error || sendResult?.reason || null
    });
  } catch (e) {
    console.error('[send-pending-milestones] error:', e?.message);
    res.status(500).json({ error: 'send failed' });
  }
});

// Admin: resend ONE specific milestone email — used by the "Send again" button
// on a failed email row in the client ticket. Force-sends the given milestone
// regardless of its current notified state, recomputing live counts so the
// email reflects current progress. Body: { milestoneKey } (preferred) or { type }.
app.post('/api/clients/:email/resend-milestone', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const emailLower = String(req.params.email || '').toLowerCase().trim();
    const milestoneKey = String(req.body?.milestoneKey || '').trim();
    const milestoneType = String(req.body?.type || '').trim();
    if (!emailLower) return res.status(400).json({ error: 'email required' });
    if (!milestoneKey && !milestoneType) return res.status(400).json({ error: 'milestoneKey or type required', code: 'no_milestone' });

    const client = await ClientModel.findOne({ email: emailLower }).lean();
    if (!client) return res.status(404).json({ error: 'client not found' });
    // Milestone emails fire regardless of status — Inactive and Paused clients
    // still receive them. Only a recipient address is required.
    if (!client.paymentEmail) return res.status(400).json({ error: 'paymentEmail not set', code: 'no_payment_email' });

    const referralUser = await NewUserModel.findOne({ email: emailLower }, 'referrals').lean();
    const referralAdded = referralApplicationsFor(referralUser?.referrals);
    const planCap = getEffectiveCap(client, referralAdded);
    const milestones = computeClientMilestones(client, referralAdded);
    const target = milestones.find((m) =>
      (milestoneKey && m.key === milestoneKey) || (!milestoneKey && m.type === milestoneType)
    );
    if (!target) return res.status(404).json({ error: 'milestone not found for client', code: 'no_milestone' });

    const currentCount = await JobModel.countDocuments(milestoneCountFilter(emailLower));
    const sendResult = await sendMilestoneEmail({
      client,
      type: target.type,
      milestoneKey: target.key,
      snapshot: { planCap, currentCount, threshold: target.threshold },
      trigger: 'manual'
    });

    if (sendResult?.success) {
      const setOps = {
        [`milestonesNotified.${target.key}.sent`]: true,
        [`milestonesNotified.${target.key}.at`]: new Date(),
        [`milestonesNotified.${target.key}.count`]: currentCount
      };
      if (target.type === 'completed') setOps[`milestonesNotified.${target.key}.cap`] = target.threshold;
      await ClientModel.updateOne({ email: emailLower }, { $set: setOps });
    }
    await recordMilestoneInMoveHistory(emailLower, target.key, sendResult, client.paymentEmail, { currentCount, planCap, threshold: target.threshold });

    res.json({
      sent: !!sendResult?.success,
      skipped: !!sendResult?.skipped,
      milestone: target.key,
      threshold: target.threshold,
      currentCount,
      planCap,
      error: sendResult?.error || sendResult?.reason || null
    });
  } catch (e) {
    console.error('[resend-milestone] error:', e?.message);
    res.status(500).json({ error: 'resend failed' });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// ⚠️ TEMPORARY TEST ENDPOINT — NO AUTH, NO MIDDLEWARE. REMOVE AFTER TESTING. ⚠️
// Fires a real milestone email to any address so SMTP/OAuth can be verified
// from Postman/browser. Does NOT touch the DB or any client record.
//
//   GET  /test?email=you@gmail.com
//   POST /test            body: { "email": "you@gmail.com" }
//
// Optional params (query or body): type (started|count_milestone|completed,
// default completed), count (default 1000), planType (default executive),
// name (default "Test User").
// ─────────────────────────────────────────────────────────────────────────
const handleTestMilestoneEmail = async (req, res) => {
  try {
    const email = String(req.query.email || req.body?.email || '').trim();
    if (!email) return res.status(400).json({ error: 'email required (?email= or body.email)' });

    const type = String(req.query.type || req.body?.type || 'completed').trim();
    const count = Number(req.query.count || req.body?.count || 1000);
    const planType = String(req.query.planType || req.body?.planType || 'executive').trim();
    const name = String(req.query.name || req.body?.name || 'Test User').trim();

    // Synthetic client — never persisted.
    const client = { email, name, planType, paymentEmail: email };
    const result = await sendMilestoneEmail({
      client,
      type,
      milestoneKey: `test_${type}_${count}`,
      snapshot: { planCap: count, currentCount: count, threshold: count },
      trigger: 'manual'
    });

    res.json({ ok: !!result?.success, to: email, type, count, planType, result });
  } catch (e) {
    console.error('[test-email] error:', e?.message);
    res.status(500).json({ error: e?.message || 'test send failed' });
  }
};
app.get('/test', handleTestMilestoneEmail);
app.post('/test', handleTestMilestoneEmail);

app.post('/api/clients/email-export/send-previous', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const result = await runSendPreviousMilestones();
    res.json(result);
  } catch (e) {
    console.error('[send-previous] error:', e?.message);
    res.status(500).json({ error: 'send-previous failed' });
  }
});

// Admin: trigger full milestone sweep on demand (same code path as the
// hourly cron). Returns per-client / per-milestone decision details so
// operators can diagnose why automation did or did not fire.
app.post('/api/admin/run-milestone-cron', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const verbose = req.query.verbose === '1' || req.body?.verbose === true;
    const result = await runClientMilestoneCron({ trigger: 'admin-trigger', verbose });
    res.json(result);
  } catch (e) {
    console.error('[run-milestone-cron] error:', e?.message);
    res.status(500).json({ error: 'sweep failed' });
  }
});

// Secret-protected external trigger for the milestone sweep. Lets an EXTERNAL
// scheduler (Render Cron Job, cron-job.org, UptimeRobot, GitHub Action) fire
// the sweep on a fixed schedule even when the web instance was idle/spun down —
// the inbound request itself wakes the instance, then the sweep runs. This is
// the reliable path on hosts that suspend idle web services; the in-process
// node-cron only ticks while the instance happens to be awake.
//
// Auth: OPTIONAL shared secret. If MILESTONE_CRON_SECRET is set in env, it must
// be supplied via `x-cron-secret` header OR `?key=` query. If it is NOT set, the
// endpoint is open (no secret needed) — just hit the URL. No JWT needed.
// Accepts GET and POST so simple cron pingers work.
const MILESTONE_CRON_SECRET = process.env.MILESTONE_CRON_SECRET || '';
const handleExternalMilestoneTrigger = async (req, res) => {
  try {
    if (MILESTONE_CRON_SECRET) {
      const provided = req.get('x-cron-secret') || req.query.key || '';
      if (provided !== MILESTONE_CRON_SECRET) {
        return res.status(401).json({ error: 'unauthorized' });
      }
    }
    const verbose = req.query.verbose === '1';
    const result = await runClientMilestoneCron({ trigger: 'external-cron', verbose });
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('[external-cron] error:', e?.message);
    res.status(500).json({ error: 'sweep failed' });
  }
};
app.get('/api/internal/run-milestone-cron', handleExternalMilestoneTrigger);
app.post('/api/internal/run-milestone-cron', handleExternalMilestoneTrigger);

app.post('/api/clients/payment-emails/bulk', verifyToken, async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (rows.length === 0) return res.status(400).json({ error: 'rows required' });
    if (rows.length > 5000) return res.status(400).json({ error: 'too many rows (max 5000)' });

    const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const movedBy = { email: req.user?.email || 'unknown', name: req.user?.name || '' };
    const nowStr = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });

    let updated = 0;
    let unchanged = 0;
    let notFound = 0;
    let failed = 0;
    const notFoundEmails = [];
    const failedEmails = [];

    for (const r of rows) {
      const assignedEmail = String(r?.assignedEmail || '').toLowerCase().trim();
      const paymentEmail = String(r?.paymentEmail || '').toLowerCase().trim();
      if (!assignedEmail || !emailRx.test(assignedEmail)) { failed++; failedEmails.push(assignedEmail || '(blank)'); continue; }
      if (paymentEmail && !emailRx.test(paymentEmail)) { failed++; failedEmails.push(assignedEmail); continue; }
      try {
        const existing = await ClientModel.findOne({ email: assignedEmail }).select('paymentEmail').lean();
        if (!existing) { notFound++; notFoundEmails.push(assignedEmail); continue; }
        const prev = (existing.paymentEmail || '').trim();
        if (prev === paymentEmail) { unchanged++; continue; }
        await ClientModel.updateOne(
          { email: assignedEmail },
          { $set: { paymentEmail, updatedAt: nowStr } }
        );
        let actionType = null;
        if (!prev && paymentEmail) actionType = 'payment_email_set';
        else if (prev && !paymentEmail) actionType = 'payment_email_cleared';
        else if (prev && paymentEmail && prev !== paymentEmail) actionType = 'payment_email_updated';
        if (actionType) {
          try {
            await addClientActionToJobMoveHistory(assignedEmail, actionType, {
              ...movedBy,
              meta: { from: prev || null, to: paymentEmail || null, source: 'bulk_import' }
            });
          } catch (e) {
            console.error('[bulk payment-email] move history append failed:', e?.message);
          }
        }
        updated++;
      } catch (e) {
        console.error(`[bulk payment-email] ${assignedEmail} error:`, e?.message);
        failed++;
        failedEmails.push(assignedEmail);
      }
    }

    res.json({
      total: rows.length,
      updated,
      unchanged,
      notFound,
      failed,
      notFoundEmails,
      failedEmails
    });
  } catch (e) {
    console.error('[bulk payment-email] error:', e?.message);
    res.status(500).json({ error: 'bulk import failed' });
  }
});
app.put('/api/clients/:email/payment-email', verifyToken, async (req, res) => {
  try {
    const emailLower = String(req.params.email || '').toLowerCase().trim();
    const paymentEmail = String(req.body?.paymentEmail || '').toLowerCase().trim();
    if (!emailLower) return res.status(400).json({ error: 'email required' });
    if (paymentEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(paymentEmail)) {
      return res.status(400).json({ error: 'invalid paymentEmail' });
    }
    const existing = await ClientModel.findOne({ email: emailLower }).select('paymentEmail').lean();
    if (!existing) return res.status(404).json({ error: 'client not found' });
    const prev = (existing.paymentEmail || '').trim();
    const updated = await ClientModel.findOneAndUpdate(
      { email: emailLower },
      { $set: { paymentEmail, updatedAt: new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }) } },
      { new: true }
    ).lean();
    try {
      const movedBy = { email: req.user?.email || 'unknown', name: req.user?.name || '' };
      let actionType = null;
      if (!prev && paymentEmail) actionType = 'payment_email_set';
      else if (prev && !paymentEmail) actionType = 'payment_email_cleared';
      else if (prev && paymentEmail && prev !== paymentEmail) actionType = 'payment_email_updated';
      if (actionType) {
        await addClientActionToJobMoveHistory(emailLower, actionType, {
          ...movedBy,
          meta: { from: prev || null, to: paymentEmail || null }
        });
      }
    } catch (e) {
      console.error('[payment-email] move history append failed:', e?.message);
    }
    res.json({ success: true, paymentEmail: updated.paymentEmail });
  } catch (e) {
    console.error('[payment-email] error:', e?.message);
    res.status(500).json({ error: 'failed to update paymentEmail' });
  }
});
app.get('/api/clients/:email/email-logs', verifyToken, async (req, res) => {
  try {
    const emailLower = String(req.params.email || '').toLowerCase().trim();
    if (!emailLower) return res.status(400).json({ error: 'email required' });
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const skip = Math.max(Number(req.query.skip) || 0, 0);
    const [logs, total, client] = await Promise.all([
      ClientEmailLogModel.find({ clientEmail: emailLower }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      ClientEmailLogModel.countDocuments({ clientEmail: emailLower }),
      ClientModel.findOne({ email: emailLower }).select('paymentEmail planType status milestonesNotified addons').lean()
    ]);
    const planType = client?.planType || '';
    // Effective cap = base + addons + referral bonus, matching the cron so
    // the ticket timeline shows the SAME thresholds milestone emails fire at.
    const referralUser = await NewUserModel.findOne({ email: emailLower }, 'referrals').lean();
    const referralAdded = referralApplicationsFor(referralUser?.referrals);
    const planCap = getEffectiveCap(client || {}, referralAdded);
    const milestones = computeClientMilestones(client || {}, referralAdded).map((m) => ({
      key: m.key,
      type: m.type,
      threshold: m.threshold,
      sent: !!client?.milestonesNotified?.[m.key]?.sent,
      at: client?.milestonesNotified?.[m.key]?.at || null,
      count: client?.milestonesNotified?.[m.key]?.count || 0
    }));
    // Why the schedule is empty, when it is. The UI used to hide the whole
    // Milestone Timeline on an empty array, so "this client has no tracking
    // record" and "milestones are broken" looked identical: a blank panel with
    // nothing to act on. Naming the cause is the difference between an operator
    // fixing it in one click and filing a ticket.
    const milestoneBlockReason = milestones.length
      ? null
      : !client
        ? 'no_tracking_record'
        : !planType
          ? 'no_plan_set'
          : 'unknown_plan';

    // The milestone cron only ever looks at active clients that have a
    // paymentEmail (see runSendPreviousMilestones), so a schedule can be
    // perfectly valid and still never fire. Surface both so the panel can say
    // so instead of showing rows that will sit on "Pending" forever.
    const clientStatus = client?.status || '';
    const milestoneDeliveryBlockers = [];
    if (client && clientStatus !== 'active') milestoneDeliveryBlockers.push('client_not_active');
    if (client && !(client.paymentEmail || '').trim()) milestoneDeliveryBlockers.push('no_payment_email');

    res.json({
      total,
      logs,
      paymentEmail: client?.paymentEmail || '',
      planType,
      planCap,
      baseCap: getPlanCap(planType),
      addonApplications: planCap - getPlanCap(planType) - referralAdded,
      referralApplications: referralAdded,
      milestoneSchedule: milestones,
      trackingRecordFound: !!client,
      clientStatus,
      milestoneBlockReason,
      milestoneDeliveryBlockers
    });
  } catch (e) {
    console.error('[email-logs] error:', e?.message);
    res.status(500).json({ error: 'failed to load email logs' });
  }
});
// ── JobRight sync ──
//
// Marks every client on data/jobrightClients.js as having a JobRight account.
// Additive by design: a client absent from the list is left untouched and keeps
// whatever it already had, so re-running with a shortened list can never wipe a
// flag. Clients nobody has ever synced keep the schema default of false, which
// is what paints the red J in Client Job Analysis.
//
// A plain GET with no auth, meant to be run once by opening it in a browser:
//   https://<host>/scripts/jobrightsync
// It is safe to hit more than once: the write is idempotent (it only ever sets
// the flag to true, and skips clients already marked), so a repeat run reports
// newlyMarked: 0 and changes nothing.
app.get('/scripts/jobrightsync', async (req, res) => {
  try {
    const listed = JOBRIGHT_CLIENT_EMAILS;

    // Read before writing so the response can distinguish "this run changed it"
    // from "it was already true", and can name the addresses that match no
    // client at all. A bare updated-count cannot tell those apart, and the
    // not-found list is the useful half: it is the typos and the clients who
    // were never onboarded here.
    const existing = await ClientModel.find({ email: { $in: listed } })
      .select('email jobrightCreated')
      .lean();

    const foundByEmail = new Map(existing.map((c) => [(c.email || '').toLowerCase(), c]));
    const notFound = listed.filter((e) => !foundByEmail.has(e));
    const alreadyMarked = existing.filter((c) => c.jobrightCreated === true).map((c) => c.email);
    const toMark = existing.filter((c) => c.jobrightCreated !== true).map((c) => c.email);

    let modified = 0;
    if (toMark.length) {
      const result = await ClientModel.updateMany(
        { email: { $in: toMark } },
        { $set: { jobrightCreated: true, jobrightCreatedAt: new Date() } }
      );
      modified = result?.modifiedCount ?? 0;
    }

    // Client Job Analysis serves this flag out of a cache that is keyed on the
    // IST day, the add window and the payload version. None of those three move
    // when a sync runs, so without an explicit clear the table would keep
    // painting the old J colours until a day boundary rolled the stamps over.
    if (modified > 0) {
      clearAnalysisCache();
      pClearAnalysisCache().catch(() => {});
    }

    console.log(`[jobrightsync] listed=${listed.length} matched=${existing.length} newlyMarked=${modified} notFound=${notFound.length}`);

    res.json({
      ok: true,
      listed: listed.length,
      matched: existing.length,
      newlyMarked: modified,
      alreadyMarked: alreadyMarked.length,
      notFound: notFound.length,
      notFoundEmails: notFound,
      alreadyMarkedEmails: alreadyMarked,
      cacheCleared: modified > 0
    });
  } catch (e) {
    console.error('[jobrightsync] error:', e?.message);
    res.status(500).json({ ok: false, error: 'jobright sync failed' });
  }
});

// Run the auto-unpause sweep on demand. Same shape as /scripts/jobrightsync:
// a plain GET you can open in a browser. Safe to hit repeatedly — a client
// already unpaused is simply not a candidate, so a repeat run reports 0.
// Also gives the external scheduler a reliable path on hosts that suspend idle
// services, where in-process node-cron stops ticking.
app.get('/scripts/autounpause', async (req, res) => {
  try {
    const summary = await runAutoUnpauseSweep({ trigger: 'manual' });
    // The sweep flips isPaused/onboardingPhase on clients, which the analysis
    // rows and the "paused" alert read.
    clearAnalysisCache();
    pClearAnalysisCache().catch(() => {});
    res.json({ ok: true, threshold: AUTO_UNPAUSE_MIN_JOB_CARDS, ...summary });
  } catch (e) {
    console.error('[auto-unpause] manual run failed:', e?.message || e);
    res.status(500).json({ ok: false, error: 'auto-unpause sweep failed' });
  }
});
app.get('/api/managers/names', getDashboardManagerNames);

// ── Team chat (widget) ──
app.post('/api/upload/chat-attachment', verifyToken, fileUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    const result = await uploadFile(req.file.buffer, {
      folder: 'chat-assets',
      filename: req.file.originalname,
      contentType: req.file.mimetype,
      fileType: null,
    });
    if (!result.success) return res.status(500).json({ success: false, message: result.error || 'Upload failed' });
    res.status(200).json({ success: true, url: result.url, filename: req.file.originalname, contentType: req.file.mimetype });
  } catch (e) {
    console.error('Chat attachment upload error:', e);
    res.status(500).json({ success: false, message: e.message || 'Failed to upload' });
  }
});
app.get('/api/chat/stream', chatStream); // token via ?token= (EventSource cannot set headers)
app.get('/api/chat/users', verifyToken, listChatUsers);
app.get('/api/chat/conversations', verifyToken, listConversations);
app.post('/api/chat/conversations', verifyToken, openConversation);
app.get('/api/chat/conversations/:id/messages', verifyToken, getChatMessages);
app.post('/api/chat/conversations/:id/messages', verifyToken, postChatMessage);
app.post('/api/chat/conversations/:id/read', verifyToken, markConversationRead);
app.get('/api/chat/presence', verifyToken, getPresence);
app.post('/api/chat/conversations/:id/typing', verifyToken, typingPing);

app.get('/api/onboarding/jobs', verifyToken, listOnboardingJobs);
app.get('/api/onboarding/jobs/roles', verifyToken, getOnboardingRoles);
app.get('/api/onboarding/issues/non-resolved', verifyToken, getNonResolvedIssues);
app.get('/api/onboarding/next-resume-maker', verifyToken, getNextResumeMakerApi);
app.get('/api/onboarding/notifications', verifyToken, getOnboardingNotifications);
app.patch('/api/onboarding/notifications/:id/read', verifyToken, markOnboardingNotificationRead);
app.post('/api/onboarding/jobs', verifyToken, postOnboardingJob);
app.get('/api/onboarding/jobs/:id', verifyToken, getOnboardingJobById);
app.get('/api/onboarding/jobs/:id/comments', verifyToken, getOnboardingJobComments);
app.patch('/api/onboarding/jobs/:id/comments/:commentId/resolve', verifyToken, resolveOnboardingComment);
app.post('/api/onboarding/jobs/:id/comments/:commentId/replies', verifyToken, addCommentReply);
app.patch('/api/onboarding/jobs/:id/comments/:commentId/reopen', verifyToken, reopenComment);
app.patch('/api/onboarding/jobs/:id', verifyToken, patchOnboardingJob);
app.post('/api/onboarding/jobs/:id/attachments', verifyToken, postOnboardingJobAttachment);
app.patch('/api/onboarding/jobs/:id/attachments/:index', verifyToken, patchOnboardingJobAttachment);
app.post('/api/onboarding/jobs/:id/admin-read', verifyToken, markAdminRead);
app.post('/api/onboarding/jobs/:id/request-move', verifyToken, requestMove);
app.post('/api/onboarding/jobs/:id/approve-move', verifyToken, approveMove);
app.post('/api/onboarding/jobs/:id/reject-move', verifyToken, rejectMove);

// Repair: create the missing dashboardtrackings record for an onboarding
// ticket. Milestone emails and the Milestone Timeline both read ClientModel,
// while the ticket carries its own free-text planType — so a ticket can say
// "Ignite Plan" in its header while the collection the milestones are computed
// from has no document at all. When that happens the client is invisible to the
// milestone cron (it only scans ClientModel) and no email ever fires. This turns
// the repair into one click instead of a hand-edit in Mongo.
//
// Idempotent: if the tracking record already exists it is left completely alone
// and reported back as `created: false`.
app.post('/api/onboarding/jobs/:id/create-tracking-record', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const job = await OnboardingJobModel.findById(req.params.id).lean();
    if (!job) return res.status(404).json({ error: 'onboarding job not found' });

    const emailLower = String(job.clientEmail || '').toLowerCase().trim();
    if (!emailLower) return res.status(400).json({ error: 'ticket has no clientEmail' });

    const existing = await ClientModel.findOne({ email: emailLower })
      .select('email planType planPrice status paymentEmail').lean();
    if (existing) {
      return res.json({
        created: false,
        reason: 'already_exists',
        email: existing.email,
        planType: existing.planType || '',
        status: existing.status || '',
        paymentEmail: existing.paymentEmail || ''
      });
    }

    // Never guess the plan. The ticket's planType is free text with a
    // 'Professional' schema default, so an unrecognised value here means the
    // ticket itself is wrong and an operator has to say what the client bought.
    const planSource = req.body?.planType || job.planType;
    const planFields = planWriteFields(planSource);
    if (!planFields) {
      return res.status(400).json({
        error: `unrecognised plan "${planSource || ''}" — pass planType explicitly`,
        code: 'bad_plan',
        validPlans: Object.keys(PLAN_PRICES)
      });
    }

    const paymentEmail = String(req.body?.paymentEmail || '').toLowerCase().trim();
    if (paymentEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(paymentEmail)) {
      return res.status(400).json({ error: 'invalid paymentEmail', code: 'bad_payment_email' });
    }

    const name = String(job.clientName || '').trim();
    if (!name) return res.status(400).json({ error: 'ticket has no clientName' });

    // Reuse the ticket's client number when it has one so the two records agree;
    // otherwise take the next from the shared counter.
    const CLIENT_NUMBER_FLOOR = 5809;
    let clientNumber = parseInt(String(job.clientNumber ?? '').trim(), 10);
    if (Number.isNaN(clientNumber) || clientNumber < CLIENT_NUMBER_FLOOR) {
      clientNumber = await getNextClientNumber();
    } else {
      await ClientCounterModel.findOneAndUpdate(
        { _id: 'client_number' },
        { $max: { lastNumber: clientNumber } },
        { upsert: true }
      );
    }

    const nowIST = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
    let created;
    try {
      created = await ClientModel.create({
        email: emailLower,
        name,
        clientNumber,
        planType: planFields.planType,
        planPrice: planFields.planPrice,
        status: 'active',
        paymentEmail,
        dashboardInternName: job.operatorName || ' ',
        dashboardTeamLeadName: job.dashboardManagerName || ' ',
        onboardingDate: nowIST,
        updatedAt: nowIST
      });
    } catch (err) {
      // Concurrent repair from two operators: the unique index on email wins,
      // and the outcome the caller wanted is already true.
      if (err?.code === 11000) return res.json({ created: false, reason: 'already_exists', email: emailLower });
      throw err;
    }

    // users.planType is the value the daily application cap is enforced from,
    // while dashboardtrackings.planType drives the badge and the milestones.
    // Writing one without the other is the drift planWriteFields exists to stop.
    await NewUserModel.updateOne({ email: emailLower }, { $set: { planType: planFields.planLabel } });

    try {
      await addClientActionToJobMoveHistory(emailLower, 'tracking_record_created', {
        email: req.user?.email || 'unknown',
        name: req.user?.name || '',
        meta: { planType: planFields.planType, planPrice: planFields.planPrice, clientNumber, paymentEmail: paymentEmail || null }
      });
    } catch (e) {
      console.error('[create-tracking-record] move history append failed:', e?.message);
    }

    const milestones = computeClientMilestones(created.toObject(), 0).map((m) => ({
      key: m.key, type: m.type, threshold: m.threshold, sent: false, at: null, count: 0
    }));

    res.json({
      created: true,
      email: emailLower,
      name,
      clientNumber,
      planType: planFields.planType,
      planPrice: planFields.planPrice,
      paymentEmail,
      planCap: getPlanCap(planFields.planType),
      milestoneSchedule: milestones
    });
  } catch (e) {
    console.error('[create-tracking-record] error:', e?.message);
    res.status(500).json({ error: 'failed to create tracking record' });
  }
});

// Onboarding attachment upload (R2 or Cloudinary) - R2: onboarding-assets/images|pdf|others
app.post('/api/upload/onboarding-attachment', verifyToken, fileUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    const result = await uploadFile(req.file.buffer, {
      folder: 'onboarding-assets',
      filename: req.file.originalname,
      contentType: req.file.mimetype,
      fileType: null,
    });
    if (!result.success) return res.status(500).json({ success: false, message: result.error || 'Upload failed' });
    res.status(200).json({ success: true, url: result.url, filename: req.file.originalname });
  } catch (e) {
    console.error('Onboarding attachment upload error:', e);
    res.status(500).json({ success: false, message: e.message || 'Failed to upload' });
  }
});

// Robust date parser: handles ISO, locale strings (e.g. "3/11/2026, 10:30:00 AM"), epoch ms, etc.
function parseFlexibleDate(val) {
  if (!val) return null;
  if (val instanceof Date) return Number.isNaN(val.getTime()) ? null : val;
  if (typeof val === 'number') { const d = new Date(val); return Number.isNaN(d.getTime()) ? null : d; }
  const s = String(val).trim();
  if (!s || s === ' ') return null;
  // Try native parse first (handles ISO & common formats)
  let d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d;
  // Try DD/MM/YYYY or DD-MM-YYYY (Indian format)
  const ddmm = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (ddmm) { d = new Date(`${ddmm[3]}-${ddmm[2].padStart(2,'0')}-${ddmm[1].padStart(2,'0')}`); if (!Number.isNaN(d.getTime())) return d; }
  return null;
}

// Check if profile has all required fields (matches flashfire ProfileContext isProfileComplete)
function isProfileComplete(profile) {
  if (!profile || typeof profile !== 'object') return false;
  const required = [
    'firstName', 'lastName', 'contactNumber', 'dob',
    'bachelorsUniDegree', 'bachelorsGradMonthYear',
    'visaStatus', 'address',
    'preferredRoles', 'experienceLevel', 'expectedSalaryRange',
    'preferredLocations', 'targetCompanies',
    'linkedinUrl', 'resumeUrl'
  ];
  const ok = required.every((f) => {
    const v = profile[f];
    if (Array.isArray(v)) return v.length > 0;
    return v != null && String(v).trim() !== '';
  });
  return ok && !!profile.confirmAccuracy && !!profile.agreeTos;
}

// Escape special regex chars so email is safe for case-insensitive match
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Fetch client profile from same DB as flashfire dashboard (ProfileModel = "profiles" collection)
// Always returns 200 with { userProfile, profileComplete, message? }
// Email lookup is case-insensitive so we find profile regardless of how email was stored
app.get('/api/onboarding/client-profile/:email', verifyToken, async (req, res) => {
  const send = (userProfile, profileComplete, message) => {
    const payload = { userProfile: userProfile ?? null, profileComplete: !!profileComplete, message: message || undefined };
    return res.status(200).json(payload);
  };

  try {
    const { email } = req.params;
    if (!email) return res.status(400).json({ error: 'Email is required', userProfile: null, profileComplete: false });
    const emailLower = email.toLowerCase().trim();
    if (process.env.NODE_ENV !== 'production') {
      console.log('[client-profile] Lookup:', { raw: email, normalized: emailLower });
    }

    const cached = getCachedProfile(emailLower);
    if (cached) {
      return res.status(200).json(cached);
    }

    const Profile = getProfileModel();
    // Try exact match first, then case-insensitive (profiles may be stored with original email casing)
    let profile = await Profile.findOne({ email: emailLower }).lean().catch(() => null);
    if (!profile) {
      const re = new RegExp(`^${escapeRegex(email.trim())}$`, 'i');
      profile = await Profile.findOne({ email: re }).lean().catch(() => null);
    }
    if (!profile) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[client-profile] No profile in DB for email:', emailLower, '(tried exact + case-insensitive). Ensure MONGODB_URI points to the same DB as the flashfire dashboard (profiles collection).');
      }
      const payload = { userProfile: null, profileComplete: false, message: 'Profile not found' };
      setCachedProfile(emailLower, payload);
      await OnboardingJobModel.updateMany(
        { clientEmail: emailLower },
        { $set: { profileComplete: false } }
      ).catch(() => {});
      return send(null, false, 'Profile not found');
    }

    const complete = isProfileComplete(profile);

    // Build the update — always sync profileComplete
    const updateFields = { profileComplete: complete };

    if (complete) {
      // Only set dashboardDetailsCompletedAt if it isn't already set on the job(s)
      // This preserves the original date and avoids resetting to "now" on every call
      const existingJob = await OnboardingJobModel.findOne(
        { clientEmail: emailLower, dashboardDetailsCompletedAt: { $ne: null } }
      ).select('dashboardDetailsCompletedAt').lean().catch(() => null);

      if (!existingJob?.dashboardDetailsCompletedAt) {
        // First time marking complete — use profile's createdAt (when client filled the dashboard)
        let completedAt = profile.createdAt || profile.updatedAt || new Date();
        // If portfolioMadeDate exists and is valid, prefer that
        const client = await ClientModel.findOne({ email: emailLower }).select('portfolioMade portfolioMadeDate').lean().catch(() => null);
        const pd = client?.portfolioMadeDate;
        if (client?.portfolioMade === true && pd && String(pd).trim() && String(pd).trim() !== ' ') {
          const d = new Date(pd);
          if (!Number.isNaN(d.getTime())) completedAt = d;
        }
        updateFields.dashboardDetailsCompletedAt = completedAt;
      }
      // else: already has a date, don't overwrite
    }

    await OnboardingJobModel.updateMany(
      { clientEmail: emailLower },
      { $set: updateFields }
    ).catch(() => {});
    invalidateJobListCache();

    const payload = { userProfile: profile, profileComplete: complete };
    setCachedProfile(emailLower, payload);
    if (process.env.NODE_ENV !== 'production') {
      console.log('[client-profile] Found profile for:', emailLower);
    }
    return res.status(200).json(payload);
  } catch (e) {
    console.error('getClientProfile:', e);
    return send(null, false, e.message || 'Failed to fetch client profile');
  }
});

// Batch check profileComplete for multiple emails at once (used on mount to sync card badges)
app.post('/api/onboarding/batch-profile-status', verifyToken, async (req, res) => {
  try {
    const { emails } = req.body || {};
    if (!Array.isArray(emails) || emails.length === 0) return res.status(200).json({ results: {} });
    const uniqueEmails = [...new Set(emails.map(e => (e || '').toLowerCase().trim()).filter(Boolean))].slice(0, 100);
    const Profile = getProfileModel();
    const profileSelect = 'email firstName lastName contactNumber dob bachelorsUniDegree bachelorsGradMonthYear visaStatus address preferredRoles experienceLevel expectedSalaryRange preferredLocations targetCompanies linkedinUrl resumeUrl confirmAccuracy agreeTos createdAt updatedAt';
    const profiles = await Profile.find({ email: { $in: uniqueEmails } }).select(profileSelect).lean();
    const profileMap = new Map(profiles.map(p => [(p.email || '').toLowerCase(), p]));
    // Case-insensitive fallback (profiles collection may store mixed-case emails)
    for (const email of uniqueEmails) {
      if (profileMap.has(email)) continue;
      const re = new RegExp(`^${escapeRegex(email)}$`, 'i');
      const p = await Profile.findOne({ email: re }).select(profileSelect).lean().catch(() => null);
      if (p) profileMap.set(email, p);
    }
    const results = {};
    const bulkUpdates = [];

    // Find jobs that already have dashboardDetailsCompletedAt set (to avoid overwriting)
    const jobsWithDate = await OnboardingJobModel.find(
      { clientEmail: { $in: uniqueEmails }, dashboardDetailsCompletedAt: { $ne: null } }
    ).select('clientEmail').lean().catch(() => []);
    const emailsWithDate = new Set((jobsWithDate || []).map(j => j.clientEmail));

    for (const email of uniqueEmails) {
      const profile = profileMap.get(email);
      const complete = profile ? isProfileComplete(profile) : false;
      results[email] = complete;

      const updateSet = { profileComplete: complete };
      // Set dashboardDetailsCompletedAt only if complete AND not already set
      if (complete && !emailsWithDate.has(email)) {
        updateSet.dashboardDetailsCompletedAt = profile.createdAt || profile.updatedAt || new Date();
      }

      bulkUpdates.push({
        updateMany: {
          filter: { clientEmail: email, profileComplete: { $ne: complete } },
          update: { $set: updateSet }
        }
      });
    }
    // Batch update job models in background (fire-and-forget)
    if (bulkUpdates.length > 0) {
      OnboardingJobModel.bulkWrite(bulkUpdates).then(() => invalidateJobListCache()).catch(() => {});
    }
    return res.status(200).json({ results });
  } catch (e) {
    console.error('batch-profile-status error:', e);
    return res.status(200).json({ results: {} });
  }
});

//get all the jobdatabase data..
const getJobsByClient = async (req, res) => {
  try {
    const { email } = req.params;
    const jobs = await JobModel.find({ userID: email }).select('-jobDescription').lean();
    res.status(200).json({ jobs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

app.get('/api/clients/:email/jobs', getJobsByClient);

// Manager routes
app.get('/api/managers', verifyToken, getAllManagers);
app.get('/api/managers/public', getAllManagers); // Public endpoint for dropdown
app.get('/api/managers/:id', verifyToken, getManagerById);
app.post('/api/managers', verifyToken, verifyAdmin, upload.single('profilePhoto'), createManager);
app.put('/api/managers/:id', verifyToken, verifyAdmin, upload.single('profilePhoto'), updateManager);
app.delete('/api/managers/:id', verifyToken, verifyAdmin, deleteManager);
app.post('/api/managers/:id/upload-photo', verifyToken, verifyAdmin, upload.single('profilePhoto'), uploadProfilePhoto);
// Resolve operation by email (try as-is then @flashfirehq if @flashfirehq.com)
const findOperationByEmail = async (email) => {
  const lower = (email || '').toLowerCase().trim();
  let operation = await OperationsModel.findOne({ email: lower }).lean();
  if (!operation && lower.endsWith('@flashfirehq.com')) {
    const alt = lower.replace('@flashfirehq.com', '@flashfirehq');
    operation = await OperationsModel.findOne({ email: alt }).lean();
  }
  return operation;
};

// Get managed users for an operation
const getManagedUsers = async (req, res) => {
  try {
    const { email } = req.params;
    const operation = await findOperationByEmail(email);

    if (!operation) {
      return res.status(404).json({ error: 'Operation not found' });
    }

    // Batch-fetch all users + fallback clients in parallel (eliminates N+1)
    const userIds = (operation.managedUsers || []).map(id => id.toString());
    const [users, fallbackClients] = await Promise.all([
      NewUserModel.find({ _id: { $in: userIds } }).select('name email company').lean(),
      ClientModel.find({ userID: { $in: userIds } }).select('name email userID companyName').lean()
    ]);

    const userMap = new Map(users.map(u => [u._id.toString(), u]));
    const clientMap = new Map(fallbackClients.map(c => [c.userID, c]));

    const managedUsers = userIds.map(userIdStr => {
      const user = userMap.get(userIdStr);
      if (user) {
        return { userID: userIdStr, name: user.name || 'Unknown', email: user.email || userIdStr, company: user.company || 'Unknown' };
      }
      const client = clientMap.get(userIdStr);
      if (client) {
        return { userID: userIdStr, name: client.name, email: client.email || userIdStr, company: client.companyName || 'Unknown' };
      }
      const displayName = userIdStr.includes('@') ? userIdStr.split('@')[0] : `User ${userIdStr.substring(0, 8)}`;
      return { userID: userIdStr, name: displayName, email: userIdStr.includes('@') ? userIdStr : 'Unknown', company: 'Unknown' };
    });

    res.status(200).json({ managedUsers });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Add user to managed users
const addManagedUser = async (req, res) => {
  try {
    const { email } = req.params;
    const { userID } = req.body;

    if (!userID) {
      return res.status(400).json({ error: 'userID is required' });
    }

    const op = await findOperationByEmail(email);
    if (!op) return res.status(404).json({ error: 'Operation not found' });
    const operation = await OperationsModel.findOne({ email: op.email });

    // Add userID to managedUsers array if not already present (handle ObjectId comparison)
    const isAlreadyManaged = operation.managedUsers.some(managedId => managedId.toString() === userID);
    if (!isAlreadyManaged) {
      operation.managedUsers.push(userID);
      await operation.save();
    }

    res.status(200).json({ message: 'User added to managed users', managedUsers: operation.managedUsers });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Remove user from managed users
const removeManagedUser = async (req, res) => {
  try {
    const { email, userID } = req.params;

    const op = await findOperationByEmail(email);
    if (!op) return res.status(404).json({ error: 'Operation not found' });
    const operation = await OperationsModel.findOne({ email: op.email });

    // Remove userID from managedUsers array (handle ObjectId comparison)
    operation.managedUsers = operation.managedUsers.filter(id => id.toString() !== userID);
    await operation.save();

    res.status(200).json({ message: 'User removed from managed users', managedUsers: operation.managedUsers });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Assign client to operator using email addresses
const assignClientToOperator = async (req, res) => {
  try {
    const { clientEmail, operatorEmail } = req.body;

    if (!clientEmail || !operatorEmail) {
      return res.status(400).json({ error: 'Both clientEmail and operatorEmail are required' });
    }

    // Find the client by email (case-insensitive; users collection may not be normalized)
    const rawClientEmail = String(clientEmail || '').trim();
    const clientEmailLower = rawClientEmail.toLowerCase();
    let client = await NewUserModel.findOne({ email: clientEmailLower }).lean();
    if (!client) {
      const re = new RegExp(`^${escapeRegex(rawClientEmail)}$`, 'i');
      client = await NewUserModel.findOne({ email: re }).lean();
    }
    if (!client) {
      return res.status(404).json({
        error: 'Client not found',
        message: 'No user account matches this email in the operations database. The client may need to sign up or use the same email as in the dashboard.'
      });
    }

    // Find the operator by email (support both @flashfirehq and @flashfirehq.com)
    const op = await findOperationByEmail(operatorEmail);
    if (!op) return res.status(404).json({ error: 'Operator not found' });
    const operator = await OperationsModel.findOne({ email: op.email });
    if (!operator) return res.status(404).json({ error: 'Operator not found' });

    // Check if client is already managed by this operator
    const isAlreadyManaged = operator.managedUsers.some(managedId => managedId.toString() === client._id.toString());
    if (isAlreadyManaged) {
      return res.status(400).json({ error: 'Client is already managed by this operator' });
    }

    // Add client's ObjectId to operator's managedUsers array
    operator.managedUsers.push(client._id);
    await operator.save();

    res.status(200).json({
      message: 'Client assigned to operator successfully',
      managedUsers: operator.managedUsers,
      client: {
        userID: client.userID,
        name: client.name,
        email: client.email
      }
    });
  } catch (error) {
    console.error('Error assigning client to operator:', error);
    res.status(500).json({ error: error.message });
  }
}

// Get available clients (not managed by this operation)
const getAvailableClients = async (req, res) => {
  try {
    const { email } = req.params;

    const operation = await findOperationByEmail(email);
    if (!operation) {
      return res.status(404).json({ error: 'Operation not found' });
    }

    // Get all clients from NewUserModel (users collection)
    const allClients = await NewUserModel.find({}, 'userID name email').lean();

    // Filter out clients that are already managed by this operation (handle ObjectId comparison)
    const availableClients = allClients.filter(client =>
      !operation.managedUsers.some(managedId => managedId.toString() === client._id.toString())
    );

    res.status(200).json({ availableClients });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Get client details from dashboardtrackings collection
const getClientDetails = async (req, res) => {
  try {
    const { email } = req.params;

    // Find client in dashboardtrackings collection
    const client = await ClientModel.findOne({ email: email.toLowerCase() }).lean();

    if (!client) {
      return res.status(404).json({ error: 'Client not found in dashboardtrackings' });
    }

    res.status(200).json({
      success: true,
      client: client
    });
  } catch (error) {
    console.error('Error fetching client details:', error);
    res.status(500).json({ error: error.message });
  }
};

// Get all users with referral status for referral management
const getAllUsersForReferralManagement = async (req, res) => {
  try {
    const users = await NewUserModel.find(
      {},
      'name email referralStatus referrals notes'
    ).lean();

    const mapReferralMeta = (user) => {
      const referralsArray = Array.isArray(user.referrals) ? user.referrals : [];
      const referralCount = referralsArray.length;

      let referralApplicationsAdded = 0;
      referralsArray.forEach((ref) => {
        if (ref?.plan === "Professional") {
          referralApplicationsAdded += 200;
        } else if (ref?.plan === "Executive") {
          referralApplicationsAdded += 300;
        }
      });

      // Backward compatibility: if no referrals recorded yet, fall back to single referralStatus
      if (referralCount === 0 && user.referralStatus) {
        if (user.referralStatus === "Professional") {
          referralApplicationsAdded = 200;
        } else if (user.referralStatus === "Executive") {
          referralApplicationsAdded = 300;
        }
      }

      return {
        _id: user._id,
        name: user.name || "Unknown",
        email: user.email,
        referralStatus: user.referralStatus || null,
        referrals: referralsArray,
        referralCount,
        referralApplicationsAdded,
        notes: user.notes || "",
      };
    };

    res.status(200).json({
      success: true,
      users: users.map(mapReferralMeta),
    });
  } catch (error) {
    console.error('Error fetching users for referral management:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Update user referral status
const updateUserReferralStatus = async (req, res) => {
  try {
    const { email } = req.params;
    const { referralStatus, notes } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }

    // Validate referralStatus
    if (referralStatus !== null && referralStatus !== undefined && referralStatus !== 'Professional' && referralStatus !== 'Executive') {
      return res.status(400).json({
        success: false,
        error: 'Invalid referral status. Must be "Professional", "Executive", or null'
      });
    }

    // Build update object
    const updateData = {};
    if (referralStatus !== undefined) {
      updateData.referralStatus = referralStatus || null;
    }
    if (notes !== undefined) {
      updateData.notes = notes || "";
    }

    const updatedUser = await NewUserModel.findOneAndUpdate(
      { email: email.toLowerCase() },
      { $set: updateData },
      { new: true, select: 'name email referralStatus referrals notes' }
    );

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'User data updated successfully',
      user: {
        _id: updatedUser._id,
        name: updatedUser.name,
        email: updatedUser.email,
        referralStatus: updatedUser.referralStatus,
        referrals: Array.isArray(updatedUser.referrals)
          ? updatedUser.referrals
          : [],
        notes: updatedUser.notes || "",
      },
    });
  } catch (error) {
    console.error('Error updating user data:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Sync manager assignments from users collection to dashboardtrackings
const syncManagerAssignments = async (req, res) => {
  try {
    // Get all users with dashboardManager assignments
    const usersWithManagers = await NewUserModel.find({
      dashboardManager: { $exists: true, $ne: null, $ne: "" }
    }).lean();

    let syncedCount = 0;
    let errors = [];

    for (const user of usersWithManagers) {
      try {
        // Update the corresponding client in dashboardtrackings
        const updateResult = await ClientModel.updateOne(
          { email: user.email.toLowerCase() },
          {
            $set: {
              dashboardTeamLeadName: user.dashboardManager,
              updatedAt: new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })
            }
          }
        );

        if (updateResult.matchedCount > 0) {
          syncedCount++;
          // Manager synced successfully
        } else {
          // No matching client found
        }
      } catch (error) {
        console.error(`❌ Error syncing ${user.email}:`, error.message);
        errors.push({ email: user.email, error: error.message });
      }
    }

    res.status(200).json({
      success: true,
      message: `Manager assignment sync completed`,
      syncedCount,
      totalUsers: usersWithManagers.length,
      errors: errors.length > 0 ? errors : null
    });

  } catch (error) {
    console.error('❌ Error in syncManagerAssignments:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

const getOperationsPerformanceReport = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const datePatterns = [];
    const currentDate = new Date(start);
    while (currentDate <= end) {
      const day = currentDate.getDate();
      const month = currentDate.getMonth() + 1;
      const year = currentDate.getFullYear();
      const dayPattern = day < 10 ? `[0]?${day}` : `${day}`;
      const monthPattern = month < 10 ? `[0]?${month}` : `${month}`;
      datePatterns.push(new RegExp(`^${dayPattern}/${monthPattern}/${year}(?=$|\\D)`));
      currentDate.setDate(currentDate.getDate() + 1);
    }

    let allOperations = await OperationsModel.find().select('email name').lean();

    if (['operations_intern', 'team_lead'].includes(req.user?.role)) {
      const teamLeadEmails = await getTeamLeadEmailSet();
      allOperations = allOperations.filter(op => !teamLeadEmails.has(normalizeEmail(op.email)));
    }

    const operatorEmails = allOperations.map(op => normalizeEmail(op.email));

    if (operatorEmails.length === 0) {
      return res.status(200).json({
        success: true,
        startDate,
        endDate,
        totalApplied: 0,
        operators: [],
        performanceMap: {}
      });
    }

    const pipeline = [
      {
        $match: {
          operatorEmail: { $in: operatorEmails },
          appliedDate: { $exists: true, $nin: [null, ''] },
          $or: datePatterns.map(pattern => ({ appliedDate: { $regex: pattern } }))
        }
      },
      {
        $addFields: {
          _statusLower: { $toLower: { $ifNull: ['$currentStatus', ''] } },
          _isCountedStatus: {
            $or: [
              { $regexMatch: { input: { $toLower: { $ifNull: ['$currentStatus', ''] } }, regex: 'applied' } },
              { $regexMatch: { input: { $toLower: { $ifNull: ['$currentStatus', ''] } }, regex: 'reject' } },
              { $regexMatch: { input: { $toLower: { $ifNull: ['$currentStatus', ''] } }, regex: 'interview' } },
              { $regexMatch: { input: { $toLower: { $ifNull: ['$currentStatus', ''] } }, regex: 'offer' } }
            ]
          },
          _isIncompleteColumn: {
            $or: [
              { $regexMatch: { input: { $toLower: { $ifNull: ['$currentStatus', ''] } }, regex: 'applied' } },
              { $regexMatch: { input: { $toLower: { $ifNull: ['$currentStatus', ''] } }, regex: 'reject' } },
              { $regexMatch: { input: { $toLower: { $ifNull: ['$currentStatus', ''] } }, regex: 'interview' } },
              { $regexMatch: { input: { $toLower: { $ifNull: ['$currentStatus', ''] } }, regex: 'offer' } }
            ]
          }
        }
      },
      {
        $group: {
          _id: '$operatorEmail',
          appliedCount: { $sum: { $cond: ['$_isCountedStatus', 1, 0] } },
          notDownloadedCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$downloaded', true] },
                    '$_isIncompleteColumn'
                  ]
                },
                1,
                0
              ]
            }
          },
          notDownloadedApplied: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$downloaded', true] },
                    { $regexMatch: { input: '$_statusLower', regex: 'applied' } }
                  ]
                },
                1,
                0
              ]
            }
          },
          notDownloadedRejected: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$downloaded', true] },
                    { $regexMatch: { input: '$_statusLower', regex: 'reject' } }
                  ]
                },
                1,
                0
              ]
            }
          },
          notDownloadedInterviewing: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$downloaded', true] },
                    { $regexMatch: { input: '$_statusLower', regex: 'interview' } }
                  ]
                },
                1,
                0
              ]
            }
          },
          notDownloadedOffer: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$downloaded', true] },
                    { $regexMatch: { input: '$_statusLower', regex: 'offer' } }
                  ]
                },
                1,
                0
              ]
            }
          }
        }
      },
      {
        $project: {
          _id: 0,
          operatorEmail: '$_id',
          appliedCount: 1,
          notDownloadedCount: 1,
          notDownloadedApplied: 1,
          notDownloadedRejected: 1,
          notDownloadedInterviewing: 1,
          notDownloadedOffer: 1
        }
      }
    ];

    const results = await JobModel.aggregate(pipeline).allowDiskUse(true);
    const performanceMap = {};
    const notDownloadedMap = {};
    const notDownloadedByStatusMap = {};
    results.forEach(r => {
      const emailKey = (r.operatorEmail || '').toLowerCase();
      performanceMap[emailKey] = r.appliedCount;
      notDownloadedMap[emailKey] = r.notDownloadedCount || 0;
      notDownloadedByStatusMap[emailKey] = {
        applied: r.notDownloadedApplied || 0,
        rejected: r.notDownloadedRejected || 0,
        interviewing: r.notDownloadedInterviewing || 0,
        offer: r.notDownloadedOffer || 0
      };
    });

    const performanceData = allOperations.map(op => {
      const emailLower = normalizeEmail(op.email);
      return {
        email: op.email,
        name: op.name || op.email.split('@')[0],
        appliedCount: performanceMap[emailLower] || 0,
        notDownloadedCount: notDownloadedMap[emailLower] || 0,
        notDownloadedByStatus: notDownloadedByStatusMap[emailLower] || { applied: 0, rejected: 0, interviewing: 0, offer: 0 }
      };
    }).sort((a, b) => b.appliedCount - a.appliedCount);

    const totalApplied = performanceData.reduce((sum, op) => sum + op.appliedCount, 0);

    res.status(200).json({
      success: true,
      startDate,
      endDate,
      totalApplied,
      operators: performanceData,
      performanceMap,
      notDownloadedMap,
      notDownloadedByStatusMap
    });
  } catch (error) {
    console.error('Error in getOperationsPerformanceReport:', error);
    res.status(500).json({ error: error.message });
  }
};

app.get('/api/operations/performance-report', optionalVerifyToken, getOperationsPerformanceReport);

/**
 * Shared stages: parse IST job timestamp and filter to inclusive [startDate,endDate] in IST.
 * Uses $regexFind + $dateFromParts (Atlas M0-compatible, no $function needed).
 * dateAdded format: "D/M/YYYY, h:mm:ss am/pm" (IST)
 */
const buildExtensionJobsParsedRangeStages = (bounds) => [
  {
    $match: {
      addedBy: { $exists: true, $nin: [null, ''], $type: 'string' },
    },
  },
  // Step 1: extract date components from dateAdded via regex
  {
    $addFields: {
      _dateRegex: {
        $regexFind: {
          input: { $ifNull: ['$dateAdded', ''] },
          regex: String.raw`^(\d{1,2})/(\d{1,2})/(\d{4}),\s*(\d{1,2}):(\d{2}):(\d{2})\s*(am|pm)`,
          options: 'i',
        },
      },
    },
  },
  // Step 2: build parsedAt Date from regex captures, with createdAt ISO fallback
  {
    $addFields: {
      parsedAt: {
        $cond: {
          if: { $ne: ['$_dateRegex', null] },
          then: {
            $let: {
              vars: {
                day: { $toInt: { $arrayElemAt: ['$_dateRegex.captures', 0] } },
                month: { $toInt: { $arrayElemAt: ['$_dateRegex.captures', 1] } },
                year: { $toInt: { $arrayElemAt: ['$_dateRegex.captures', 2] } },
                rawHour: { $toInt: { $arrayElemAt: ['$_dateRegex.captures', 3] } },
                minute: { $toInt: { $arrayElemAt: ['$_dateRegex.captures', 4] } },
                second: { $toInt: { $arrayElemAt: ['$_dateRegex.captures', 5] } },
                ampm: { $toLower: { $arrayElemAt: ['$_dateRegex.captures', 6] } },
              },
              in: {
                $dateFromParts: {
                  year: '$$year',
                  month: '$$month',
                  day: '$$day',
                  hour: {
                    $switch: {
                      branches: [
                        // 12 AM → 0
                        {
                          case: { $and: [{ $eq: ['$$ampm', 'am'] }, { $eq: ['$$rawHour', 12] }] },
                          then: 0,
                        },
                        // PM (not 12) → hour + 12
                        {
                          case: { $and: [{ $eq: ['$$ampm', 'pm'] }, { $ne: ['$$rawHour', 12] }] },
                          then: { $add: ['$$rawHour', 12] },
                        },
                      ],
                      // AM (not 12) or 12 PM → as-is
                      default: '$$rawHour',
                    },
                  },
                  minute: '$$minute',
                  second: '$$second',
                  timezone: 'Asia/Kolkata',
                },
              },
            },
          },
          // Fallback: try to parse createdAt as ISO string
          else: {
            $cond: {
              if: { $and: [{ $ne: ['$createdAt', null] }, { $ne: ['$createdAt', ''] }] },
              then: { $dateFromString: { dateString: '$createdAt', onError: null } },
              else: null,
            },
          },
        },
      },
    },
  },
  // Clean up temp field
  { $unset: '_dateRegex' },
  {
    $match: {
      parsedAt: { $ne: null, $gte: bounds.start, $lte: bounds.end },
    },
  },
];

/**
 * Build daily incentive rows per operator.
 * Day window = 24 hours, resetting at 10 PM IST (prev day 10 PM → this day 10 PM).
 * Every job in that window counts. Jobs from 10 PM–midnight roll into the next
 * day via the +2h offset in the aggregation.
 */
function buildIncentiveDailyRows(dailyMetrics, complaintSet, clientJobCounts) {
  const byAdderMap = new Map();
  for (const row of dailyMetrics || []) {
    const addedBy = row.addedBy;
    const dateYmd = row.dateYmd;
    const totalJobs = row.totalJobs || 0;
    const clientsHandled = row.uniqueClients || 0;
    const key = `${dateYmd}|${addedBy}`;
    const hasComplaint = complaintSet.has(key);

    const clientCounts = clientJobCounts?.get(key) || [];
    const qualifiedClients = countQualifiedClients(clientCounts);
    const metrics = getExtensionIncentiveMetrics(totalJobs, clientsHandled);

    const gateReasons = [];
    if (clientsHandled < 20) gateReasons.push('Handled fewer than 20 clients');
    if (metrics.avgJobsPerClient < 20) gateReasons.push('Average jobs per client is below 20');
    if (hasComplaint) gateReasons.push('Complaint recorded for this day');

    const eligible = metrics.eligible && !hasComplaint;
    const incentive = eligible ? metrics.incentiveAmount : 0;
    const day = {
      dateYmd,
      totalJobs,
      clientsHandled,
      avgJobsPerClient: metrics.avgJobsPerClient,
      qualifiedClients,
      clientBreakdown: clientCounts,
      hasComplaint,
      eligible,
      incentive,
      gateReasons,
    };
    if (!byAdderMap.has(addedBy)) {
      byAdderMap.set(addedBy, { addedBy, totalIncentive: 0, daily: [] });
    }
    const entry = byAdderMap.get(addedBy);
    entry.daily.push(day);
    entry.totalIncentive += incentive;
  }
  for (const v of byAdderMap.values()) {
    v.daily.sort((a, b) => a.dateYmd.localeCompare(b.dateYmd));
  }
  return Array.from(byAdderMap.values()).sort((a, b) => b.totalIncentive - a.totalIncentive);
}

async function syncExtensionDailyRecordsForDate(dateYmd) {
  if (!dateYmd) return;

  const prevDay = new Date(new Date(`${dateYmd}T00:00:00.000+05:30`).getTime() - 86400000);
  const prevYmd = prevDay.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  // 24-hour incentive day resets at 10 PM IST: prev day 10 PM → this day 10 PM.
  const dayStart = new Date(`${prevYmd}T22:00:00.000+05:30`);
  const dayEnd = new Date(`${dateYmd}T21:59:59.999+05:30`);
  const isPastTenPmIst = istHourNow() >= 22;

  const [results, complaints] = await Promise.all([
    JobModel.aggregate([
      ...buildExtensionJobsParsedRangeStages({ start: dayStart, end: dayEnd }),
      {
        $addFields: {
          _clientKey: {
            $cond: [
              { $or: [{ $eq: ['$userID', null] }, { $eq: ['$userID', ''] }] },
              null,
              { $toLower: { $trim: { input: { $toString: '$userID' } } } },
            ],
          },
        },
      },
      { $match: { addedBy: { $nin: [null, ''] }, _clientKey: { $nin: [null, ''] } } },
      {
        $group: {
          _id: { addedBy: '$addedBy', client: '$_clientKey' },
          jobCount: { $sum: 1 },
        },
      },
      {
        $group: {
          _id: '$_id.addedBy',
          clients: {
            $push: {
              clientEmail: '$_id.client',
              jobCount: '$jobCount',
              qualified: { $gte: ['$jobCount', 20] },
            },
          },
          totalJobs: { $sum: '$jobCount' },
        },
      },
    ]).allowDiskUse(true),
    ExtensionIncentiveComplaintModel.find({ dateYmd }).select('addedBy').lean(),
  ]);

  const complaintOperators = new Set(complaints.map((item) => item.addedBy));

  for (const row of results) {
    const addedBy = row._id;
    const qualifiedClients = countQualifiedClients(row.clients);
    const clientsHandled = row.clients.length;
    const metrics = getExtensionIncentiveMetrics(row.totalJobs, clientsHandled);
    const hasComplaint = complaintOperators.has(addedBy);
    const incentiveAmount = metrics.eligible && !hasComplaint ? metrics.incentiveAmount : 0;
    const existing = await ExtensionDailyIncentiveModel.findOne({ dateYmd, addedBy }).lean();

    let nextStatus = existing?.status || (isPastTenPmIst ? 'approved' : 'pending');
    if (existing?.status !== 'rejected' && isPastTenPmIst) nextStatus = 'approved';
    if (existing?.status !== 'approved' && existing?.status !== 'rejected' && !isPastTenPmIst) nextStatus = 'pending';

    await ExtensionDailyIncentiveModel.findOneAndUpdate(
      { dateYmd, addedBy },
      {
        $set: {
          qualifiedClients,
          clientsHandled,
          totalJobs: row.totalJobs,
          avgJobsPerClient: metrics.avgJobsPerClient,
          incentiveAmount,
          clientBreakdown: row.clients.map((client) => ({
            clientEmail: client.clientEmail,
            jobCount: client.jobCount,
            qualified: client.jobCount >= 20,
          })),
          computedAt: new Date(),
          status: nextStatus,
          ...(nextStatus !== 'rejected' ? { rejectedBy: '', rejectedAt: null, rejectionReason: '' } : {}),
        },
        $setOnInsert: {
          dateYmd,
          addedBy,
        },
      },
      { upsert: true, new: true }
    );
  }
}

const getExtensionJobsReport = async (req, res) => {
  try {
    const { startDate, endDate, addedBy, page = '1', limit = '10' } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }

    const bounds = istYmdRangeToUtcBounds(String(startDate), String(endDate));
    if (!bounds) {
      return res.status(400).json({ error: 'Invalid date range' });
    }

    const todayYmd = todayIstYmd();
    if (String(startDate) <= todayYmd && todayYmd <= String(endDate)) {
      await syncExtensionDailyRecordsForDate(todayYmd);
    }

    const addedByFilter = typeof addedBy === 'string' ? addedBy.trim() : '';
    const addedByMatchStage = addedByFilter ? [{ $match: { addedBy: addedByFilter } }] : [];
    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(String(limit), 10) || 10));

    const [complaints, facetResult] = await Promise.all([
      ExtensionIncentiveComplaintModel.find({
        dateYmd: { $gte: String(startDate), $lte: String(endDate) },
        ...(addedByFilter ? { addedBy: addedByFilter } : {}),
      })
        .select('dateYmd addedBy')
        .lean(),
      JobModel.aggregate([
        ...buildExtensionJobsParsedRangeStages(bounds),
        ...addedByMatchStage,
        {
          $facet: {
            byAdderAgg: [
              {
                $addFields: {
                  _clientKey: {
                    $cond: [
                      {
                        $or: [{ $eq: ['$userID', null] }, { $eq: ['$userID', ''] }],
                      },
                      null,
                      {
                        $toLower: {
                          $trim: { input: { $toString: '$userID' } },
                        },
                      },
                    ],
                  },
                },
              },
              {
                $group: {
                  _id: '$addedBy',
                  clientKeys: { $addToSet: '$_clientKey' },
                  count: { $sum: 1 },
                },
              },
              { $match: { _id: { $nin: [null, ''] } } },
              { $sort: { count: -1 } },
              {
                $project: {
                  _id: 0,
                  addedBy: '$_id',
                  count: 1,
                  uniqueClients: {
                    $size: {
                      $filter: {
                        input: '$clientKeys',
                        as: 'k',
                        cond: { $and: [{ $ne: ['$$k', null] }, { $ne: ['$$k', ''] }] },
                      },
                    },
                  },
                },
              },
            ],
            samples: [
              { $sort: { parsedAt: -1 } },
              { $limit: 50 },
              {
                $project: {
                  jobTitle: 1,
                  companyName: 1,
                  userID: 1,
                  dateAdded: 1,
                  createdAt: 1,
                  addedBy: 1,
                  extensionCode: 1,
                  jobID: 1,
                  currentStatus: 1,
                },
              },
            ],
            // Day window = 24 hours, resetting at 10 PM IST (10 PM → 10 PM next day).
            // Every job in the queried range counts for incentives.
            // +2h offset: 22:xx IST → 00:xx next day IST → correct day assignment.
            dailyMetrics: [
              {
                $addFields: {
                  dayKey: {
                    $dateToString: {
                      format: '%Y-%m-%d',
                      date: { $add: ['$parsedAt', 2 * 60 * 60 * 1000] },
                      timezone: 'Asia/Kolkata',
                    },
                  },
                },
              },
              {
                $group: {
                  _id: { addedBy: '$addedBy', day: '$dayKey' },
                  totalJobs: { $sum: 1 },
                  clientKeys: {
                    $addToSet: {
                      $toLower: {
                        $trim: { input: { $toString: '$userID' } },
                      },
                    },
                  },
                },
              },
              {
                $project: {
                  _id: 0,
                  addedBy: '$_id.addedBy',
                  dateYmd: '$_id.day',
                  totalJobs: 1,
                  uniqueClients: {
                    $size: {
                      $filter: {
                        input: '$clientKeys',
                        as: 'k',
                        cond: { $and: [{ $ne: ['$$k', null] }, { $ne: ['$$k', ''] }] },
                      },
                    },
                  },
                },
              },
            ],
            // Per-client job counts — same 24h window (10 PM reset) with +2h offset
            clientJobCounts: [
              {
                $addFields: {
                  dayKey: {
                    $dateToString: {
                      format: '%Y-%m-%d',
                      date: { $add: ['$parsedAt', 2 * 60 * 60 * 1000] },
                      timezone: 'Asia/Kolkata',
                    },
                  },
                  _clientKey: {
                    $cond: [
                      {
                        $or: [{ $eq: ['$userID', null] }, { $eq: ['$userID', ''] }],
                      },
                      null,
                      {
                        $toLower: {
                          $trim: { input: { $toString: '$userID' } },
                        },
                      },
                    ],
                  },
                },
              },
              {
                $match: {
                  _clientKey: { $nin: [null, ''] },
                },
              },
              {
                $group: {
                  _id: { addedBy: '$addedBy', day: '$dayKey', client: '$_clientKey' },
                  jobCount: { $sum: 1 },
                },
              },
              {
                $project: {
                  _id: 0,
                  addedBy: '$_id.addedBy',
                  dateYmd: '$_id.day',
                  clientEmail: '$_id.client',
                  jobCount: 1,
                },
              },
            ],
          },
        },
      ]).allowDiskUse(true),
    ]);

    const byAdder = facetResult[0]?.byAdderAgg || [];
    const samples = facetResult[0]?.samples || [];
    const dailyMetrics = facetResult[0]?.dailyMetrics || [];
    const clientJobCountsRaw = facetResult[0]?.clientJobCounts || [];
    const totalJobs = byAdder.reduce((acc, row) => acc + (row.count || 0), 0);

    // Build a Map: "dateYmd|addedBy" → [{clientEmail, jobCount, qualified}]
    const clientJobCounts = new Map();
    for (const row of clientJobCountsRaw) {
      const key = `${row.dateYmd}|${row.addedBy}`;
      if (!clientJobCounts.has(key)) clientJobCounts.set(key, []);
      clientJobCounts.get(key).push({
        clientEmail: row.clientEmail,
        jobCount: row.jobCount,
        qualified: row.jobCount >= 20,
      });
    }

    const complaintSet = new Set(
      (complaints || []).map((c) => `${c.dateYmd}|${c.addedBy}`)
    );
    const incentiveByAdder = buildIncentiveDailyRows(dailyMetrics, complaintSet, clientJobCounts);
    const incentiveTotals = new Map(incentiveByAdder.map((x) => [x.addedBy, x.totalIncentive]));
    const incentiveDailyByAdder = new Map(incentiveByAdder.map((x) => [x.addedBy, x.daily]));

    const byAdderEnriched = byAdder.map((row) => {
      const metrics = getExtensionIncentiveMetrics(row.count || 0, row.uniqueClients || 0);
      return {
        ...row,
        clientsHandled: row.uniqueClients || 0,
        avgJobsPerClient: metrics.avgJobsPerClient,
        eligibleByAverage: metrics.eligible,
        incentiveTotal: incentiveTotals.get(row.addedBy) ?? 0,
        incentiveDaily: incentiveDailyByAdder.get(row.addedBy) ?? [],
      };
    });

    const totalOperators = byAdderEnriched.length;
    const totalPages = totalOperators === 0 ? 0 : Math.ceil(totalOperators / limitNum);
    const safePage = totalPages === 0 ? 1 : Math.min(pageNum, totalPages);
    const pageStart = (safePage - 1) * limitNum;
    const pagedByAdder = byAdderEnriched.slice(pageStart, pageStart + limitNum);
    const pagedIncentiveByAdder = pagedByAdder.map((row) => ({
      addedBy: row.addedBy,
      totalIncentive: row.incentiveTotal ?? 0,
      daily: row.incentiveDaily ?? [],
    }));
    const summary = byAdderEnriched.reduce((acc, row) => {
      acc.totalClientsHandled += row.clientsHandled || 0;
      acc.totalIncentiveRange += row.incentiveTotal || 0;
      acc.avgJobsPerClientSum += Number(row.avgJobsPerClient) || 0;
      return acc;
    }, { totalClientsHandled: 0, totalIncentiveRange: 0, avgJobsPerClientSum: 0 });

    // Also fetch persisted incentive records for this range
    const persistedIncentives = await ExtensionDailyIncentiveModel.find({
      dateYmd: { $gte: String(startDate), $lte: String(endDate) },
      ...(addedByFilter ? { addedBy: addedByFilter } : {}),
    })
      .sort({ dateYmd: -1, addedBy: 1 })
      .lean();

    const operatorOptions = Array.from(
      new Set([
        ...byAdderEnriched.map((row) => row.addedBy).filter(Boolean),
        ...persistedIncentives.map((row) => row.addedBy).filter(Boolean),
      ])
    ).sort((a, b) => a.localeCompare(b));

    res.status(200).json({
      success: true,
      startDate,
      endDate,
      addedBy: addedByFilter,
      totalJobs,
      totalOperators,
      page: safePage,
      pageSize: limitNum,
      totalPages,
      byAdder: pagedByAdder,
      incentiveByAdder: pagedIncentiveByAdder,
      samples,
      persistedIncentives,
      operatorOptions,
      totalClientsHandled: summary.totalClientsHandled,
      totalIncentiveRange: summary.totalIncentiveRange,
      averageJobsPerClientOverall: totalOperators > 0 ? summary.avgJobsPerClientSum / totalOperators : 0,
      isAdmin: req.user?.role === 'admin',
    });
  } catch (error) {
    console.error('Error in getExtensionJobsReport:', error);
    res.status(500).json({ error: error.message || 'Server error' });
  }
};

/** Paginated jobs for one extension operator (addedBy) within the report date range. */
const getExtensionJobsReportJobsByAdder = async (req, res) => {
  try {
    const { startDate, endDate, addedBy, page = '1', limit = '20' } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }
    const adderTrim = typeof addedBy === 'string' ? addedBy.trim() : '';
    if (!adderTrim) {
      return res.status(400).json({ error: 'addedBy is required' });
    }

    const bounds = istYmdRangeToUtcBounds(String(startDate), String(endDate));
    if (!bounds) {
      return res.status(400).json({ error: 'Invalid date range' });
    }

    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const base = [...buildExtensionJobsParsedRangeStages(bounds), { $match: { addedBy: adderTrim } }];

    const [countAgg, uniqueClientsAgg, jobs] = await Promise.all([
      JobModel.aggregate([...base, { $count: 'n' }]).allowDiskUse(true),
      JobModel.aggregate([
        ...base,
        {
          $addFields: {
            _clientKey: {
              $cond: [
                {
                  $or: [{ $eq: ['$userID', null] }, { $eq: ['$userID', ''] }],
                },
                null,
                {
                  $toLower: {
                    $trim: { input: { $toString: '$userID' } },
                  },
                },
              ],
            },
          },
        },
        { $group: { _id: '$_clientKey' } },
        { $match: { _id: { $nin: [null, ''] } } },
        { $count: 'n' },
      ]).allowDiskUse(true),
      JobModel.aggregate([
        ...base,
        { $sort: { parsedAt: -1 } },
        { $skip: skip },
        { $limit: limitNum },
        {
          $project: {
            jobTitle: 1,
            companyName: 1,
            userID: 1,
            dateAdded: 1,
            createdAt: 1,
            addedBy: 1,
            extensionCode: 1,
            jobID: 1,
            currentStatus: 1,
            updatedAt: 1,
            appliedDate: 1,
          },
        },
      ]).allowDiskUse(true),
    ]);

    const total = countAgg[0]?.n ?? 0;
    const uniqueClients = uniqueClientsAgg[0]?.n ?? 0;
    const totalPages = total === 0 ? 0 : Math.ceil(total / limitNum);

    res.status(200).json({
      success: true,
      addedBy: adderTrim,
      jobs,
      total,
      uniqueClients,
      page: pageNum,
      pageSize: limitNum,
      totalPages,
    });
  } catch (error) {
    console.error('Error in getExtensionJobsReportJobsByAdder:', error);
    res.status(500).json({ error: error.message || 'Server error' });
  }
};

const postExtensionIncentiveComplaint = async (req, res) => {
  try {
    const { dateYmd, addedBy, note, clientEmail } = req.body || {};
    if (!dateYmd || !addedBy) {
      return res.status(400).json({ error: 'dateYmd and addedBy are required' });
    }
    const doc = await ExtensionIncentiveComplaintModel.create({
      dateYmd: String(dateYmd).trim(),
      addedBy: String(addedBy).trim(),
      note: typeof note === 'string' ? note : '',
      clientEmail: clientEmail ? String(clientEmail).trim().toLowerCase() : '',
      createdBy: (req.user && req.user.email) || '',
    });
    res.status(201).json({ success: true, complaint: doc });
  } catch (error) {
    console.error('postExtensionIncentiveComplaint:', error);
    res.status(500).json({ error: error.message || 'Server error' });
  }
};

const listExtensionIncentiveComplaints = async (req, res) => {
  try {
    const { startYmd, endYmd, addedBy } = req.query;
    if (!startYmd || !endYmd) {
      return res.status(400).json({ error: 'startYmd and endYmd are required' });
    }
    const complaints = await ExtensionIncentiveComplaintModel.find({
      dateYmd: { $gte: String(startYmd), $lte: String(endYmd) },
      ...(addedBy ? { addedBy: String(addedBy).trim() } : {}),
    })
      .sort({ dateYmd: -1, createdAt: -1 })
      .limit(500)
      .lean();
    res.status(200).json({ success: true, complaints });
  } catch (error) {
    console.error('listExtensionIncentiveComplaints:', error);
    res.status(500).json({ error: error.message || 'Server error' });
  }
};

const deleteExtensionIncentiveComplaint = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const deleted = await ExtensionIncentiveComplaintModel.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('deleteExtensionIncentiveComplaint:', error);
    res.status(500).json({ error: error.message || 'Server error' });
  }
};

// Jobs Added report: per client per cap day, jobs added by each platform
// (JobRight / HiringCafe / Indeed / Glassdoor) plus the Autopilot's one-line
// reason wherever a platform added nothing. See utils/jobAddReport.js.
// GET /api/job-add-report?date=YYYY-MM-DD   (default: today's cap day)
const getJobAddReport = async (req, res) => {
  try {
    const day = String(req.query.date || addWindowDayStamp());
    const win = capDayWindow(day);
    if (!win) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    const db = mongoose.connection.db;
    const [countRows, savedRows, run, clients] = await Promise.all([
      db.collection('jobdbs').aggregate([
        { $match: { _id: { $gte: objectIdAt(win.start), $lt: objectIdAt(win.end) } } },
        { $group: {
          _id: { u: { $toLower: { $ifNull: ['$userID', ''] } }, b: BUCKET_EXPR,
                 gone: { $regexMatch: { input: { $ifNull: ['$currentStatus', ''] }, regex: /^(deleted|removed)/i } } },
          n: { $sum: 1 } } },
      ], { allowDiskUse: true }).toArray(),
      db.collection('jobaddreports').find({ day }).toArray(),
      db.collection('jobaddruns').findOne({ _id: day }),
      ClientModel.find({}, { email: 1, name: 1, clientCountry: 1, status: 1, isPaused: 1 }).lean(),
    ]);
    const counts = new Map();
    const removed = new Map();
    for (const r of countRows) {
      if (r._id.gone) { removed.set(r._id.u, (removed.get(r._id.u) || 0) + r.n); continue; }
      if (!counts.has(r._id.u)) counts.set(r._id.u, {});
      counts.get(r._id.u)[r._id.b] = r.n;
    }
    const saved = new Map(savedRows.map((r) => [String(r.email || '').toLowerCase(), r]));
    const banner = runState(run);
    const runActive = banner.state === 'live';
    const rows = [];
    for (const c of clients) {
      const email = String(c.email || '').trim().toLowerCase();
      if (!email) continue;
      const active = String(c.status || '').toLowerCase() === 'active';
      // Active clients always; anyone else only if something happened that day.
      if (!active && !counts.has(email) && !saved.has(email) && !removed.has(email)) continue;
      rows.push(buildRow(
        { email, name: c.name, country: c.clientCountry, paused: !!c.isPaused || !active },
        counts.get(email) || {}, saved.get(email) || null, runActive, removed.get(email) || 0,
      ));
    }
    rows.sort((a, b) => (a.paused - b.paused) || (a.total - b.total) || a.name.localeCompare(b.name));
    res.json({ day, today: addWindowDayStamp(), window: win, run: banner, rows });
  } catch (error) {
    console.error('Error in getJobAddReport:', error);
    res.status(500).json({ error: 'Could not build the Jobs Added report' });
  }
};
app.get('/api/job-add-report', verifyToken, getJobAddReport);

// Admin Notifications tab: every email Flashfire sends a client (daily
// summary, onboarding sequence, plan milestones, inbox alerts) plus the team's
// no-activity alert, in one list, and what is scheduled next. The sources are
// written by the dashboard backend and by this service's milestone mailer;
// this side only reads. See utils/notificationsLog.js.

/** Client emails whose tracked name matches the search, for rows that carry no name. */
async function emailsMatchingName(db, search) {
  if (!search) return [];
  const rx = new RegExp(escapeNotificationSearch(search), 'i');
  const docs = await db.collection('dashboardtrackings')
    .find({ name: rx }, { projection: { email: 1 } }).limit(500).toArray();
  return docs.map((d) => String(d.email || '').toLowerCase()).filter(Boolean);
}

/** Everything computeScheduled needs: active clients, their configs, live onboarding sequences. */
async function loadScheduleInputs(db) {
  const [clients, configs, onboarding] = await Promise.all([
    db.collection('dashboardtrackings')
      .find(ACTIVE_CLIENT_FILTER, { projection: { email: 1, name: 1, clientNumber: 1, paymentEmail: 1 } }).toArray(),
    db.collection('clientreminderconfigs')
      .find({}, { projection: { clientEmail: 1, clientName: 1, items: 1, updatedBy: 1, paymentEmailOverride: 1 } }).toArray(),
    db.collection('onboardingmailstates')
      .find({ status: 'scheduled' }, { projection: { clientEmail: 1, clientName: 1, paymentEmail: 1, status: 1, steps: 1 } }).toArray(),
  ]);
  return { clients, configs, onboarding };
}

/** Run the merged history aggregation; one document { rows, total, counts }. */
async function runHistory(db, args) {
  const { coll, pipeline } = buildHistoryAggregation(args);
  const [facet] = await db.collection(coll).aggregate(pipeline).toArray();
  return facet || { rows: [], total: [], counts: [] };
}

/** Milestone and inbox rows carry no client name; fill it from dashboardtrackings. */
async function fillClientNames(db, rows) {
  const missing = [...new Set(rows.filter((r) => !r.clientName && r.clientEmail).map((r) => r.clientEmail))];
  if (!missing.length) return rows;
  const docs = await db.collection('dashboardtrackings')
    .find({ email: { $in: missing } }, { projection: { email: 1, name: 1 } }).toArray();
  const names = new Map(docs.map((d) => [String(d.email || '').toLowerCase(), d.name || '']));
  return rows.map((r) => (r.clientName ? r : { ...r, clientName: names.get(r.clientEmail) || '' }));
}

const getNotificationDeliveries = async (req, res) => {
  const parsed = parseDeliveryQuery(req.query);
  if (parsed.error) return res.status(400).json({ success: false, error: parsed.error });
  try {
    const db = mongoose.connection.db;
    const searchEmails = await emailsMatchingName(db, parsed.filters.search);
    const [history, inputs] = await Promise.all([
      runHistory(db, { filters: parsed.filters, status: parsed.status, page: parsed.page, pageSize: parsed.pageSize, searchEmails }),
      loadScheduleInputs(db),
    ]);
    const scheduled = filterScheduled(computeScheduled({ ...inputs, now: new Date() }), parsed.filters, searchEmails);

    let rows;
    let total;
    if (parsed.status === 'scheduled') {
      total = scheduled.length;
      rows = scheduled.slice((parsed.page - 1) * parsed.pageSize, parsed.page * parsed.pageSize);
    } else {
      total = history.total[0]?.n || 0;
      rows = history.rows;
    }
    res.json({
      success: true,
      rows: await fillClientNames(db, rows),
      page: parsed.page,
      pageSize: parsed.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / parsed.pageSize)),
      counts: toCounts(history.counts, scheduled.length),
    });
  } catch (error) {
    console.error('Error in getNotificationDeliveries:', error);
    res.status(500).json({ success: false, error: 'Could not load notifications' });
  }
};

const getNotificationSummary = async (req, res) => {
  try {
    const db = mongoose.connection.db;
    const today = istDayString();
    const todayFilters = { from: today, to: today };
    const [inputs, history] = await Promise.all([
      loadScheduleInputs(db),
      runHistory(db, { filters: todayFilters, page: 1, pageSize: 1 }),
    ]);
    const scheduledToday = filterScheduled(computeScheduled({ ...inputs, now: new Date() }), todayFilters);
    res.json({
      success: true,
      coverage: computeCoverage(inputs.clients, inputs.configs),
      today: toCounts(history.counts, scheduledToday.length),
    });
  } catch (error) {
    console.error('Error in getNotificationSummary:', error);
    res.status(500).json({ success: false, error: 'Could not load the notification summary' });
  }
};
app.get('/api/notifications/deliveries', verifyToken, verifyAdmin, getNotificationDeliveries);
app.get('/api/notifications/summary', verifyToken, verifyAdmin, getNotificationSummary);

// Extension report: visible to ALL authenticated users
app.get('/api/extension-jobs-report', verifyToken, getExtensionJobsReport);
app.get('/api/extension-jobs-report/jobs', verifyToken, getExtensionJobsReportJobsByAdder);
// Keep old admin routes for backward compat (redirect to same handlers)
app.get('/api/admin/extension-jobs-report', verifyToken, getExtensionJobsReport);
app.get('/api/admin/extension-jobs-report/jobs', verifyToken, getExtensionJobsReportJobsByAdder);

// Complaint management: admin only
app.post(
  '/api/admin/extension-incentive-complaints',
  verifyToken,
  verifyAdmin,
  postExtensionIncentiveComplaint
);
app.get(
  '/api/admin/extension-incentive-complaints',
  verifyToken,
  verifyAdmin,
  listExtensionIncentiveComplaints
);
app.delete(
  '/api/admin/extension-incentive-complaints/:id',
  verifyToken,
  verifyAdmin,
  deleteExtensionIncentiveComplaint
);

// Incentive management: reject/restore (admin only)
app.patch(
  '/api/admin/extension-daily-incentive/:id/approve',
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!id || !id.match(/^[0-9a-fA-F]{24}$/)) {
        return res.status(400).json({ error: 'Invalid id' });
      }
      const doc = await ExtensionDailyIncentiveModel.findByIdAndUpdate(
        id,
        {
          status: 'approved',
          rejectedBy: '',
          rejectedAt: null,
          rejectionReason: '',
        },
        { new: true }
      );
      if (!doc) return res.status(404).json({ error: 'Incentive record not found' });
      res.status(200).json({ success: true, incentive: doc });
    } catch (error) {
      console.error('approve incentive:', error);
      res.status(500).json({ error: error.message || 'Server error' });
    }
  }
);

app.patch(
  '/api/admin/extension-daily-incentive/:id/reject',
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { reason } = req.body || {};
      if (!id || !id.match(/^[0-9a-fA-F]{24}$/)) {
        return res.status(400).json({ error: 'Invalid id' });
      }
      if (!reason || !reason.trim()) {
        return res.status(400).json({ error: 'Rejection reason is required' });
      }
      const doc = await ExtensionDailyIncentiveModel.findByIdAndUpdate(
        id,
        {
          status: 'rejected',
          rejectedBy: req.user?.email || '',
          rejectedAt: new Date(),
          rejectionReason: reason.trim(),
        },
        { new: true }
      );
      if (!doc) return res.status(404).json({ error: 'Incentive record not found' });
      res.status(200).json({ success: true, incentive: doc });
    } catch (error) {
      console.error('reject incentive:', error);
      res.status(500).json({ error: error.message || 'Server error' });
    }
  }
);

app.patch(
  '/api/admin/extension-daily-incentive/:id/restore',
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!id || !id.match(/^[0-9a-fA-F]{24}$/)) {
        return res.status(400).json({ error: 'Invalid id' });
      }
      const doc = await ExtensionDailyIncentiveModel.findByIdAndUpdate(
        id,
        {
          status: 'approved',
          rejectedBy: '',
          rejectedAt: null,
          rejectionReason: '',
        },
        { new: true }
      );
      if (!doc) return res.status(404).json({ error: 'Incentive record not found' });
      res.status(200).json({ success: true, incentive: doc });
    } catch (error) {
      console.error('restore incentive:', error);
      res.status(500).json({ error: error.message || 'Server error' });
    }
  }
);

// Incentive history: searchable by all authenticated users
app.get(
  '/api/extension-incentive-history',
  verifyToken,
  async (req, res) => {
    try {
      const { startYmd, endYmd, addedBy, status, page = '1', limit = '50' } = req.query;
      const todayYmd = todayIstYmd();
      if (startYmd && endYmd && String(startYmd) <= todayYmd && todayYmd <= String(endYmd)) {
        await syncExtensionDailyRecordsForDate(todayYmd);
      }
      const query = {};
      if (startYmd) query.dateYmd = { ...(query.dateYmd || {}), $gte: String(startYmd) };
      if (endYmd) query.dateYmd = { ...(query.dateYmd || {}), $lte: String(endYmd) };
      if (addedBy) query.addedBy = { $regex: addedBy, $options: 'i' };
      if (status && ['pending', 'approved', 'rejected'].includes(status)) query.status = status;

      const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
      const limitNum = Math.min(200, Math.max(1, parseInt(String(limit), 10) || 50));
      const skip = (pageNum - 1) * limitNum;

      const [records, total] = await Promise.all([
        ExtensionDailyIncentiveModel.find(query)
          .sort({ dateYmd: -1, addedBy: 1 })
          .skip(skip)
          .limit(limitNum)
          .lean(),
        ExtensionDailyIncentiveModel.countDocuments(query),
      ]);

      res.status(200).json({
        success: true,
        records,
        total,
        page: pageNum,
        totalPages: Math.ceil(total / limitNum) || 0,
      });
    } catch (error) {
      console.error('incentive history:', error);
      res.status(500).json({ error: error.message || 'Server error' });
    }
  }
);

// Get all operations who have this client in their managedUsers (by client email)
const getOperationsByClient = async (req, res) => {
  try {
    const { clientEmail } = req.params;
    if (!clientEmail) return res.status(400).json({ error: 'clientEmail is required' });

    const client = await NewUserModel.findOne({ email: clientEmail.toLowerCase().trim() }).lean();
    if (!client) return res.status(200).json({ operations: [], clientId: null });

    const operations = await OperationsModel.find({ managedUsers: client._id }).select('email name').lean();
    const list = (operations || []).map(o => ({ email: o.email, name: o.name || o.email }));

    res.status(200).json({ operations: list, clientId: client._id.toString() });
  } catch (error) {
    console.error('getOperationsByClient:', error);
    res.status(500).json({ error: error.message });
  }
};

app.get('/api/operations', getAllOperations);
app.get('/api/operations/by-client/:clientEmail', getOperationsByClient);
app.get('/api/operations/names', getOperationsNames);
app.get('/api/operations/:email', getOperationsByEmail);
app.post('/api/operations', createOrUpdateOperation);
app.get('/api/operations/:email/jobs', getJobsByOperatorEmail);
app.get('/api/operations/:email/client-stats', getClientStatistics);
app.post('/api/operations/saved-counts', getSavedJobCounts);
app.get('/api/operations/clients', getUniqueClientsFromJobs);
app.get('/api/operations/:email/managed-users', verifyToken, getManagedUsers);
app.post('/api/operations/:email/managed-users', verifyToken, verifyOperationsManage, addManagedUser);
app.post('/api/operations/assign-client', verifyToken, verifyOperationsManage, assignClientToOperator);
app.delete('/api/operations/:email/managed-users/:userID', verifyToken, verifyOperationsManage, removeManagedUser);

// Delete operation user with cascade deletion
const deleteOperationUser = async (req, res) => {
  try {
    const { email } = req.params;

    // Find the operation
    const operation = await OperationsModel.findOne({ email: email.toLowerCase() }).lean();
    if (!operation) {
      return res.status(404).json({ error: 'Operation not found' });
    }

    // Delete the operation
    await OperationsModel.findByIdAndDelete(operation._id);

    // Remove all managed users from other operations that might reference this operation
    // This is a cascade delete - remove this operation from any other operations' managedUsers
    await OperationsModel.updateMany(
      { managedUsers: operation._id },
      { $pull: { managedUsers: operation._id } }
    );

    res.status(200).json({ message: 'Operation user deleted successfully with cascade deletion' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

app.delete('/api/operations/:email/delete-operation', deleteOperationUser);
app.get('/api/operations/:email/available-clients', getAvailableClients);

// Manager sync route
app.post('/api/clients/sync-managers', syncManagerAssignments);
app.get('/api/referral-management/users', getAllUsersForReferralManagement);
app.put('/api/referral-management/users/:email', updateUserReferralStatus);
app.post('/api/referral-management/users/:email/referrals', addReferralForUser);
app.delete('/api/referral-management/users/:email/referrals/:index', removeReferralForUser);


const getCurrentISTTime = () => new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

// Helper function to merge TODOs from both models, keeping the most recent version
const mergeTodos = (todos1, todos2) => {
  const todoMap = new Map();

  // Add all TODOs from first array
  todos1.forEach(todo => {
    todoMap.set(todo.id, todo);
  });

  // Merge TODOs from second array, keeping the one with the latest updatedAt
  todos2.forEach(todo => {
    const existing = todoMap.get(todo.id);
    if (!existing) {
      todoMap.set(todo.id, todo);
    } else {
      // Compare updatedAt timestamps and keep the most recent
      // Handle both string dates and Date objects
      const existingTime = existing.updatedAt
        ? (typeof existing.updatedAt === 'string' ? new Date(existing.updatedAt) : existing.updatedAt)
        : (existing.createdAt ? (typeof existing.createdAt === 'string' ? new Date(existing.createdAt) : existing.createdAt) : new Date(0));
      const newTime = todo.updatedAt
        ? (typeof todo.updatedAt === 'string' ? new Date(todo.updatedAt) : todo.updatedAt)
        : (todo.createdAt ? (typeof todo.createdAt === 'string' ? new Date(todo.createdAt) : todo.createdAt) : new Date(0));

      if (newTime > existingTime || isNaN(existingTime.getTime())) {
        todoMap.set(todo.id, todo);
      }
    }
  });

  return Array.from(todoMap.values());
};

// Helper function to merge lock periods from both models
const mergeLockPeriods = (periods1, periods2) => {
  const periodMap = new Map();

  periods1.forEach(period => {
    periodMap.set(period.id, period);
  });

  periods2.forEach(period => {
    const existing = periodMap.get(period.id);
    if (!existing) {
      periodMap.set(period.id, period);
    } else {
      // Keep the most recent one
      const existingTime = existing.createdAt
        ? (typeof existing.createdAt === 'string' ? new Date(existing.createdAt) : existing.createdAt)
        : new Date(0);
      const newTime = period.createdAt
        ? (typeof period.createdAt === 'string' ? new Date(period.createdAt) : period.createdAt)
        : new Date(0);

      if (newTime > existingTime || isNaN(existingTime.getTime())) {
        periodMap.set(period.id, period);
      }
    }
  });

  return Array.from(periodMap.values());
};

// Helper function to get default TODOs

const getDefaultTodos = () => {
  const timestamp = Date.now();
  return [
    {
      id: `todo-${timestamp}-1`,
      title: 'Create optimized resume',
      notes: '',
      completed: false,
      createdBy: '',
      createdAt: getCurrentISTTime(),
      updatedAt: getCurrentISTTime()
    },
    {
      id: `todo-${timestamp}-2`,
      title: 'LinkedIn Optimization',
      notes: '',
      completed: false,
      createdBy: '',
      createdAt: getCurrentISTTime(),
      updatedAt: getCurrentISTTime()
    },
    {
      id: `todo-${timestamp}-3`,
      title: 'Cover letter Optimization',
      notes: '',
      completed: false,
      createdBy: '',
      createdAt: getCurrentISTTime(),
      updatedAt: getCurrentISTTime()
    }
  ];
};

const getDefaultOptimizations = () => ({
  resumeOptimization: {
    completed: false,
    attachmentUrl: "",
    attachmentName: "",
    updatedAt: getCurrentISTTime(),
    updatedBy: ""
  },
  linkedinOptimization: {
    completed: false,
    attachmentUrl: "",
    attachmentName: "",
    updatedAt: getCurrentISTTime(),
    updatedBy: ""
  },
  coverLetterOptimization: {
    completed: false,
    attachmentUrl: "",
    attachmentName: "",
    updatedAt: getCurrentISTTime(),
    updatedBy: ""
  }
});

app.get('/api/client-todos/all', async (req, res) => {
  try {

    const [allClientTodos, allClientOps, allClients] = await Promise.all([
      ClientTodosModel.find().lean(),
      ClientOperationsModel.find().lean(),
      ClientModel.find().select('email name status planType').lean()
    ]);

    const clientMap = {};
    const clientStatusMap = {};
    const clientPlanMap = {};
    const clientEmails = new Set();
    allClients.forEach(client => {
      const emailLower = client.email.toLowerCase();
      clientMap[emailLower] = client.name;
      clientStatusMap[emailLower] = client.status;
      clientPlanMap[emailLower] = client.planType || null;
      clientEmails.add(emailLower);
    });

    const mergedDataMap = new Map();

    allClientTodos.forEach(todoData => {
      const email = todoData.clientEmail.toLowerCase();
      mergedDataMap.set(email, {
        email: todoData.clientEmail,
        name: clientMap[email] || todoData.clientEmail,
        planType: clientPlanMap[email] ?? null,
        todos: todoData.todos || [],
        lockPeriods: todoData.lockPeriods || [],
        optimizations: todoData.optimizations || getDefaultOptimizations(),
        createdAt: todoData.createdAt,
        updatedAt: todoData.updatedAt
      });
    });

    allClientOps.forEach(opsData => {
      const email = opsData.clientEmail.toLowerCase();
      const existing = mergedDataMap.get(email);

      if (existing) {
        existing.todos = mergeTodos(existing.todos, opsData.todos || []);
        existing.lockPeriods = mergeLockPeriods(existing.lockPeriods, opsData.lockPeriods || []);
        if (existing.planType == null) existing.planType = clientPlanMap[email] ?? null;
        if (opsData.optimizations) {
          existing.optimizations = {
            ...existing.optimizations,
            ...opsData.optimizations
          };
        }
        const existingTime = new Date(existing.updatedAt || 0);
        const opsTime = new Date(opsData.updatedAt || 0);
        if (opsTime > existingTime) {
          existing.updatedAt = opsData.updatedAt;
        }
      } else {
        mergedDataMap.set(email, {
          email: opsData.clientEmail,
          name: clientMap[email] || opsData.clientEmail,
          planType: clientPlanMap[email] ?? null,
          todos: opsData.todos || [],
          lockPeriods: opsData.lockPeriods || [],
          optimizations: opsData.optimizations || getDefaultOptimizations(),
          createdAt: opsData.createdAt,
          updatedAt: opsData.updatedAt
        });
      }
    });

    const clientsWithTodos = Array.from(mergedDataMap.values());

    allClients.forEach(client => {
      const exists = clientsWithTodos.find(c => c.email.toLowerCase() === client.email.toLowerCase());
      if (!exists) {
        clientsWithTodos.push({
          email: client.email,
          name: client.name,
          planType: client.planType || null,
          todos: [],
          lockPeriods: [],
          optimizations: getDefaultOptimizations(),
          createdAt: null,
          updatedAt: null
        });
      } else if (exists.planType == null) {
        exists.planType = client.planType || null;
      }
    });

    const clientEmailList = Array.from(clientEmails);

    const jobAnalysisPipeline = [
      {
        $match: {
          userID: { $in: clientEmailList },
          $or: [
            { currentStatus: { $regex: /appl/i } },
            { appliedDate: { $exists: true, $ne: null } }
          ]
        }
      },
      {
        $group: {
          _id: '$userID',
          hasAppliedJobs: { $sum: 1 }
        }
      }
    ];

    const lastAppliedJobsQuery = {
      userID: { $in: clientEmailList },
      appliedDate: { $exists: true, $ne: null },
      $or: [
        { operatorName: { $exists: true, $nin: [null, '', 'user'] } },
        { timeline: { $regex: /applied\s+by\s/i } }
      ]
    };

    const dashboardJobCountPipeline = [
      { $match: { userID: { $in: clientEmailList } } },
      { $group: { _id: '$userID', count: { $sum: 1 } } }
    ];

    const [jobAnalysis, allAppliedJobs, dashboardJobCounts] = await Promise.all([
      JobModel.aggregate(jobAnalysisPipeline),
      JobModel.find(lastAppliedJobsQuery).select('userID companyName appliedDate operatorName timeline').lean(),
      JobModel.aggregate(dashboardJobCountPipeline)
    ]);

    const parseDateString = (dateStr) => {
      if (!dateStr) return null;
      try {
        const parts = dateStr.split('/');
        if (parts.length === 3) {
          const [day, month, year] = parts.map(n => parseInt(n, 10));
          return new Date(year, month - 1, day);
        }
        return new Date(dateStr);
      } catch {
        return null;
      }
    };

    const jobsByUser = new Map();
    allAppliedJobs.forEach(job => {
      const emailLower = job.userID.toLowerCase();
      const existing = jobsByUser.get(emailLower);
      const jobDate = parseDateString(job.appliedDate);

      if (!existing || !existing.date || (jobDate && jobDate > existing.date)) {
        jobsByUser.set(emailLower, {
          companyName: job.companyName,
          appliedDate: job.appliedDate,
          operatorName: resolveLastAppliedOperatorDisplayName(job),
          date: jobDate
        });
      }
    });

    const appliedJobsCountMap = new Map(
      jobAnalysis.map(j => [j._id.toLowerCase(), j.hasAppliedJobs || 0])
    );
    const dashboardJobCountMap = new Map(
      (dashboardJobCounts || []).map(j => [j._id.toLowerCase(), j.count || 0])
    );
    const lastAppliedMap = new Map();
    jobsByUser.forEach((jobData, email) => {
      lastAppliedMap.set(email, {
        companyName: jobData.companyName,
        appliedDate: jobData.appliedDate,
        operatorName: jobData.operatorName
      });
    });

    clientsWithTodos.forEach(client => {
      const emailLower = client.email.toLowerCase();
      const dbStatus = clientStatusMap[emailLower];
      if (dbStatus === 'active' || dbStatus === 'inactive') {
        client.isJobActive = dbStatus === 'active';
        client.status = dbStatus;
      } else {
        client.isJobActive = true;
        client.status = 'active';
      }
      const lastJob = lastAppliedMap.get(emailLower);
      if (lastJob) {
        client.lastAppliedJob = lastJob;
      } else {
        client.lastAppliedJob = null;
      }
      client.appliedJobsCount = appliedJobsCountMap.get(emailLower) || 0;
      client.dashboardJobCount = dashboardJobCountMap.get(emailLower) || 0;
    });

    clientsWithTodos.sort((a, b) => {
      if (a.isJobActive === b.isJobActive) return 0;
      return a.isJobActive ? -1 : 1;
    });

    res.status(200).json({ success: true, clients: clientsWithTodos });
  } catch (error) {
    console.error('Error fetching all client todos:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get client TODOs and lock periods by email - SYNCED with ClientOperationsModel
app.get('/api/client-todos/:email', async (req, res) => {
  try {
    const { email } = req.params;
    const emailLower = email.toLowerCase();

    // Fetch from both models
    let clientTodos = await ClientTodosModel.findOne({ clientEmail: emailLower });
    let clientOps = await ClientOperationsModel.findOne({ clientEmail: emailLower });

    // If neither exists, create default structure in both
    if (!clientTodos && !clientOps) {
      const defaultTodos = getDefaultTodos();
      const defaultData = {
        clientEmail: emailLower,
        todos: defaultTodos,
        lockPeriods: [],
        createdAt: getCurrentISTTime(),
        updatedAt: getCurrentISTTime()
      };

      clientTodos = new ClientTodosModel(defaultData);
      clientOps = new ClientOperationsModel(defaultData);

      await Promise.all([
        clientTodos.save(),
        clientOps.save()
      ]);
    } else {
      // Merge data from both models
      const mergedTodos = mergeTodos(
        clientTodos?.todos || [],
        clientOps?.todos || []
      );
      const mergedLockPeriods = mergeLockPeriods(
        clientTodos?.lockPeriods || [],
        clientOps?.lockPeriods || []
      );

      // Ensure default TODOs are present
      const defaultTodoTitles = ['Create optimized resume', 'LinkedIn Optimization', 'Cover letter Optimization'];
      const existingTitles = mergedTodos.map(t => t.title);
      const missingDefaults = defaultTodoTitles.filter(title => !existingTitles.includes(title));

      if (missingDefaults.length > 0 || mergedTodos.length === 0) {
        // Add missing default TODOs
        const defaultTodos = getDefaultTodos();
        defaultTodos.forEach(defaultTodo => {
          if (!mergedTodos.find(t => t.title === defaultTodo.title)) {
            mergedTodos.push(defaultTodo);
          }
        });
      }

      // Update both models with merged data
      const updateData = {
        todos: mergedTodos,
        lockPeriods: mergedLockPeriods,
        updatedAt: getCurrentISTTime()
      };

      if (!clientTodos) {
        clientTodos = new ClientTodosModel({
          clientEmail: emailLower,
          ...updateData,
          createdAt: getCurrentISTTime()
        });
      } else {
        clientTodos.todos = mergedTodos;
        clientTodos.lockPeriods = mergedLockPeriods;
        clientTodos.updatedAt = getCurrentISTTime();
      }

      if (!clientOps) {
        clientOps = new ClientOperationsModel({
          clientEmail: emailLower,
          ...updateData,
          createdAt: getCurrentISTTime()
        });
      } else {
        clientOps.todos = mergedTodos;
        clientOps.lockPeriods = mergedLockPeriods;
        clientOps.updatedAt = getCurrentISTTime();
      }

      // Save both models
      await Promise.all([
        clientTodos.save(),
        clientOps.save()
      ]);
    }

    res.status(200).json({ success: true, data: clientTodos });
  } catch (error) {
    console.error('Error fetching client todos:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update client TODOs and lock periods - SYNCED with ClientOperationsModel
app.put('/api/client-todos/:email', async (req, res) => {
  try {
    const { email } = req.params;
    const { todos, lockPeriods } = req.body;
    const emailLower = email.toLowerCase();

    const updateData = {
      updatedAt: getCurrentISTTime()
    };

    if (todos !== undefined) {
      updateData.todos = todos.map(todo => ({
        ...todo,
        // Preserve createdBy if it exists, otherwise set as "admin" (created from clients-tracking)
        createdBy: todo.createdBy || "admin",
        updatedAt: todo.updatedAt || getCurrentISTTime()
      }));
    }

    if (lockPeriods !== undefined) {
      updateData.lockPeriods = lockPeriods;
    }

    // Update both models simultaneously to keep them in sync
    const [clientTodos, clientOps] = await Promise.all([
      ClientTodosModel.findOneAndUpdate(
        { clientEmail: emailLower },
        { $set: updateData },
        { new: true, upsert: true }
      ),
      ClientOperationsModel.findOneAndUpdate(
        { clientEmail: emailLower },
        { $set: updateData },
        { new: true, upsert: true }
      )
    ]);

    // If upsert created new documents, ensure they have clientEmail
    if (clientTodos && !clientTodos.clientEmail) {
      clientTodos.clientEmail = emailLower;
      await clientTodos.save();
    }
    if (clientOps && !clientOps.clientEmail) {
      clientOps.clientEmail = emailLower;
      await clientOps.save();
    }

    res.status(200).json({ success: true, message: 'Client todos updated successfully', data: clientTodos });
  } catch (error) {
    console.error('Error updating client todos:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Check if current date is within any lock period
app.post('/api/client-todos/check-lock-period', async (req, res) => {
  try {
    const { clientEmail } = req.body;

    if (!clientEmail) {
      return res.status(400).json({ success: false, message: 'Client email is required' });
    }

    const clientTodos = await ClientTodosModel.findOne({ clientEmail: clientEmail.toLowerCase() }).lean();

    if (!clientTodos || !clientTodos.lockPeriods || clientTodos.lockPeriods.length === 0) {
      return res.status(200).json({ success: true, isLocked: false, message: null });
    }

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    for (const period of clientTodos.lockPeriods) {
      const startDate = new Date(period.startDate);
      const endDate = new Date(period.endDate);

      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);

      if (now >= startDate && now <= endDate) {
        return res.status(200).json({
          success: true,
          isLocked: true,
          message: period.reason || 'Job card movement is locked during this period. Please try again after the lock period ends.',
          lockPeriod: {
            startDate: period.startDate,
            endDate: period.endDate,
            reason: period.reason
          }
        });
      }
    }

    return res.status(200).json({ success: true, isLocked: false, message: null });
  } catch (error) {
    console.error('Error checking lock period:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/client-todos/migrate-defaults', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const allClients = await ClientModel.find().select('email').lean();
    const defaultTodos = [
      {
        id: `todo-${Date.now()}-1`,
        title: 'Create optimized resume',
        notes: '',
        completed: false,
        createdAt: getCurrentISTTime(),
        updatedAt: getCurrentISTTime()
      },
      {
        id: `todo-${Date.now()}-2`,
        title: 'LinkedIn Optimization',
        notes: '',
        completed: false,
        createdAt: getCurrentISTTime(),
        updatedAt: getCurrentISTTime()
      },
      {
        id: `todo-${Date.now()}-3`,
        title: 'Cover letter Optimization',
        notes: '',
        completed: false,
        createdAt: getCurrentISTTime(),
        updatedAt: getCurrentISTTime()
      }
    ];

    let created = 0;
    let skipped = 0;

    for (const client of allClients) {
      const existing = await ClientTodosModel.findOne({ clientEmail: client.email.toLowerCase() }).lean();

      if (!existing) {
        await ClientTodosModel.create({
          clientEmail: client.email.toLowerCase(),
          todos: defaultTodos.map((todo, idx) => ({
            ...todo,
            id: `todo-${Date.now()}-${idx + 1}-${client.email}`
          })),
          lockPeriods: []
        });
        created++;
      } else {
        skipped++;
      }
    }

    res.status(200).json({
      success: true,
      message: `Migration completed: ${created} clients initialized with default todos, ${skipped} clients already had todos`,
      stats: { created, skipped, total: allClients.length }
    });
  } catch (error) {
    console.error('Error migrating default todos:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});


// Client details route (removed duplicate - using getClientByEmail instead)

app.put('/api/client-optimizations/:email', async (req, res) => {
  try {
    const { email } = req.params;
    const { optimizations } = req.body;
    const emailLower = email.toLowerCase();

    if (!optimizations) {
      return res.status(400).json({ success: false, error: 'Optimizations data is required' });
    }

    const updateData = {
      optimizations,
      updatedAt: getCurrentISTTime()
    };

    const [clientTodos, clientOps] = await Promise.all([
      ClientTodosModel.findOneAndUpdate(
        { clientEmail: emailLower },
        { $set: updateData },
        { new: true, upsert: true }
      ),
      ClientOperationsModel.findOneAndUpdate(
        { clientEmail: emailLower },
        { $set: updateData },
        { new: true, upsert: true }
      )
    ]);

    res.status(200).json({ success: true, message: 'Optimizations updated successfully', data: clientTodos });
  } catch (error) {
    console.error('Error updating optimizations:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Internal sync: when client uploads resume/cover letter in Flashfire Documents (2+ days after dashboard creation)
// Auth: X-API-Key header must match INTERNAL_SYNC_API_KEY
app.post('/api/internal/sync-document-upload', express.json(), async (req, res) => {
  try {
    const apiKey = req.headers['x-api-key'];
    const expectedKey = process.env.INTERNAL_SYNC_API_KEY;
    if (!expectedKey || apiKey !== expectedKey) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    const { email, documentType, url, fileName } = req.body || {};
    if (!email || !documentType || !['resume', 'coverLetter'].includes(documentType)) {
      return res.status(400).json({ success: false, error: 'email and documentType (resume|coverLetter) required' });
    }
    const emailLower = (email || '').toLowerCase().trim();
    const client = await ClientModel.findOne({ email: emailLower }).lean();
    if (!client) {
      return res.status(200).json({ updated: false, reason: 'client_not_in_tracking' });
    }
    // Resolve dashboard creation date (prefer Client.createdAt, then OnboardingJob, then Profile)
    let dashboardCreated = null;
    const clientCreated = parseFlexibleDate(client.createdAt);
    if (clientCreated) dashboardCreated = clientCreated;
    if (!dashboardCreated) {
      const job = await OnboardingJobModel.findOne({ clientEmail: emailLower }).select('createdAt').lean();
      if (job?.createdAt) dashboardCreated = job.createdAt instanceof Date ? job.createdAt : new Date(job.createdAt);
    }
    if (!dashboardCreated) {
      const Profile = getProfileModel();
      const profile = await Profile.findOne({ email: emailLower }).select('createdAt').lean();
      if (profile?.createdAt) dashboardCreated = profile.createdAt instanceof Date ? profile.createdAt : new Date(profile.createdAt);
    }
    if (!dashboardCreated) {
      dashboardCreated = new Date(0); // treat as very old to avoid blocking
    }
    const now = new Date();
    const twoDaysMs = 2 * 24 * 60 * 60 * 1000;
    if (now.getTime() - dashboardCreated.getTime() < twoDaysMs) {
      return res.status(200).json({ updated: false, reason: 'within_2_day_window' });
    }
    let updated = false;
    const dateStr = now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
    if (documentType === 'resume' && !client.resumeSent) {
      await ClientModel.updateOne(
        { email: emailLower },
        { $set: { resumeSent: true, resumeSentDate: dateStr, updatedAt: dateStr } }
      );
      updated = true;
      // Combined "started" email is dispatched by hourly cron once: resumeSent + !onboardingPhase + count >= 10.
    }
    if (documentType === 'coverLetter' && !client.coverLetterSent) {
      await ClientModel.updateOne(
        { email: emailLower },
        { $set: { coverLetterSent: true, coverLetterSentDate: dateStr, updatedAt: dateStr } }
      );
      updated = true;
    }
    // Add attachment to OnboardingJob if not already present (for JobCard badges)
    const job = await OnboardingJobModel.findOne({ clientEmail: emailLower });
    if (job) {
      const attachments = job.attachments || [];
      const resumeMatch = documentType === 'resume' && attachments.some((a) => /^resume$/i.test((a.name || '').trim()));
      const coverMatch = documentType === 'coverLetter' && attachments.some((a) => /cover\s*letter/i.test((a.name || '').trim()));
      if (!resumeMatch && !coverMatch && url && String(url).trim()) {
        const attName = documentType === 'resume' ? 'resume' : 'cover letter';
        job.attachments = job.attachments || [];
        job.attachments.push({
          url: String(url).trim(),
          filename: fileName || attName,
          name: attName,
          uploadedAt: new Date(),
          uploadedBy: 'auto-sync'
        });
        job.updatedAt = new Date();
        await job.save();
        invalidateJobListCache();
        updated = true;
      }
    }
    return res.status(200).json({ updated });
  } catch (e) {
    console.error('[sync-document-upload]', e);
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/client-optimizations/upload', fileUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const { email, documentType = 'resume' } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }

    if (!documentType || !['resume', 'coverLetter'].includes(documentType)) {
      return res.status(400).json({
        success: false,
        error: "documentType must be 'resume' or 'coverLetter'"
      });
    }

    console.log(`[Upload] Attempting to upload ${documentType} for ${email} to ${FLASHFIRE_API_BASE_URL}/api/internal/upload-client-document`);
    console.log(`[Upload] File details: ${req.file.originalname}, size: ${req.file.size}, type: ${req.file.mimetype}`);

    const formData = new FormData();
    formData.append('file', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
      knownLength: req.file.buffer.length,
    });
    formData.append('email', email);
    formData.append('documentType', documentType);

    // Send as buffer so the full multipart body is sent (avoids "Unexpected end of form" on receiver)
    const bodyBuffer = formData.getBuffer();
    const headers = formData.getHeaders();
    headers['Content-Length'] = String(bodyBuffer.length);
    console.log(`[Upload] Request headers:`, headers);

    const response = await fetch(`${FLASHFIRE_API_BASE_URL}/api/internal/upload-client-document`, {
      method: 'POST',
      body: bodyBuffer,
      headers: headers,
    });

    console.log(`[Upload] Response status: ${response.status} ${response.statusText}`);
    console.log(`[Upload] Response headers:`, Object.fromEntries(response.headers.entries()));

    let data;
    const contentType = response.headers.get('content-type');

    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      const text = await response.text();
      console.error(`[Upload] Non-JSON response received:`, text.substring(0, 500));
      throw new Error(`Dashboard backend returned non-JSON response (${response.status}): ${text.substring(0, 200)}`);
    }

    console.log(`[Upload] Response data:`, JSON.stringify(data, null, 2));

    if (!response.ok) {
      const errorMessage = data.message || data.error || `HTTP ${response.status}: ${response.statusText}`;
      console.error(`[Upload] Upload failed:`, errorMessage);
      throw new Error(errorMessage);
    }

    res.status(200).json({
      success: true,
      url: data.url,
      fileName: data.fileName,
      documentType: data.documentType,
      storage: data.storage,
      message: data.message || 'File uploaded and synced to dashboard successfully'
    });
  } catch (error) {
    console.error('[Upload] Error uploading file:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      cause: error.cause
    });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to upload file to dashboard',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

app.get('/api/client-optimizations/documents/:email', async (req, res) => {
  try {
    const { email } = req.params;

    console.log(`[Fetch Documents] Fetching documents for ${email} from ${FLASHFIRE_API_BASE_URL}/api/internal/client-documents/${encodeURIComponent(email)}`);

    const response = await fetch(`${FLASHFIRE_API_BASE_URL}/api/internal/client-documents/${encodeURIComponent(email)}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    console.log(`[Fetch Documents] Response status: ${response.status} ${response.statusText}`);

    let data;
    const contentType = response.headers.get('content-type');

    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      const text = await response.text();
      console.error(`[Fetch Documents] Non-JSON response received:`, text.substring(0, 500));
      throw new Error(`Dashboard backend returned non-JSON response (${response.status}): ${text.substring(0, 200)}`);
    }

    console.log(`[Fetch Documents] Response data:`, JSON.stringify(data, null, 2));

    if (!response.ok) {
      const errorMessage = data.message || data.error || `HTTP ${response.status}: ${response.statusText}`;
      console.error(`[Fetch Documents] Fetch failed:`, errorMessage);
      throw new Error(errorMessage);
    }

    res.status(200).json({
      success: true,
      documents: data.documents,
      resumeUrl: data.documents?.resumeUrl,
      coverLetterUrl: data.documents?.coverLetterUrl,
      linkedinUrl: data.documents?.linkedinUrl,
      resumeLinks: data.documents?.resumeLinks || [],
      coverLetters: data.documents?.coverLetters || [],
    });
  } catch (error) {
    console.error('[Fetch Documents] Error fetching documents:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      cause: error.cause
    });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch documents',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

app.post('/api/client-optimizations/sync-to-dashboard', async (req, res) => {
  try {
    const { email, resumeUrl, coverLetterUrl, linkedinUrl } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }

    const updatePayload = {};
    if (resumeUrl) updatePayload.resumeUrl = resumeUrl;
    if (coverLetterUrl) updatePayload.coverLetterUrl = coverLetterUrl;
    if (linkedinUrl) updatePayload.linkedinUrl = linkedinUrl;

    if (Object.keys(updatePayload).length === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update' });
    }

    console.log(`[Sync] Syncing optimization data for ${email} to ${FLASHFIRE_API_BASE_URL}/api/internal/client-optimization/${encodeURIComponent(email)}`);
    console.log(`[Sync] Payload:`, JSON.stringify(updatePayload, null, 2));

    const response = await fetch(`${FLASHFIRE_API_BASE_URL}/api/internal/client-optimization/${encodeURIComponent(email)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updatePayload),
    });

    console.log(`[Sync] Response status: ${response.status} ${response.statusText}`);

    let data;
    const contentType = response.headers.get('content-type');

    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      const text = await response.text();
      console.error(`[Sync] Non-JSON response received:`, text.substring(0, 500));
      throw new Error(`Dashboard backend returned non-JSON response (${response.status}): ${text.substring(0, 200)}`);
    }

    console.log(`[Sync] Response data:`, JSON.stringify(data, null, 2));

    if (!response.ok) {
      const errorMessage = data.message || data.error || `HTTP ${response.status}: ${response.statusText}`;
      console.error(`[Sync] Sync failed:`, errorMessage);
      throw new Error(errorMessage);
    }

    res.status(200).json({ success: true, message: 'Synced to dashboard successfully', profile: data.profile });
  } catch (error) {
    console.error('[Sync] Error syncing to dashboard:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      cause: error.cause
    });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to sync to dashboard',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Start automated call status cleanup job
// Runs every 30 seconds to update stuck "calling" calls to "completed" (after 30 seconds timeout - NO MATTER WHAT)
let callSweepInterval = null;

function startCallSweepJob() {
  // Run immediately on startup
  sweepOverdueCalls().catch(err => {
    console.error('❌ [Call Sweep] Initial sweep error:', err);
  });

  // Then run every 30 seconds for faster detection of stuck calls
  callSweepInterval = setInterval(async () => {
    try {
      const updated = await sweepOverdueCalls();
      if (updated > 0) {
        console.log(`🔄 [Call Sweep] Auto-updated ${updated} calls from "calling" to "completed"`);
      }
    } catch (error) {
      console.error('❌ [Call Sweep] Scheduled sweep error:', error);
    }
  }, 30 * 1000); // Every 30 seconds (changed from 2 minutes for faster detection)

  // console.log('✅ [Call Sweep] Automated call status cleanup job started (runs every 30 seconds, auto-completes calls stuck in "calling" for >30 seconds - NO MATTER WHAT)');
}

// --- Job card reminder cron (11:30 PM IST daily) ---
const DISCORD_JOBCARD_REMINDER_WEBHOOK = process.env.DISCORD_JOBCARD_REMINDER || '';


const DISCORD_ZERO_SAVED_WEBHOOK = process.env.DISCORD_ZERO_SAVED || '';
// Daily add-shortfall report. Its own channel on purpose: the other two
// reminders are per-client nags an operator can action one at a time, while
// this one is a scoreboard a team lead reads top to bottom. Mixed into the same
// feed it would be scrolled past.
const DISCORD_ADD_SHORTFALL_WEBHOOK = process.env.DISCORD_ADD_SHORTFALL || '';

function capitalizeOperatorName(name) {
  if (!name || typeof name !== 'string') return '';
  const t = name.trim();
  if (!t) return '';
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

/** Active + Unpaused only (excludes Paused and New/onboarding — same as Client Job Analysis "Unpaused"). */
function clientFilterActiveUnpaused() {
  return {
    status: 'active',
    $nor: [{ isPaused: true }, { onboardingPhase: true }]
  };
}

/** Display name for who last added job cards (extension addedBy / operator / code). */
function formatLastJobAdderName({ addedBy, operatorName, extensionCode }) {
  const a = (addedBy || '').trim();
  if (a) {
    if (/\s/.test(a)) return a;
    return capitalizeOperatorName(a) || a;
  }
  const o = (operatorName || '').trim();
  if (o && o.toLowerCase() !== 'user') return capitalizeOperatorName(o) || o;
  const e = (extensionCode || '').trim();
  if (e) return e;
  return '';
}

async function postDiscordReminder(webhookUrl, message, tag, options = {}) {
  const {
    reminderType = 'manual',
    clientEmail = '',
    clientName = '',
    addedBy = '',
    triggeredBy = '',
    triggeredSource = 'cron',
    metadata = {},
  } = options || {};

  const baseLog = {
    reminderType,
    webhookTag: tag || '',
    message: String(message || ''),
    clientEmail: String(clientEmail || '').toLowerCase(),
    clientName: String(clientName || ''),
    addedBy: String(addedBy || ''),
    triggeredBy: String(triggeredBy || ''),
    triggeredSource,
    metadata,
  };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message })
    });

    const bodyText = await response.text().catch(() => '');
    if (!response.ok) {
      await DiscordReminderLogModel.create({
        ...baseLog,
        status: 'failed',
        responseStatus: response.status,
        responseText: bodyText || '',
        error: `${tag} Discord webhook failed (${response.status} ${response.statusText}) ${bodyText}`.trim(),
      });
      throw new Error(`${tag} Discord webhook failed (${response.status} ${response.statusText}) ${bodyText}`.trim());
    }

    await DiscordReminderLogModel.create({
      ...baseLog,
      status: 'sent',
      responseStatus: response.status,
      responseText: bodyText || '',
    });
  } catch (error) {
    const messageText = error?.message || String(error);
    const alreadyLogged = messageText.includes('Discord webhook failed');
    if (!alreadyLogged) {
      await DiscordReminderLogModel.create({
        ...baseLog,
        status: 'failed',
        error: messageText,
      });
    }
    throw error;
  }
}

// Sunday is a no-send day for both reminders (job card saved-column +
// zero-saved). Operations team requested no Discord pings on weekends so
// recruiters aren't pinged outside working days. Asia/Kolkata governs
// "Sunday" — the cron itself runs in IST already.
function isISTSunday(now = new Date()) {
  const day = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short' }).format(now);
  return day === 'Sun';
}

async function runJobCardReminder() {
  if (!DISCORD_JOBCARD_REMINDER_WEBHOOK) return;
  if (isISTSunday()) {
    console.log('[JobCard Reminder] Skipping — Sunday (Asia/Kolkata)');
    return;
  }
  try {
    const savedByUser = await JobModel.aggregate([
      { $match: { currentStatus: { $regex: /save/i } } },
      { $addFields: { _userLower: { $toLower: { $trim: { input: { $ifNull: ['$userID', ''] } } } } } },
      { $match: { _userLower: { $ne: '' } } },
      { $group: { _id: '$_userLower', saved: { $sum: 1 } } },
      { $match: { saved: { $gt: 0 } } }
    ]);
    const userIDsWithSaved = (savedByUser || []).map((r) => (r._id || '').toLowerCase()).filter(Boolean);
    if (userIDsWithSaved.length === 0) return;

    const allJobs = await JobModel.find({
      $expr: {
        $in: [
          { $toLower: { $trim: { input: { $ifNull: ['$userID', ''] } } } },
          userIDsWithSaved
        ]
      }
    })
      .select('userID operatorName appliedDate timeline')
      .lean();
    const parseDateString = (dateStr) => {
      if (!dateStr) return null;
      try {
        const parts = String(dateStr).split('/');
        if (parts.length === 3) {
          const [d, m, y] = parts.map((n) => parseInt(n, 10));
          return new Date(y, m - 1, d);
        }
        return new Date(dateStr);
      } catch {
        return null;
      }
    };
    const lastAppliedByUser = new Map();
    for (const j of allJobs || []) {
      if (!j.appliedDate) continue;
      const displayName = resolveLastAppliedOperatorDisplayName(j);
      if (!displayName) continue;
      const email = (j.userID || '').toLowerCase();
      if (!email) continue;
      const d = parseDateString(j.appliedDate);
      if (!d) continue;
      const cur = lastAppliedByUser.get(email);
      if (!cur || d > cur.date) {
        lastAppliedByUser.set(email, {
          date: d,
          operatorName: displayName
        });
      }
    }

    const clients = await ClientModel.find({
      email: { $in: userIDsWithSaved },
      ...clientFilterActiveUnpaused()
    })
      .select('email name')
      .lean();
    const clientNameMap = new Map((clients || []).map((c) => [c.email.toLowerCase(), c.name || c.email]));
    const savedMap = new Map((savedByUser || []).map((r) => [r._id.toLowerCase(), r.saved]));

    // Carry today's ADD count alongside the backlog. On its own this message
    // creates a perverse incentive — it fires on saved > 0 and says "please
    // apply", so an operator who adds fewer cards is nagged less and reads that
    // as approval. Stating adds-against-target in the same line removes the
    // gap: working the backlog down no longer looks like a finished day.
    const jobCardAddStats = await computeClientAddStats({
      JobModel,
      ProfileModel: getProfileModel(),
      emails: (clients || []).map((c) => (c.email || '').toLowerCase()).filter(Boolean),
    }).catch((err) => {
      // Fail soft: the apply nag is still worth sending without the add line.
      console.error('[JobCard Reminder] add stats unavailable:', err?.message || err);
      return new Map();
    });

    let sentCount = 0;
    let failedCount = 0;
    for (const c of clients || []) {
      const email = (c.email || '').toLowerCase();
      if (!email) continue;
      const saved = savedMap.get(email) || 0;
      if (saved <= 0) continue;
      const lastApplied = lastAppliedByUser.get(email);
      const operatorName = lastApplied ? lastApplied.operatorName : 'Team';
      const clientName = clientNameMap.get(email) || email;
      const capitalizedOperator = capitalizeOperatorName(operatorName);
      const addStat = jobCardAddStats.get(email) || null;
      const addLine = addStat
        ? ` Added today: ${addStat.addedToday}/${addStat.dailyTarget}${addStat.isUnderTarget ? ` — ${addStat.addShortfall} short of target.` : ' — target met.'}`
        : '';
      const message = `Hi ${capitalizedOperator}, there are ${saved} job card(s) in saved column for ${clientName}'s dashboard, please apply.${addLine}`;
      try {
        await postDiscordReminder(DISCORD_JOBCARD_REMINDER_WEBHOOK, message, '[JobCard Reminder]', {
          reminderType: 'job_card',
          clientEmail: email,
          clientName,
          addedBy: capitalizedOperator,
          triggeredSource: 'cron',
          metadata: {
            savedCount: saved,
            addedToday: addStat?.addedToday ?? null,
            dailyTarget: addStat?.dailyTarget ?? null,
            addShortfall: addStat?.addShortfall ?? null,
          },
        });
        sentCount += 1;
      } catch (sendErr) {
        failedCount += 1;
        console.error(`❌ [JobCard Reminder] Failed for ${email}:`, sendErr?.message || sendErr);
      }
    }
    console.log(`📬 [JobCard Reminder] Sent ${sentCount}, failed ${failedCount} reminders for clients with saved jobs`);
  } catch (err) {
    console.error('❌ [JobCard Reminder] Error:', err);
  }
}

/** Discord rejects a message body over 2000 characters outright. */
const DISCORD_CONTENT_LIMIT = 1900;

/**
 * Pack lines into as few Discord messages as possible without splitting a line.
 * A line longer than the limit on its own is emitted alone and truncated, which
 * is strictly better than dropping it.
 */
function chunkDiscordLines(header, lines) {
  const chunks = [];
  let cur = header;
  for (const raw of lines) {
    const line = raw.length > DISCORD_CONTENT_LIMIT ? `${raw.slice(0, DISCORD_CONTENT_LIMIT - 1)}…` : raw;
    if (cur.length + 1 + line.length > DISCORD_CONTENT_LIMIT) {
      chunks.push(cur);
      cur = line;
    } else {
      cur = cur ? `${cur}\n${line}` : line;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/**
 * Daily add-shortfall report — the missing FLOOR.
 *
 * dailyCapGuard enforces a ceiling: it blocks job #31. Nothing enforced a
 * minimum, so an operator could add three jobs a day indefinitely and no code
 * path objected. Worse, both existing reminders keyed on the SAVED BACKLOG, so
 * adding less made Discord quieter — runJobCardReminder ("please apply") fires
 * on saved > 0, and runZeroSavedJobReminder fired only at exactly zero saved.
 *
 * This runs at 21:30 IST, thirty minutes before the 22:00 window closes, so an
 * operator who is short still has time to fix it rather than reading about it
 * the next morning when nothing can be done.
 *
 * Target is the SAME number dailyCapGuard enforces as the ceiling
 * (profile.targetJobCount, else 25). One number, so the report can never
 * disagree with the counter the extension shows the same operator.
 */
async function runAddShortfallReport({ triggeredSource = 'cron', triggeredBy = '' } = {}) {
  if (!DISCORD_ADD_SHORTFALL_WEBHOOK) {
    return { sentCount: 0, skipped: true, reason: 'DISCORD_ADD_SHORTFALL is not configured' };
  }
  if (isISTSunday()) {
    console.log('[Add Shortfall] Skipping — Sunday (Asia/Kolkata)');
    return { sentCount: 0, skipped: true, reason: 'Sunday no-send day (Asia/Kolkata)' };
  }
  try {
    const clients = await ClientModel.find(clientFilterActiveUnpaused())
      .select('email name operationsName dashboardTeamLeadName')
      .lean();
    if (!clients.length) {
      return { sentCount: 0, skipped: true, reason: 'No active and unpaused clients found' };
    }

    const emails = clients.map((c) => (c.email || '').toLowerCase()).filter(Boolean);
    const stats = await computeClientAddStats({ JobModel, ProfileModel: getProfileModel(), emails });

    const rows = clients
      .map((c) => {
        const email = (c.email || '').toLowerCase();
        if (!email) return null;
        const stat = stats.get(email) || emptyAddStat();
        return { email, name: c.name || email, ...stat };
      })
      .filter(Boolean);

    const short = rows
      .filter((r) => r.isUnderTarget)
      // Worst first: biggest shortfall, then longest silence. A team lead reads
      // the top of this list and stops, so the top must be the worst.
      .sort((a, b) => (b.addShortfall - a.addShortfall) || ((b.daysSinceLastAdd ?? 0) - (a.daysSinceLastAdd ?? 0)));

    const addedTotal = rows.reduce((n, r) => n + r.addedToday, 0);
    const windowDay = addWindowDayStamp();

    if (!short.length) {
      const message = `✅ **Add target met** — ${windowDay}\nAll ${rows.length} active clients hit their daily target. ${addedTotal} job cards added today.`;
      await postDiscordReminder(DISCORD_ADD_SHORTFALL_WEBHOOK, message, '[Add Shortfall]', {
        reminderType: 'add_shortfall',
        triggeredSource,
        triggeredBy,
        metadata: { windowDay, underTarget: 0, clients: rows.length, addedTotal },
      });
      return { sentCount: 1, underTarget: 0, clients: rows.length, addedTotal };
    }

    const header =
      `🔻 **Add shortfall** — ${windowDay} (window closes 22:00 IST)\n` +
      `${short.length} of ${rows.length} active clients are under target. ` +
      `${addedTotal} job cards added today.\n`;

    const lines = short.map((r) => {
      const who = r.todayOperators.length ? r.todayOperators.map(capitalizeOperatorName).join(', ') : 'nobody';
      const silence =
        r.daysSinceLastAdd == null ? ' · **never had a job card added**'
          : r.daysSinceLastAdd === 0 ? ''
            : ` · **no adds for ${r.daysSinceLastAdd}d**`;
      return `• ${r.name} — ${r.addedToday}/${r.dailyTarget} (${r.addFulfillmentPct}%) · today by: ${who}${silence}`;
    });

    let sentCount = 0;
    let failedCount = 0;
    for (const content of chunkDiscordLines(header, lines)) {
      try {
        await postDiscordReminder(DISCORD_ADD_SHORTFALL_WEBHOOK, content, '[Add Shortfall]', {
          reminderType: 'add_shortfall',
          triggeredSource,
          triggeredBy,
          metadata: { windowDay, underTarget: short.length, clients: rows.length, addedTotal },
        });
        sentCount += 1;
      } catch (sendErr) {
        failedCount += 1;
        console.error('❌ [Add Shortfall] Failed to post chunk:', sendErr?.message || sendErr);
      }
    }
    console.log(`📉 [Add Shortfall] ${short.length}/${rows.length} clients under target, ${addedTotal} added — ${sentCount} message(s) sent, ${failedCount} failed`);
    return { sentCount, failedCount, underTarget: short.length, clients: rows.length, addedTotal };
  } catch (err) {
    console.error('❌ [Add Shortfall] Error:', err);
    return { sentCount: 0, error: err?.message || String(err) };
  }
}

async function runZeroSavedJobReminder() {
  if (!DISCORD_ZERO_SAVED_WEBHOOK) {
    return { sentCount: 0, skipped: true, reason: 'DISCORD_ZERO_SAVED is not configured' };
  }
  if (isISTSunday()) {
    console.log('[Zero Saved Reminder] Skipping — Sunday (Asia/Kolkata)');
    return { sentCount: 0, skipped: true, reason: 'Sunday no-send day (Asia/Kolkata)' };
  }
  try {
    const activeUnpausedClients = await ClientModel.find(clientFilterActiveUnpaused())
      .select('email name')
      .lean();

    if (activeUnpausedClients.length === 0) {
      console.log('📬 [Zero Saved Reminder] No active and unpaused clients found');
      return { sentCount: 0, skipped: true, reason: 'No active and unpaused clients found' };
    }

    const clientEmails = activeUnpausedClients.map((c) => (c.email || '').toLowerCase()).filter(Boolean);

    const savedByUser = await JobModel.aggregate([
      { $match: { currentStatus: { $regex: /save/i } } },
      {
        $addFields: {
          _userLower: { $toLower: { $trim: { input: { $ifNull: ['$userID', ''] } } } }
        }
      },
      { $match: { _userLower: { $in: clientEmails } } },
      { $group: { _id: '$_userLower', saved: { $sum: 1 } } }
    ]);

    const savedMap = new Map((savedByUser || []).map((r) => [(r._id || '').toLowerCase(), r.saved || 0]));

    // Jobs ADDED in the live 22:00 IST window. This is the fix for the hole that
    // let under-delivery run unnoticed: the reminder used to fire only when the
    // saved column was at exactly ZERO, counted over ALL TIME. One stale card
    // left over from three weeks ago suppressed it permanently, so an operator
    // who added nothing today was silently indistinguishable from one who added
    // thirty. Nothing added today now trips it regardless of backlog.
    const addStatsToday = await computeClientAddStats({
      JobModel,
      ProfileModel: getProfileModel(),
      emails: clientEmails,
    });

    const lastAdderAgg = await JobModel.aggregate([
      {
        $addFields: {
          _userLower: { $toLower: { $trim: { input: { $ifNull: ['$userID', ''] } } } }
        }
      },
      { $match: { _userLower: { $in: clientEmails } } },
      { $sort: { _id: -1 } },
      {
        $group: {
          _id: '$_userLower',
          addedBy: { $first: '$addedBy' },
          operatorName: { $first: '$operatorName' },
          extensionCode: { $first: '$extensionCode' }
        }
      }
    ]);
    const lastAdderMap = new Map(
      (lastAdderAgg || []).map((r) => [(r._id || '').toLowerCase(), r])
    );

    const clientNameMap = new Map((activeUnpausedClients || []).map((c) => [c.email.toLowerCase(), c.name || c.email]));

    let sentCount = 0;
    let failedCount = 0;
    const failures = [];
    for (const client of activeUnpausedClients || []) {
      const email = (client.email || '').toLowerCase();
      if (!email) continue;

      const saved = savedMap.get(email) || 0;
      const addStat = addStatsToday.get(email) || emptyAddStat();
      // Two independent reasons to ping, either one is enough:
      //   • the saved column is empty, so there is nothing left to apply to
      //   • nothing has been ADDED today, whatever the backlog looks like
      const emptyColumn = saved === 0;
      const nothingAddedToday = addStat.addedToday === 0;
      if (!emptyColumn && !nothingAddedToday) continue;
      // A client already at their daily target cannot receive more today —
      // dailyCapGuard blocks add number target+1 using this same targetJobCount.
      // Asking for cards the system refuses is an alert nobody can action, and
      // unactionable alerts are what train a channel to be muted.
      if (addStat.addedToday >= addStat.dailyTarget) continue;

      const clientName = clientNameMap.get(email) || email;
      const adderRow = lastAdderMap.get(email);
      const adderLabel =
        formatLastJobAdderName({
          addedBy: adderRow?.addedBy,
          operatorName: adderRow?.operatorName,
          extensionCode: adderRow?.extensionCode
        }) || 'No job history yet';
      const silence = addStat.daysSinceLastAdd == null
        ? ' (no job card has ever been added)'
        : addStat.daysSinceLastAdd >= 1
          ? ` (nothing added for ${addStat.daysSinceLastAdd} day${addStat.daysSinceLastAdd === 1 ? '' : 's'})`
          : '';
      // Always state what WAS added this window. The old empty-column line read
      // "have zero jobs in their dashboard", which is wrong twice over: it
      // describes the SAVED QUEUE, not the dashboard (these clients routinely
      // hold hundreds of applied cards — Shubh Kamdar had 2118 the day he was
      // pinged for having "zero"), and it reads as "you have done nothing" to
      // an operator who had already added eight and applied all eight.
      const progress = `${addStat.addedToday}/${addStat.dailyTarget} added this window`;
      const message = emptyColumn
        ? `${clientName}: saved queue is empty — nothing left to apply to (${progress}). Please add job cards — last added by: ${adderLabel}${silence}`
        : `${clientName}: no job cards added this window (target ${addStat.dailyTarget}, ${saved} still sitting in saved) — last added by: ${adderLabel}${silence}`;

      try {
        await postDiscordReminder(DISCORD_ZERO_SAVED_WEBHOOK, message, '[Zero Saved Reminder]', {
          reminderType: 'zero_saved',
          clientEmail: email,
          clientName,
          addedBy: adderLabel,
          triggeredSource: 'cron',
          metadata: {
            savedCount: saved,
            addedToday: addStat.addedToday,
            dailyTarget: addStat.dailyTarget,
            daysSinceLastAdd: addStat.daysSinceLastAdd,
            trigger: emptyColumn ? 'empty_saved_column' : 'no_adds_today',
          },
        });
        sentCount += 1;
      } catch (sendErr) {
        failedCount += 1;
        failures.push({
          clientEmail: email,
          clientName,
          error: sendErr?.message || String(sendErr),
        });
      }
    }

    console.log(`📬 [Zero Saved Reminder] Sent ${sentCount}, failed ${failedCount} reminders for zero saved jobs`);
    return {
      sentCount,
      failedCount,
      failures,
      skipped: false,
      reason: null
    };
  } catch (err) {
    console.error('❌ [Zero Saved Reminder] Error:', err);
    throw err;
  }
}

app.post('/api/admin/trigger-add-shortfall-report', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const result = await runAddShortfallReport({
      triggeredSource: 'manual',
      triggeredBy: req.user?.email || '',
    });
    return res.status(200).json({
      success: true,
      message: 'Add shortfall report trigger executed',
      result
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to trigger add shortfall report',
      error: error?.message || String(error)
    });
  }
});

app.post('/api/admin/trigger-zero-saved-reminder', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const result = await runZeroSavedJobReminder();
    return res.status(200).json({
      success: true,
      message: 'Zero saved reminder trigger executed',
      result
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to trigger zero saved reminder',
      error: error?.message || String(error)
    });
  }
});

app.get('/api/admin/discord-reminder-logs', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const pageNum = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '5'), 10) || 5));
    const skip = (pageNum - 1) * limitNum;
    const reminderType = typeof req.query.reminderType === 'string' ? req.query.reminderType.trim() : '';
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';

    const query = {};
    if (['job_card', 'zero_saved', 'manual'].includes(reminderType)) query.reminderType = reminderType;
    if (['sent', 'failed'].includes(status)) query.status = status;

    const [logs, total] = await Promise.all([
      DiscordReminderLogModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      DiscordReminderLogModel.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      logs,
      total,
      page: pageNum,
      pageSize: limitNum,
      totalPages: Math.ceil(total / limitNum) || 0,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to load reminder logs' });
  }
});

app.post('/api/admin/discord-reminder-logs/:id/retry', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ success: false, error: 'Invalid id' });
    }
    const row = await DiscordReminderLogModel.findById(id).lean();
    if (!row) return res.status(404).json({ success: false, error: 'Reminder log not found' });

    const webhook =
      row.reminderType === 'job_card'
        ? DISCORD_JOBCARD_REMINDER_WEBHOOK
        : DISCORD_ZERO_SAVED_WEBHOOK;
    if (!webhook) {
      return res.status(400).json({
        success: false,
        error: `Webhook is not configured for ${row.reminderType}`,
      });
    }

    await postDiscordReminder(webhook, row.message, row.webhookTag || '[Reminder Retry]', {
      reminderType: row.reminderType || 'manual',
      clientEmail: row.clientEmail || '',
      clientName: row.clientName || '',
      addedBy: row.addedBy || '',
      triggeredBy: req.user?.email || '',
      triggeredSource: 'retry',
      metadata: {
        ...(row.metadata || {}),
        retryOf: String(row._id),
      },
    });

    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Retry failed' });
  }
});

// Sync clientNumber from Client model to OnboardingJob (Client is source of truth)
const syncClientNumbersToOnboardingJobs = async () => {
  const clients = await ClientModel.find({ clientNumber: { $ne: null } }).select('email clientNumber').lean();
  let updated = 0;
  for (const c of clients) {
    const result = await OnboardingJobModel.updateMany(
      { clientEmail: (c.email || '').toLowerCase() },
      { $set: { clientNumber: c.clientNumber } }
    );
    updated += result.modifiedCount || 0;
  }
  if (updated > 0) console.log(`📋 [Client Numbers] Synced ${updated} onboarding job(s) with clientNumber from Client model`);
  return updated;
};

/**
 * Daily incentive cron job — runs at 10:00 PM IST (16:30 UTC), when the day closes.
 * Counting window: yesterday 10:00 PM IST → today 10:00 PM IST (24 hours).
 * Calculates qualified clients (20+ jobs) per operator and upserts to DB.
 */
async function runDailyIncentiveSnapshot() {
  const dateYmd = todayIstYmd();
  console.log(`[Incentive Cron] Running daily incentive snapshot for ${dateYmd}`);

  try {
    // Day window = yesterday 10 PM IST → today 10 PM IST (24-hour window).
    // Matches the +2h offset used in the report aggregation.
    const prevDay = new Date(new Date(`${dateYmd}T00:00:00.000+05:30`).getTime() - 86400000);
    const prevYmd = prevDay.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const dayStart = new Date(`${prevYmd}T22:00:00.000+05:30`);
    const dayEnd = new Date(`${dateYmd}T21:59:59.999+05:30`);

    // Aggregate: per operator, per client, count jobs in this 24h (10 PM reset) window
    const results = await JobModel.aggregate([
      ...buildExtensionJobsParsedRangeStages({ start: dayStart, end: dayEnd }),
      {
        $addFields: {
          _clientKey: {
            $cond: [
              { $or: [{ $eq: ['$userID', null] }, { $eq: ['$userID', ''] }] },
              null,
              { $toLower: { $trim: { input: { $toString: '$userID' } } } },
            ],
          },
        },
      },
      { $match: { addedBy: { $nin: [null, ''] }, _clientKey: { $nin: [null, ''] } } },
      {
        $group: {
          _id: { addedBy: '$addedBy', client: '$_clientKey' },
          jobCount: { $sum: 1 },
        },
      },
      {
        $group: {
          _id: '$_id.addedBy',
          clients: {
            $push: {
              clientEmail: '$_id.client',
              jobCount: '$jobCount',
              qualified: { $gte: ['$jobCount', 20] },
            },
          },
          totalJobs: { $sum: '$jobCount' },
        },
      },
    ]).allowDiskUse(true);

    // Fetch complaints for today
    const todayComplaints = await ExtensionIncentiveComplaintModel.find({ dateYmd })
      .select('addedBy')
      .lean();
    const complaintOperators = new Set(todayComplaints.map((c) => c.addedBy));

    let upserted = 0;
    for (const row of results) {
      const addedBy = row._id;
      const qualifiedClients = countQualifiedClients(row.clients);
      const clientsHandled = row.clients.length;
      const metrics = getExtensionIncentiveMetrics(row.totalJobs, clientsHandled);
      const hasComplaint = complaintOperators.has(addedBy);
      const incentiveAmount = metrics.eligible && !hasComplaint ? metrics.incentiveAmount : 0;

      await ExtensionDailyIncentiveModel.findOneAndUpdate(
        { dateYmd, addedBy },
        {
          $set: {
            qualifiedClients,
            clientsHandled,
            totalJobs: row.totalJobs,
            avgJobsPerClient: metrics.avgJobsPerClient,
            incentiveAmount,
            clientBreakdown: row.clients.map((c) => ({
              clientEmail: c.clientEmail,
              jobCount: c.jobCount,
              qualified: c.jobCount >= 20,
            })),
            computedAt: new Date(),
          },
          $setOnInsert: {
            dateYmd,
            addedBy,
            status: 'approved',
          },
        },
        { upsert: true, new: true }
      );
      upserted++;
    }

    console.log(`[Incentive Cron] Upserted ${upserted} incentive records for ${dateYmd}`);
  } catch (error) {
    console.error('[Incentive Cron] Error:', error);
  }
}

async function recordMilestoneInMoveHistory(clientEmail, milestoneKey, sendResult, paymentEmail, snapshot = {}) {
  try {
    const meta = {
      type: milestoneKey,
      paymentEmail: paymentEmail || null,
      currentCount: snapshot.currentCount || 0,
      planCap: snapshot.planCap || 0,
      threshold: snapshot.threshold || 0,
      percent: snapshot.planCap ? Math.round((snapshot.currentCount / snapshot.planCap) * 100) : 0,
      status: sendResult?.success ? 'success' : (sendResult?.skipped ? 'skipped' : 'failed'),
      reason: sendResult?.reason || sendResult?.error || null
    };
    const action = sendResult?.success ? 'milestone_email_sent' : 'milestone_email_skipped';
    await addClientActionToJobMoveHistory(clientEmail, action, {
      email: 'system',
      name: 'Milestone bot',
      meta
    });
  } catch (e) {
    console.error('[milestone moveHistory] write failed:', e?.message);
  }
}

// Admin catch-up: for ALL active clients (paused included) with paymentEmail set,
// send ONE milestone email reflecting the highest reached threshold currently unsent.
// Lower already-reached milestones get marked sent without firing emails so
// future cron ticks won't re-spam.
async function runSendPreviousMilestones() {
  // Count active clients first so we can report how many were dropped at
  // the filter stage (active but no paymentEmail). Saves operator confusion
  // when processed << active total.
  const [activeTotal, activeMissingPaymentEmail, clients] = await Promise.all([
    ClientModel.countDocuments({ status: 'active' }),
    ClientModel.countDocuments({
      status: 'active',
      $or: [
        { paymentEmail: { $exists: false } },
        { paymentEmail: '' },
        { paymentEmail: null }
      ]
    }),
    ClientModel.find({
      status: 'active',
      paymentEmail: { $exists: true, $nin: ['', null] }
    }).lean()
  ]);

  // Bulk-fetch referrals so we don't N+1 below.
  const emails = clients.map((c) => (c.email || '').toLowerCase()).filter(Boolean);
  const referralUsers = await NewUserModel.find(
    { email: { $in: emails } },
    'email referrals'
  ).lean();
  const referralAddedByEmail = new Map();
  for (const u of referralUsers) {
    referralAddedByEmail.set((u.email || '').toLowerCase(), referralApplicationsFor(u.referrals));
  }

  let processed = 0;
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const details = [];
  // Aggregate breakdown for the UI summary card — guaranteed populated even
  // when individual `details` rows are skipped by an older deploy.
  const skipReasons = {
    no_plan_milestones: 0,
    below_all_thresholds: 0,
    all_reached_already_sent: 0,
    no_payment_email: 0,
    other: 0
  };

  for (const client of clients) {
    processed++;
    const referralAdded = referralAddedByEmail.get((client.email || '').toLowerCase()) || 0;
    const planCap = getEffectiveCap(client, referralAdded);
    const milestones = computeClientMilestones(client, referralAdded);
    if (!milestones.length) {
      skipped++;
      skipReasons.no_plan_milestones++;
      details.push({
        clientEmail: client.email,
        clientName: client.name || '',
        planType: client.planType || '',
        status: 'skipped',
        reason: 'no_plan_milestones'
      });
      continue;
    }

    const currentCount = await JobModel.countDocuments(milestoneCountFilter(client.email));
    const notified = client.milestonesNotified || {};

    const reached = milestones.filter((m) => currentCount >= m.threshold);

    // Treat completed as "needs send" if cap grew since last send.
    const reachedUnsent = reached.filter((m) => {
      const prev = notified[m.key];
      if (!prev?.sent) return true;
      if (m.type === 'completed' && typeof prev.cap === 'number' && prev.cap < m.threshold) return true;
      return false;
    });
    if (!reachedUnsent.length) {
      skipped++;
      const reason = reached.length === 0 ? 'below_all_thresholds' : 'all_reached_already_sent';
      skipReasons[reason]++;
      const lowestThreshold = milestones[0]?.threshold ?? null;
      details.push({
        clientEmail: client.email,
        clientName: client.name || '',
        planType: client.planType || '',
        status: 'skipped',
        reason,
        currentCount,
        planCap,
        lowestThreshold,
        reachedKeys: reached.map((m) => m.key),
        sentKeys: Object.entries(notified).filter(([, v]) => v?.sent).map(([k]) => k)
      });
      continue;
    }

    const highest = reachedUnsent.reduce((a, b) => (a.threshold > b.threshold ? a : b));

    const sendResult = await sendMilestoneEmail({
      client,
      type: highest.type,
      milestoneKey: highest.key,
      snapshot: { planCap, currentCount, threshold: highest.threshold }
    });

    const setOps = {};
    for (const m of reachedUnsent) {
      setOps[`milestonesNotified.${m.key}.sent`] = true;
      setOps[`milestonesNotified.${m.key}.at`] = new Date();
      setOps[`milestonesNotified.${m.key}.count`] = currentCount;
      if (m.type === 'completed') setOps[`milestonesNotified.${m.key}.cap`] = m.threshold;
    }
    await ClientModel.updateOne({ email: client.email }, { $set: setOps });

    await recordMilestoneInMoveHistory(client.email, highest.key, sendResult, client.paymentEmail, { currentCount, planCap, threshold: highest.threshold });
    for (const m of reachedUnsent) {
      if (m.key === highest.key) continue;
      await recordMilestoneInMoveHistory(client.email, m.key, { skipped: true, reason: 'caught_up_via_send_previous' }, client.paymentEmail, { currentCount, planCap, threshold: m.threshold });
    }

    if (sendResult?.success) sent++;
    else if (sendResult?.skipped) { skipped++; skipReasons.other++; }
    else failed++;

    details.push({
      clientEmail: client.email,
      clientName: client.name || '',
      planType: client.planType || '',
      currentCount,
      sentMilestone: highest.key,
      sentMilestoneThreshold: highest.threshold,
      caughtUp: reachedUnsent.filter((m) => m.key !== highest.key).map((m) => m.key),
      status: sendResult?.success ? 'sent' : (sendResult?.skipped ? 'skipped' : 'failed'),
      error: sendResult?.error || sendResult?.reason || null
    });
  }

  return {
    processed,
    sent,
    skipped,
    failed,
    details,
    skipReasons,
    activeTotal,
    activeMissingPaymentEmail
  };
}

/**
 * In-process overlap lock — if previous sweep is still running when the next
 * cron tick fires, skip the tick. Single-instance assumption (one process).
 * For multi-instance deploys, replace with a Mongo TTL lock.
 */
let _milestoneSweepRunning = false;

/**
 * Daily 9 PM IST sweep. Sends to all ACTIVE, NON-PAUSED clients with
 * paymentEmail set whose milestone thresholds are reached. Paused clients
 * (isPaused === true) are excluded. Per-client try/catch so one bad row
 * does not abort the whole sweep. Returns { processed, sent, failed, skipped,
 * details } so the on-demand admin endpoint can surface results.
 *
 * Re-fires `completed` milestone when effective cap grows (addon / referral
 * added after a previous completion). Backfills legacy records without a
 * stored cap silently so first deploy does not double-send.
 */
async function runClientMilestoneCron({ trigger = 'cron', verbose = false } = {}) {
  if (_milestoneSweepRunning) {
    console.warn(`[Client Milestones] sweep skipped (trigger=${trigger}) — previous run still active`);
    return { processed: 0, sent: 0, failed: 0, skipped: 0, errors: 0, details: [], skippedReason: 'sweep_already_running' };
  }
  _milestoneSweepRunning = true;
  const startedAt = Date.now();
  console.log(`[Client Milestones] sweep start (trigger=${trigger})`);
  const summary = { processed: 0, sent: 0, failed: 0, skipped: 0, errors: 0, details: [] };
  try {
    // Milestone emails fire regardless of client status: Inactive and Paused
    // clients still receive them. The only requirement is a recipient address
    // (paymentEmail) — without it there's nowhere to send.
    const clients = await ClientModel.find({
      paymentEmail: { $exists: true, $ne: '' }
    }).lean();
    console.log(`[Client Milestones] candidate clients: ${clients.length}`);

    // Bulk-fetch referrals once so per-client loop doesn't N+1 the DB.
    const emails = clients.map((c) => (c.email || '').toLowerCase()).filter(Boolean);
    const referralUsers = await NewUserModel.find(
      { email: { $in: emails } },
      'email referrals'
    ).lean();
    const referralAddedByEmail = new Map();
    for (const u of referralUsers) {
      referralAddedByEmail.set((u.email || '').toLowerCase(), referralApplicationsFor(u.referrals));
    }

    for (const client of clients) {
      summary.processed++;
      try {
        const referralAdded = referralAddedByEmail.get((client.email || '').toLowerCase()) || 0;
        const planCap = getEffectiveCap(client, referralAdded);
        const milestones = computeClientMilestones(client, referralAdded);
        if (!milestones.length) {
          summary.skipped++;
          if (verbose) summary.details.push({ clientEmail: client.email, reason: 'no_plan_milestones' });
          continue;
        }

        const currentCount = await JobModel.countDocuments(milestoneCountFilter(client.email));
        const notified = client.milestonesNotified || {};

        for (const m of milestones) {
          const prev = notified[m.key];
          if (prev?.sent) {
            // For `completed`, re-fire when effective cap grew since last
            // send (addon / referral added). Legacy records without `cap`
            // get backfilled silently — no spam.
            if (m.type === 'completed') {
              if (typeof prev.cap !== 'number') {
                // Backfill legacy record using current threshold so we don't
                // re-send for a value that may have been the cap at send time.
                await ClientModel.updateOne(
                  { email: client.email },
                  { $set: { [`milestonesNotified.${m.key}.cap`]: m.threshold } }
                );
                if (verbose) summary.details.push({ clientEmail: client.email, milestone: m.key, reason: 'backfilled_cap', backfillCap: m.threshold });
                continue;
              }
              if (prev.cap >= m.threshold) {
                if (verbose) summary.details.push({ clientEmail: client.email, milestone: m.key, reason: 'already_sent_for_current_cap', cap: prev.cap });
                continue;
              }
              if (currentCount < m.threshold) {
                if (verbose) summary.details.push({ clientEmail: client.email, milestone: m.key, reason: 'cap_grew_but_below_new_threshold', currentCount, threshold: m.threshold, previousCap: prev.cap });
                continue;
              }
              console.log(`[Client Milestones] re-firing completed for ${client.email} — cap grew ${prev.cap} → ${m.threshold}`);
              // Fall through to send below.
            } else {
              if (verbose) summary.details.push({ clientEmail: client.email, milestone: m.key, reason: 'already_sent' });
              continue;
            }
          }
          if (currentCount < m.threshold) {
            if (verbose) summary.details.push({ clientEmail: client.email, milestone: m.key, reason: 'below_threshold', currentCount, threshold: m.threshold });
            continue;
          }
          // Fire on dashboard job count + active client only.
          // No gating on resumeSent / onboardingPhase / ticket status.

          const result = await sendMilestoneEmail({
            client,
            type: m.type,
            milestoneKey: m.key,
            snapshot: { planCap, currentCount, threshold: m.threshold }
          });

          // Only mark the milestone as sent when the send actually SUCCEEDED.
          // Previously this was unconditional, so a failed send (e.g.
          // invalid_grant) was recorded as `sent` and never retried — showing
          // "Sent" in the UI while the client got nothing. On failure we leave
          // it unsent so the next sweep (or a manual resend) tries again.
          if (result?.success) {
            const setOps = {
              [`milestonesNotified.${m.key}.sent`]: true,
              [`milestonesNotified.${m.key}.at`]: new Date(),
              [`milestonesNotified.${m.key}.count`]: currentCount
            };
            // Snapshot effective cap on the completed record so the next addon
            // top-up triggers a re-fire (and only one re-fire per cap level).
            if (m.type === 'completed') setOps[`milestonesNotified.${m.key}.cap`] = m.threshold;

            await ClientModel.updateOne(
              { email: client.email },
              { $set: setOps }
            );
          }
          await recordMilestoneInMoveHistory(client.email, m.key, result, client.paymentEmail, { currentCount, planCap, threshold: m.threshold });

          if (result?.success) {
            summary.sent++;
            console.log(`[Client Milestones] sent ${m.key} → ${client.paymentEmail} (count=${currentCount}/${planCap})`);
            summary.details.push({ clientEmail: client.email, milestone: m.key, status: 'sent', currentCount, planCap });
          } else if (result?.skipped) {
            summary.skipped++;
            summary.details.push({ clientEmail: client.email, milestone: m.key, status: 'skipped', reason: result?.reason || 'unknown' });
          } else {
            summary.failed++;
            summary.details.push({ clientEmail: client.email, milestone: m.key, status: 'failed', error: result?.error || 'unknown' });
          }
        }
      } catch (perClientErr) {
        summary.errors++;
        console.error(`[Client Milestones] client=${client.email} error:`, perClientErr?.message || perClientErr);
        summary.details.push({ clientEmail: client.email, status: 'error', error: perClientErr?.message || String(perClientErr) });
      }
    }
  } catch (error) {
    summary.errors++;
    console.error('[Client Milestones] sweep error:', error);
  } finally {
    _milestoneSweepRunning = false;
  }
  const tookMs = Date.now() - startedAt;
  console.log(`[Client Milestones] sweep done in ${tookMs}ms processed=${summary.processed} sent=${summary.sent} failed=${summary.failed} skipped=${summary.skipped} errors=${summary.errors}`);

  // Post a beautified Discord summary. The daily 9 PM runs (cron / external-cron)
  // ALWAYS post — a heartbeat even on quiet days ("no milestone emails due") and
  // on errors. Other triggers (boot redeploy, admin) stay quiet on no-op runs.
  // Never let a notification failure affect the sweep result.
  try {
    const sender = await getActiveGmailSender();
    const isDaily = trigger === 'cron' || trigger === 'external-cron';
    await notifyMilestoneSweep({ ...summary, tookMs }, { trigger, senderEmail: sender?.email, always: isDaily });
  } catch (e) {
    console.error('[Client Milestones] discord summary failed:', e?.message || e);
  }

  return { ...summary, tookMs };
}

// Start HTTP server only after MongoDB is connected (prevents startup tasks from hitting buffer timeout)
dbReady
  .then(async () => {
    // cleanupSessionKeys must not abort the chain — if it throws, cron
    // registration below would silently skip. Isolate failure.
    try {
      await cleanupSessionKeys();
    } catch (e) {
      console.error('❌ [Startup] cleanupSessionKeys failed (continuing):', e?.message || e);
    }

    app.listen(process.env.PORT, () => {
      console.log(`✅ Server is live at port: ${process.env.PORT}`);
      console.log(`📡 Dashboard Backend URL: ${FLASHFIRE_API_BASE_URL}`);

      // NOTE: any synchronous throw in the startup steps below would abort the
      // rest of this listen callback — including the milestone cron
      // registration further down. Each step is isolated so one failure can
      // never silently prevent the cron from scheduling.

      // Sync client numbers on startup (Client model → OnboardingJob)
      try {
        syncClientNumbersToOnboardingJobs().catch((err) =>
          console.error('❌ [Client Numbers] Startup sync error:', err)
        );
      } catch (e) {
        console.error('❌ [Startup] syncClientNumbersToOnboardingJobs threw:', e?.message || e);
      }

      // Start the automated call sweep job
      try {
        startCallSweepJob();
      } catch (e) {
        console.error('❌ [Startup] startCallSweepJob threw:', e?.message || e);
      }

      // Job card reminder: 8:00 PM IST daily.
      // Was '30 14 * * *' with NO timezone, i.e. 14:30 in whatever zone the host
      // happens to run in. That is 8:00 PM IST only while the host is UTC — an
      // unstated dependency that every other cron in this file declares
      // explicitly. Same firing instant on a UTC host, correct on any other.
      if (DISCORD_JOBCARD_REMINDER_WEBHOOK) {
        cron.schedule('0 20 * * *', runJobCardReminder, { timezone: 'Asia/Kolkata' });
        console.log('📬 [JobCard Reminder] Cron scheduled for 8:00 PM IST daily');
      }

      // Zero saved jobs reminder: 1:30 PM IST daily
if (DISCORD_ZERO_SAVED_WEBHOOK) {
  cron.schedule('30 13 * * *', runZeroSavedJobReminder, { timezone: 'Asia/Kolkata' });
  console.log('📬 [Zero Saved Reminder] Cron scheduled for 1:30 PM IST daily');
} else {
  console.warn('⚠️ [Zero Saved Reminder] DISCORD_ZERO_SAVED is not set; reminders are disabled');
}

// Add shortfall report: 9:30 PM IST daily, THIRTY MINUTES before the 22:00 IST
// add window closes. The timing is the point — an operator who is short can
// still fix it. Running it after the window rolls would only report a day that
// is already lost, and an alert nobody can act on gets muted.
if (DISCORD_ADD_SHORTFALL_WEBHOOK) {
  cron.schedule('30 21 * * *', runAddShortfallReport, { timezone: 'Asia/Kolkata' });
  console.log('📉 [Add Shortfall] Cron scheduled for 9:30 PM IST daily');
} else {
  console.warn('⚠️ [Add Shortfall] DISCORD_ADD_SHORTFALL is not set; the daily shortfall report is disabled');
}

      // Daily incentive snapshot: 10:00 PM IST — when the add window closes.
      // Same latent host-timezone dependency as the job card reminder above;
      // stated explicitly here rather than assumed. 16:30 UTC == 22:00 IST, so
      // this is the same instant on the current host.
      cron.schedule('0 22 * * *', runDailyIncentiveSnapshot, { timezone: 'Asia/Kolkata' });
      console.log('📬 [Incentive Cron] Scheduled for 10:00 PM IST daily');

      // Client milestone email cron: once daily at 9:00 PM IST (21:00 Asia/Kolkata).
      // node-cron v4 — `scheduled: true` is default, but set explicit for clarity.
      // Registration is isolated: if node-cron throws here it must NOT take down
      // the boot sweep below. NOTE: in-process node-cron only ticks while THIS
      // instance is awake. On hosts that suspend idle web services, the external
      // trigger (GET/POST /api/internal/run-milestone-cron), fired by the GitHub
      // Actions workflow at 15:30 UTC = 9 PM IST, is the reliable path.
      try {
        const milestoneTask = cron.schedule(
          '0 21 * * *',
          () => {
            console.log('[Client Milestones] cron tick firing', new Date().toISOString());
            runClientMilestoneCron({ trigger: 'cron' }).catch((e) => console.error('[Client Milestones] tick crashed:', e));
          },
          { timezone: 'Asia/Kolkata', scheduled: true }
        );
        console.log('📬 [Client Milestones] Cron scheduled daily 9:00 PM IST (0 21 * * * Asia/Kolkata)', { running: !!milestoneTask });
      } catch (e) {
        console.error('❌ [Client Milestones] cron registration failed:', e?.message || e);
      }
      // Boot-time catch-up sweep — closes the gap when service redeploys
      // mid-hour. Delayed 15s so DB warms + initial routes register first.
      setTimeout(() => {
        runClientMilestoneCron({ trigger: 'boot' }).catch((e) => console.error('[Client Milestones] boot run failed:', e));
      }, 15_000);

      // Auto-unpause New clients who have job cards: every 15 minutes.
      // The create hook in postJob already handles cards written through THIS
      // service. This sweep exists for the ones written by the dashboard
      // backend straight into the same collection, which never touch that
      // route — without it those clients would sit in New indefinitely.
      try {
        cron.schedule(
          '*/15 * * * *',
          () => {
            runAutoUnpauseSweep({ trigger: 'cron' })
              .catch((e) => console.error('[auto-unpause] sweep tick crashed:', e?.message || e));
          },
          { timezone: 'Asia/Kolkata' },
        );
        console.log(`🔄 [Auto-unpause] Cron scheduled every 15 minutes (threshold ${AUTO_UNPAUSE_MIN_JOB_CARDS} job cards)`);
      } catch (e) {
        console.error('❌ [Auto-unpause] cron registration failed:', e?.message || e);
      }
      // Boot-time catch-up, for the same reason the milestone cron has one:
      // in-process node-cron only ticks while this instance is awake, so a
      // redeploy or a suspended host would otherwise skip ticks silently.
      setTimeout(() => {
        runAutoUnpauseSweep({ trigger: 'boot' })
          .catch((e) => console.error('[auto-unpause] boot run failed:', e?.message || e));
      }, 20_000);

      // Chat: escalation sweep every 10 min (email tags unread 30m, admin ping 3h)
      try {
        cron.schedule('*/10 * * * *', runChatEscalationSweep, { timezone: 'Asia/Kolkata' });
        console.log('📬 [Chat Escalation] Cron scheduled every 10 minutes');
      } catch (e) {
        console.error('❌ [Chat Escalation] cron registration failed:', e?.message || e);
      }
      // Chat: admin daily digest at 9:00 AM IST
      try {
        cron.schedule('0 9 * * *', runAdminDailyDigest, { timezone: 'Asia/Kolkata' });
        console.log('📬 [Admin Digest] Cron scheduled daily 9:00 AM IST');
      } catch (e) {
        console.error('❌ [Admin Digest] cron registration failed:', e?.message || e);
      }
      // Discord tag reminders: re-ping unresolved tags every 3h (sweep every 30 min)
      try {
        cron.schedule('*/30 * * * *', runTagDiscordReminders, { timezone: 'Asia/Kolkata' });
        console.log('📬 [Tag Reminders] Cron scheduled every 30 minutes');
      } catch (e) {
        console.error('❌ [Tag Reminders] cron registration failed:', e?.message || e);
      }
      // Client perks: permanently withdraw Upgrade and Refer n Earn from
      // clients who are inactive AND have had nothing added or applied for
      // PERKS_DORMANT_DAYS. Runs once a day; the flag is write-once, so a
      // missed run only delays the withdrawal, it never loses one.
      try {
        cron.schedule(
          '30 3 * * *',
          async () => {
            try {
              const res = await sweepDormantClientPerks({ ClientModel, JobModel });
              console.log(
                `🔒 [Client Perks] scanned ${res.scanned} inactive client(s), ` +
                `withdrew perks from ${res.flagged.length}, ` +
                `left ${res.skippedActive.length} alone for recent activity`
              );
            } catch (e) {
              console.error('❌ [Client Perks] sweep failed:', e?.message || e);
            }
          },
          { timezone: 'Asia/Kolkata' }
        );
        console.log(`🔒 [Client Perks] Cron scheduled daily 3:30 AM IST (${PERKS_DORMANT_DAYS}-day dormancy)`);
      } catch (e) {
        console.error('❌ [Client Perks] cron registration failed:', e?.message || e);
      }
    });
  })
  .catch((err) => {
    // ConnectDB already logged and process.exit(1) on failure — log again
    // so silent swallowing of cron registration is obvious in deploy logs.
    console.error('❌ [Startup] dbReady chain failed:', err?.message || err);
  });

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully...');
  if (callSweepInterval) {
    clearInterval(callSweepInterval);
  }
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully...');
  if (callSweepInterval) {
    clearInterval(callSweepInterval);
  }
  process.exit(0);
});
