import { OnboardingJobModel, ONBOARDING_STATUSES_LIST } from '../OnboardingJobModel.js';
import { JobModel } from '../JobModel.js';
import { OnboardingJobCounterModel } from '../OnboardingJobCounterModel.js';
import { ClientCounterModel } from '../ClientCounterModel.js';
import { OnboardingNotificationModel } from '../OnboardingNotificationModel.js';
import { UserModel } from '../UserModel.js';
import { ClientModel } from '../ClientModel.js';
import { ManagerModel } from '../ManagerModel.js';
import OperationsModel from '../OperationsModel.js';
import { NewUserModel } from '../schema_models/UserModel.js';
import { sendChatMessageInternal, emitToUsers } from './chatController.js';
import { sendTagNotificationEmail } from '../utils/sendTagNotificationEmail.js';
import { sendTagDiscordPing } from '../utils/tagDiscordNotify.js';
import { TagReminderModel } from '../TagReminderModel.js';
import { sendMilestoneEmail } from '../utils/clientMilestoneEmails.js';
import { getPlanCap, MIN_JOBS_FOR_EMAIL } from '../utils/planCaps.js';
import { clearAnalysisCache } from '../utils/analysisCache.js';
import { useServerMemoryCache } from '../utils/serverMemoryCache.js';

const ONBOARDING_MEMORY_CACHE_ENABLED = useServerMemoryCache();

// When true, all resume-maker assignments go to rachna077@gmail.com (no round-robin) remevee this later
const rachana = true;
const RACHANA_EMAIL = 'rachna077@gmail.com';

// ---------------------------------------------------------------------------
// Simple in-process TTL cache — avoids redundant DB round-trips
// ---------------------------------------------------------------------------
const createTTLCache = (defaultTtlMs) => {
  const store = new Map();
  return {
    get(key) {
      const entry = store.get(key);
      if (!entry) return null;
      if (Date.now() > entry.exp) { store.delete(key); return null; }
      return entry.val;
    },
    set(key, val, ttlMs = defaultTtlMs) {
      store.set(key, { val, exp: Date.now() + ttlMs });
    },
    del(key) { store.delete(key); },
    clear() { store.clear(); }
  };
};

// 5 s TTL for the Kanban board list (invalidated on every write)
const jobListCache = createTTLCache(5_000);
// 60 s TTL for user roles (changes only when admin updates users)
const rolesCache   = createTTLCache(60_000);
// 30 s TTL for job detail (dashboard details modal) — instant reopen, invalidated on patch
const jobDetailCache = createTTLCache(30_000);
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS = {
  resume_in_progress: ['resume_draft_done'],
  resume_draft_done: ['resume_in_review'],
  resume_in_review: ['resume_approved'],
  resume_approved: ['linkedin_in_progress'],
  linkedin_in_progress: ['linkedin_done'],
  linkedin_done: ['cover_letter_in_progress', 'applications_ready'],
  cover_letter_in_progress: ['cover_letter_done'],
  cover_letter_done: ['applications_ready'],
  applications_ready: ['applications_in_progress'],
  applications_in_progress: ['completed'],
  completed: []
};

/**
 * Add client-level action (pause/unpause/New phase) to the job's move history for audit.
 * movedByPayload: string (email) or { email, name }.
 */
export async function addClientActionToJobMoveHistory(clientEmail, actionType, movedByPayload) {
  if (!clientEmail || !actionType) return;
  const job = await OnboardingJobModel.findOne({ clientEmail: (clientEmail || '').toLowerCase().trim() });
  if (!job) return;
  const email = typeof movedByPayload === 'string' ? (movedByPayload || 'unknown') : (movedByPayload?.email || 'unknown');
  const name = typeof movedByPayload === 'string' ? '' : (movedByPayload?.name || '');
  const meta = (typeof movedByPayload === 'object' && movedByPayload?.meta) ? movedByPayload.meta : null;
  if (!job.moveHistory) job.moveHistory = [];
  const entry = {
    actionType,
    movedBy: email,
    movedByName: name,
    movedAt: new Date()
  };
  if (meta) entry.meta = meta;
  job.moveHistory.push(entry);
  await job.save();
  jobListCache.clear();
}

export async function getNextJobNumber() {
  const counter = await OnboardingJobCounterModel.findOneAndUpdate(
    { _id: 'onboarding_job_number' },
    { $inc: { lastNumber: 1 } },
    { new: true, upsert: true }
  );
  return counter.lastNumber;
}

const CLIENT_NUMBER_FLOOR = 5809;

export async function getNextClientNumber() {
  // Ensure the counter document exists with at least the floor value, then increment.
  // Cannot combine $max and $inc on the same field in one MongoDB update.
  await ClientCounterModel.updateOne(
    { _id: 'client_number' },
    { $setOnInsert: { lastNumber: CLIENT_NUMBER_FLOOR - 1 } },
    { upsert: true }
  );
  // If the existing value is below floor, bring it up first.
  await ClientCounterModel.updateOne(
    { _id: 'client_number', lastNumber: { $lt: CLIENT_NUMBER_FLOOR - 1 } },
    { $set: { lastNumber: CLIENT_NUMBER_FLOOR - 1 } }
  );
  const counter = await ClientCounterModel.findOneAndUpdate(
    { _id: 'client_number' },
    { $inc: { lastNumber: 1 } },
    { new: true }
  );
  return counter.lastNumber;
}

export async function previewNextClientNumber() {
  const counter = await ClientCounterModel.findOne({ _id: 'client_number' }).lean();
  const current = counter?.lastNumber || (CLIENT_NUMBER_FLOOR - 1);
  return Math.max(current + 1, CLIENT_NUMBER_FLOOR);
}

export async function getCurrentClientNumber() {
  const counter = await ClientCounterModel.findOne({ _id: 'client_number' }).lean();
  const current = counter?.lastNumber || (CLIENT_NUMBER_FLOOR - 1);
  return Math.max(current, CLIENT_NUMBER_FLOOR - 1);
}

export async function getNextResumeMaker() {
  if (rachana) {
    return { email: RACHANA_EMAIL.toLowerCase(), name: 'Rachana' };
  }
  const users = await UserModel.find({
    role: 'onboarding_team',
    onboardingSubRole: 'resume_maker',
    isActive: true
  })
    .sort({ lastResumeAssignedAt: 1 })
    .limit(1)
    .lean();
  if (!users.length) return null;
  const u = users[0];
  await UserModel.updateOne(
    { _id: u._id },
    { $set: { lastResumeAssignedAt: new Date() } }
  ).catch(() => {});
  return { email: u.email, name: u.name || u.email };
}

export async function getNextLinkedInMember() {
  const users = await UserModel.find({
    role: 'onboarding_team',
    onboardingSubRole: 'linkedin_and_cover_letter_optimization',
    isActive: true
  })
    .sort({ lastLinkedInAssignedAt: 1 })
    .limit(1)
    .lean();
  if (!users.length) return null;
  const u = users[0];
  await UserModel.updateOne(
    { _id: u._id },
    { $set: { lastLinkedInAssignedAt: new Date() } }
  ).catch(() => {});
  return { email: u.email, name: u.name || u.email };
}

const SYSTEM_AUTO_COMMENT_AUTHOR_EMAIL = 'system-auto@flashfire-clients-tracking.internal';
/** Notify when pipeline job-card count (saved+applied+interviewing+offer) reaches this; covers applied+saved-only and “whole” board. */
const HIGH_APPLIED_JOBS_THRESHOLD = 10;

/**
 * For each analysis row that reaches the job-card threshold, ensure the matching onboarding ticket
 * has a single system comment tagging the dashboard manager. Runs when client-job-analysis is computed.
 */
export async function runHighAppliedJobsNotifications(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return;

  for (const row of rows) {
    const saved = Number(row.saved) || 0;
    const applied = Number(row.applied) || 0;
    const interviewing = Number(row.interviewing) || 0;
    const offer = Number(row.offer) || 0;
    const pipelineJobCards = saved + applied + interviewing + offer;
    if (pipelineJobCards < HIGH_APPLIED_JOBS_THRESHOLD) continue;

    const clientEmail = (row.email || '').toLowerCase().trim();
    if (!clientEmail) continue;

    const jobPreview = await OnboardingJobModel.findOne({ clientEmail })
      .select('dashboardManagerName')
      .lean();
    if (!jobPreview) continue;

    const dmName = (
      (jobPreview.dashboardManagerName || '').trim() ||
      (row.dashboardTeamLeadName || '').trim()
    );
    if (!dmName) continue;

    const manager = await ManagerModel.findOne({ fullName: dmName, isActive: true }).select('email').lean();
    const dmEmail = (manager?.email || '').toLowerCase().trim();
    if (!dmEmail) continue;

    const now = new Date();
    const body = `@${dmEmail} inform the client, jobs are being added`;
    const commentDoc = {
      body,
      authorEmail: SYSTEM_AUTO_COMMENT_AUTHOR_EMAIL,
      authorName: 'System',
      taggedUserIds: [dmEmail],
      taggedNames: [dmName],
      images: [],
      createdAt: now
    };

    const updated = await OnboardingJobModel.findOneAndUpdate(
      { clientEmail, highAppliedJobsNoticeAt: null },
      {
        $push: { comments: commentDoc },
        $set: { highAppliedJobsNoticeAt: now, updatedAt: now }
      },
      { new: true }
    );

    if (!updated) continue;

    jobListCache.clear();
    jobDetailCache.del(`job:${updated._id}`);

    try {
      const commentSnippet = body.slice(0, 120);
      await OnboardingNotificationModel.create({
        userEmail: dmEmail,
        jobId: updated._id,
        jobNumber: updated.jobNumber,
        clientNumber: updated.clientNumber ?? null,
        clientName: updated.clientName || 'Client',
        commentSnippet,
        authorEmail: SYSTEM_AUTO_COMMENT_AUTHOR_EMAIL,
        authorName: 'System',
        read: false
      });
      // Chat DM + immediate email to OTP mail + Discord ping (same fan-out as
      // a user tag; repeating reminders handled by the tag-reminder cron).
      sendChatMessageInternal({
        fromEmail: SYSTEM_AUTO_COMMENT_AUTHOR_EMAIL,
        fromName: 'System',
        toEmail: dmEmail,
        toName: dmName,
        text: body,
        ticket: {
          jobId: updated._id,
          jobNumber: updated.jobNumber,
          clientName: updated.clientName || '',
          clientNumber: updated.clientNumber ?? null
        },
        source: 'tag',
        emailHandled: true
      });
      const dmUser = await UserModel.findOne({ email: dmEmail })
        .select('email otpEmail name discordWebhookUrl')
        .lean();
      sendTagNotificationEmail({
        toEmail: (dmUser?.otpEmail || '').trim() || dmEmail,
        recipientName: dmName,
        authorName: 'System',
        commentSnippet,
        jobNumber: updated.jobNumber,
        clientName: updated.clientName || '',
        clientNumber: updated.clientNumber ?? null,
        jobId: String(updated._id)
      }).catch(() => {});
      if (dmUser?.discordWebhookUrl) {
        sendTagDiscordPing({
          webhookUrl: dmUser.discordWebhookUrl,
          recipientName: dmName,
          authorName: 'System',
          snippet: commentSnippet,
          clientName: updated.clientName || '',
          clientNumber: updated.clientNumber ?? null,
          jobNumber: updated.jobNumber
        }).catch(() => {});
      }
      emitToUsers([dmEmail], 'notify', {
        kind: 'tag',
        jobId: String(updated._id),
        jobNumber: updated.jobNumber,
        clientName: updated.clientName || 'Client',
        authorName: 'System',
        commentSnippet
      });
    } catch (e) {
      console.error('[runHighAppliedJobsNotifications] notify error:', e?.message || e);
    }
  }
}

export async function createOnboardingJobPayload(payload) {
  const jobNumber = await getNextJobNumber();
  const clientNumber = payload.clientNumber != null ? payload.clientNumber : await getNextClientNumber();
  const nextResume = await getNextResumeMaker();
  const createdBy = (payload.createdBy || '').trim() || 'system';
  const createdByName = (payload.createdByName || '').trim() || '';
  const doc = {
    jobNumber,
    clientNumber,
    clientEmail: (payload.clientEmail || '').toLowerCase().trim(),
    clientName: payload.clientName || '',
    planType: payload.planType || 'Professional',
    status: 'resume_in_progress',
    dashboardManagerName: payload.dashboardManagerName || '',
    dashboardDetailsCompletedAt: (payload.dashboardManagerName || '').trim() ? new Date() : null,
    bachelorsStartDate: payload.bachelorsStartDate || '',
    mastersEndDate: payload.mastersEndDate || '',
    dashboardCredentials: payload.dashboardCredentials || { username: '', password: '', loginUrl: '' },
    csmEmail: payload.csmEmail || '',
    csmName: payload.csmName || '',
    resumeMakerEmail: (nextResume?.email || '').toLowerCase(),
    resumeMakerName: nextResume?.name || '',
    attachments: [],
    comments: [],
    moveHistory: [{ fromStatus: 'created', toStatus: 'resume_in_progress', movedBy: createdBy, movedByName: createdByName, movedAt: new Date() }]
  };
  const job = await OnboardingJobModel.create(doc);
  return job;
}

// Fields needed for Kanban card display (excludes heavy arrays loaded on card open)
// moveHistory excluded — only needed in getOnboardingJobById (detail modal)
// attachments trimmed to names only in send step for card step-status badges
const LIST_PROJECTION = 'jobNumber clientNumber clientEmail clientName planType status ' +
  'resumeMakerEmail resumeMakerName linkedInMemberEmail linkedInMemberName ' +
  'operatorEmail operatorName csmEmail csmName dashboardManagerName taggedDashboardManagerNames linkedInPhaseStarted adminUnreadCount pendingMoveRequest ' +
  'dashboardDetailsCompletedAt applicationsCompletedAt profileComplete createdAt updatedAt attachments';

export async function listOnboardingJobs(req, res) {
  try {
    const { status } = req.query || {};
    const filter = {};
    if (status && ONBOARDING_STATUSES_LIST.includes(status)) filter.status = status;

    const userRole = req.user?.role || '';
    const isTeamLead = userRole === 'team_lead';

    // For team leads: resolve effective manager name (linked dashboard manager or user name)
    let effectiveManagerName = '';
    if (isTeamLead) {
      const userEmail = (req.user?.email || '').toLowerCase().trim();
      if (userEmail) {
        const dbUser = await UserModel.findOne({ email: userEmail }).select('linkedDashboardManagerName name').lean();
        effectiveManagerName = ((dbUser?.linkedDashboardManagerName || dbUser?.name || req.user?.name || '').trim()).toLowerCase();
      }
    }

    const sendJobsForUser = (jobs) => {
      let visibleJobs = jobs;

      // Team Leads (and dashboard managers) see tickets where they are primary or tagged
      if (isTeamLead && effectiveManagerName) {
        visibleJobs = jobs.filter((job) => {
          const primary = (job.dashboardManagerName || '').trim().toLowerCase();
          const tagged = (job.taggedDashboardManagerNames || []).map((n) => (n || '').trim().toLowerCase()).filter(Boolean);
          return (primary && primary === effectiveManagerName) || tagged.includes(effectiveManagerName);
        });
      }

      return res.status(200).json({ jobs: visibleJobs });
    };

    // Serve from cache when available (5 s TTL, invalidated on any write). Off in prod multi-instance by default.
    const cacheKey = `jobs:${status || 'all'}`;
    const cached = ONBOARDING_MEMORY_CACHE_ENABLED ? jobListCache.get(cacheKey) : null;
    if (cached) {
      const cachedJobs = cached.jobs || [];
      return sendJobsForUser(cachedJobs);
    }

    // Fetch jobs with lightweight projection — heavy arrays loaded lazily on card open
    const jobs = await OnboardingJobModel.find(filter)
      .select(LIST_PROJECTION)
      .sort({ jobNumber: 1 })
      .lean();

    // Parallel: fetch client statuses AND manager emails at the same time
    const clientEmails = [...new Set(jobs.map(job => (job.clientEmail || '').toLowerCase()).filter(Boolean))];
    const managerNames = [...new Set(jobs.map(j => (j.dashboardManagerName || '').trim()).filter(Boolean))];

    // Batch: fetch earliest job card date per client from client dashboard (JobModel)
    const [clients, managers, firstJobAgg] = await Promise.all([
      clientEmails.length
        ? ClientModel.find({ email: { $in: clientEmails } }).select('email status isPaused onboardingPhase clientNumber pausedAt').lean()
        : Promise.resolve([]),
      managerNames.length
        ? ManagerModel.find({ fullName: { $in: managerNames }, isActive: true }).select('fullName email').lean()
        : Promise.resolve([]),
      clientEmails.length
        ? JobModel.aggregate([
            // Match userID directly against the (already-lowercased) clientEmails so
            // the { userID: 1 } index is used. The previous { $toLower: '$userID' }
            // in $addFields was computed per document and forced a full-collection
            // scan of every job. JobModel.userID is the client email, stored
            // lowercase in practice (same assumption as client-job-analysis).
            { $match: { userID: { $in: clientEmails } } },
            // $min on _id = earliest ObjectId per client (ObjectIds sort
            // chronologically). Avoids a 32MB-blowing $sort before $group.
            { $group: { _id: '$userID', firstObjId: { $min: '$_id' } } }
          ], { allowDiskUse: true })
        : Promise.resolve([])
    ]);

    const clientStatusMap = new Map(
      clients.map(c => [
        c.email.toLowerCase(),
        {
          status: c.status || 'active',
          isPaused: c.isPaused || false,
          onboardingPhase: c.onboardingPhase || false,
          clientNumber: c.clientNumber,
          pausedAt: c.pausedAt || null
        }
      ])
    );
    const managerEmailByName = new Map(managers.map(m => [m.fullName, m.email]));
    // Map: clientEmail → earliest job card creation date (from MongoDB ObjectId timestamp)
    const firstJobDateMap = new Map();
    for (const row of firstJobAgg) {
      if (row._id && row.firstObjId) {
        // Lowercase the key defensively so lookups by lowercased clientEmail match
        // even if a stored userID happens to differ in case.
        firstJobDateMap.set(String(row._id).toLowerCase(), row.firstObjId.getTimestamp());
      }
    }

    const now = new Date();
    const enrichedJobs = jobs.map(job => {
      const clientEmail = (job.clientEmail || '').toLowerCase();
      const clientInfo = clientStatusMap.get(clientEmail) || {
        status: 'active',
        isPaused: false,
        onboardingPhase: false,
        clientNumber: null,
        pausedAt: null
      };
      const dashboardManagerEmail = (job.dashboardManagerName && managerEmailByName.get(job.dashboardManagerName)) || '';
      const clientNumber = clientInfo.clientNumber != null ? clientInfo.clientNumber : job.clientNumber;
      const attachmentNames = (job.attachments || []).map(a => ({ name: a.name || '' }));
      const { attachments: _att, ...rest } = job;
      // Days = from the first job card added in client dashboard to now (or applicationsCompletedAt if completed).
      // Falls back to onboarding job createdAt if no job cards exist yet.
      const startDate = firstJobDateMap.get(clientEmail) || job.createdAt || now;
      let endDate = job.applicationsCompletedAt;
      if (!endDate && job.status === 'completed' && (job.moveHistory || []).length > 0) {
        const completedMove = job.moveHistory.find(m => m.toStatus === 'completed');
        if (completedMove?.movedAt) endDate = completedMove.movedAt;
      }
      if (!endDate) endDate = now;
      const daysInPipeline = Math.max(0, Math.floor((new Date(endDate) - new Date(startDate)) / (24 * 60 * 60 * 1000)));
      const pausedOnly = clientInfo.isPaused === true && clientInfo.onboardingPhase !== true;
      let clientPausedDays = null;
      if (pausedOnly && clientInfo.pausedAt) {
        clientPausedDays = Math.max(0, Math.floor((now - new Date(clientInfo.pausedAt)) / (24 * 60 * 60 * 1000)));
      }
      return {
        ...rest,
        attachments: attachmentNames,
        clientNumber,
        clientStatus: clientInfo.status,
        clientIsPaused: clientInfo.isPaused,
        clientPausedDays,
        dashboardManagerEmail,
        daysInPipeline
      };
    });

    const payload = { jobs: enrichedJobs };
    if (ONBOARDING_MEMORY_CACHE_ENABLED) jobListCache.set(cacheKey, payload);
    return sendJobsForUser(enrichedJobs);
  } catch (e) {
    console.error('listOnboardingJobs:', e);
    res.status(500).json({ error: e.message || 'Failed to list onboarding jobs' });
  }
}

/** Lightweight endpoint: returns only comments. Use with getOnboardingJobById?excludeComments=1 for parallel load. */
export async function getOnboardingJobComments(req, res) {
  try {
    const { id } = req.params;
    if (!id || !id.match(/^[0-9a-fA-F]{24}$/)) return res.status(400).json({ error: 'Invalid job ID' });
    const job = await OnboardingJobModel.findById(id).select('comments dashboardManagerName taggedDashboardManagerNames').lean();
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const userRole = req.user?.role || '';
    if (userRole === 'team_lead') {
      const userEmail = (req.user?.email || '').toLowerCase().trim();
      let effectiveManagerName = '';
      if (userEmail) {
        const dbUser = await UserModel.findOne({ email: userEmail }).select('linkedDashboardManagerName name').lean();
        effectiveManagerName = ((dbUser?.linkedDashboardManagerName || dbUser?.name || req.user?.name || '').trim()).toLowerCase();
      }
      const primary = (job.dashboardManagerName || '').trim().toLowerCase();
      const tagged = (job.taggedDashboardManagerNames || []).map((n) => (n || '').trim().toLowerCase()).filter(Boolean);
      const canView = (primary && primary === effectiveManagerName) || tagged.includes(effectiveManagerName);
      if (!effectiveManagerName || !canView) return res.status(403).json({ error: 'Not authorized' });
    }
    return res.status(200).json({ comments: job.comments || [] });
  } catch (e) {
    console.error('getOnboardingJobComments:', e);
    res.status(500).json({ error: e.message || 'Failed to fetch comments' });
  }
}

export async function getOnboardingJobById(req, res) {
  try {
    const { id } = req.params;
    const excludeComments = req.query?.excludeComments === '1';
    const cacheKey = `job:${id}`;
    let job = ONBOARDING_MEMORY_CACHE_ENABLED ? jobDetailCache.get(cacheKey) : null;
    if (job) {
      job = { ...job };
      const userRole = req.user?.role || '';
      if (userRole === 'team_lead') {
        const userEmail = (req.user?.email || '').toLowerCase().trim();
        let effectiveManagerName = '';
        if (userEmail) {
          const dbUser = await UserModel.findOne({ email: userEmail }).select('linkedDashboardManagerName name').lean();
          effectiveManagerName = ((dbUser?.linkedDashboardManagerName || dbUser?.name || req.user?.name || '').trim()).toLowerCase();
        }
        const primary = (job.dashboardManagerName || '').trim().toLowerCase();
        const tagged = (job.taggedDashboardManagerNames || []).map((n) => (n || '').trim().toLowerCase()).filter(Boolean);
        const canView = primary && primary === effectiveManagerName || tagged.includes(effectiveManagerName);
        if (!effectiveManagerName || !canView) {
          return res.status(403).json({ error: 'Not authorized to view this onboarding job' });
        }
      }
      const canSeeCredentials = req.user && (req.user.role === 'admin' || req.user.roles?.includes?.('csm'));
      if (!canSeeCredentials && job.dashboardCredentials?.password) {
        job.dashboardCredentials = { ...job.dashboardCredentials, password: '********' };
      }
      if (excludeComments) {
        const { comments: _c, ...rest } = job;
        return res.status(200).json({ job: rest });
      }
      return res.status(200).json({ job });
    }

    const query = OnboardingJobModel.findById(id);
    if (excludeComments) query.select('-comments');
    job = await query.lean();
    if (!job) return res.status(404).json({ error: 'Onboarding job not found' });

    // Restrict Team Leads to tickets where they are primary or tagged dashboard manager
    const userRole = req.user?.role || '';
    if (userRole === 'team_lead') {
      const userEmail = (req.user?.email || '').toLowerCase().trim();
      let effectiveManagerName = '';
      if (userEmail) {
        const dbUser = await UserModel.findOne({ email: userEmail }).select('linkedDashboardManagerName name').lean();
        effectiveManagerName = ((dbUser?.linkedDashboardManagerName || dbUser?.name || req.user?.name || '').trim()).toLowerCase();
      }
      const primary = (job.dashboardManagerName || '').trim().toLowerCase();
      const tagged = (job.taggedDashboardManagerNames || []).map((n) => (n || '').trim().toLowerCase()).filter(Boolean);
      const canView = (primary && primary === effectiveManagerName) || tagged.includes(effectiveManagerName);
      if (!effectiveManagerName || !canView) {
        return res.status(403).json({ error: 'Not authorized to view this onboarding job' });
      }
    }

    const canSeeCredentials = req.user && (req.user.role === 'admin' || req.user.roles?.includes?.('csm'));
    if (!canSeeCredentials && job.dashboardCredentials?.password) {
      job.dashboardCredentials = { ...job.dashboardCredentials, password: '********' };
    }

    const now = new Date();

    // Parallel: fetch client status + manager email at the same time
    const clientEmail = (job.clientEmail || '').toLowerCase();
    const [client, manager] = await Promise.all([
      clientEmail
        ? ClientModel.findOne({ email: clientEmail }).select('status isPaused onboardingPhase clientNumber pausedAt').lean()
        : Promise.resolve(null),
      job.dashboardManagerName
        ? ManagerModel.findOne({ fullName: job.dashboardManagerName, isActive: true }).select('email').lean()
        : Promise.resolve(null)
    ]);

    job.clientStatus = client?.status || 'active';
    job.clientIsPaused = client?.isPaused || false;
    const pausedOnlyDetail = job.clientIsPaused === true && client?.onboardingPhase !== true;
    job.clientPausedDays =
      pausedOnlyDetail && client?.pausedAt
        ? Math.max(0, Math.floor((now - new Date(client.pausedAt)) / (24 * 60 * 60 * 1000)))
        : null;
    job.dashboardManagerEmail = manager?.email || '';
    // Client model is source of truth for clientNumber
    if (client?.clientNumber != null) job.clientNumber = client.clientNumber;

    // Days = from the first job card added in client dashboard to now (or applicationsCompletedAt).
    const clientEmailLower = (job.clientEmail || '').toLowerCase();
    let firstJobDate = null;
    if (clientEmailLower) {
      const earliest = await JobModel.findOne({ userID: new RegExp(`^${clientEmailLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') })
        .sort({ _id: 1 }).select('_id').lean().catch(() => null);
      if (earliest?._id) {
        firstJobDate = earliest._id.getTimestamp();
      }
    }
    const startDate = firstJobDate || job.createdAt || now;
    let endDate = job.applicationsCompletedAt;
    if (!endDate && job.status === 'completed' && (job.moveHistory || []).length > 0) {
      const completedMove = job.moveHistory.find(m => m.toStatus === 'completed');
      if (completedMove?.movedAt) endDate = completedMove.movedAt;
    }
    if (!endDate) endDate = now;
    job.daysInPipeline = Math.max(0, Math.floor((new Date(endDate) - new Date(startDate)) / (24 * 60 * 60 * 1000)));

    if (ONBOARDING_MEMORY_CACHE_ENABLED) jobDetailCache.set(cacheKey, job);
    if (excludeComments) {
      const { comments: _c, ...rest } = job;
      return res.status(200).json({ job: rest });
    }
    res.status(200).json({ job });
  } catch (e) {
    console.error('getOnboardingJobById:', e);
    res.status(500).json({ error: e.message || 'Failed to get onboarding job' });
  }
}

function validateTransition(fromStatus, toStatus) {
  const allowed = VALID_TRANSITIONS[fromStatus];
  if (!allowed || !allowed.includes(toStatus)) return false;
  return true;
}

export async function patchOnboardingJob(req, res) {
  try {
    const { id } = req.params;
    const { status, csmEmail, csmName, resumeMakerEmail, resumeMakerName, linkedInMemberEmail, linkedInMemberName, operatorEmail, operatorName, comment, clientName, gmailCredentials, dashboardManagerName, taggedDashboardManagerNames } = req.body || {};
    
    // Validate ID format
    if (!id || !id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ error: 'Invalid job ID format' });
    }
    
    // Find existing job by ID - this ensures we're updating, not creating
    const job = await OnboardingJobModel.findById(id);
    if (!job) {
      return res.status(404).json({ error: 'Onboarding job not found' });
    }

    const isAdmin = req.user?.role === 'admin';
    const isCsm = req.user?.role === 'csm' || req.user?.roles?.includes?.('csm');
    const isTeamLead = req.user?.role === 'team_lead';
    const canMoveAny = isAdmin || isCsm || isTeamLead;

    /** True only when this PATCH moves the ticket into Applications In Progress (not on every later comment/field update). */
    let shouldMarkClientReadyForAppIp = false;

    if (status && typeof status === 'string') {
      const fromStatus = job.status;
      
      // Plan-based validation
      const planType = (job.planType || 'default').toLowerCase();
      const executiveStatuses = ['resume_in_progress', 'resume_draft_done', 'resume_in_review', 'resume_approved', 'linkedin_in_progress', 'linkedin_done', 'cover_letter_in_progress', 'cover_letter_done', 'applications_ready', 'applications_in_progress', 'completed'];
      const professionalStatuses = ['resume_in_progress', 'resume_draft_done', 'resume_in_review', 'resume_approved', 'linkedin_in_progress', 'linkedin_done', 'cover_letter_in_progress', 'cover_letter_done', 'applications_ready', 'applications_in_progress', 'completed'];
      const defaultStatuses = ['resume_in_progress', 'resume_draft_done', 'resume_in_review', 'resume_approved', 'applications_ready', 'applications_in_progress', 'completed'];
      
      const allowedStatusesForPlan = planType === 'executive' ? executiveStatuses : (planType === 'professional' ? professionalStatuses : defaultStatuses);
      
      if (!allowedStatusesForPlan.includes(status)) {
        const planName = job.planType || 'this plan';
        return res.status(400).json({ error: `This plan doesn't support moving to "${status}". ${planName === 'executive' ? 'Executive plan' : planName === 'professional' ? 'Professional plan' : 'This plan'} only supports certain statuses.` });
      }
      
      // Allow transition to LinkedIn phases if linkedInPhaseStarted is true (even if status is resume_approved)
      const canMoveToLinkedIn = (fromStatus === 'resume_approved' && job.linkedInPhaseStarted && (status === 'linkedin_in_progress' || status === 'linkedin_done'));
      const allowed = canMoveAny || canMoveToLinkedIn || validateTransition(fromStatus, status);
      if (!allowed) {
        return res.status(400).json({ error: `Invalid status transition from ${fromStatus} to ${status}` });
      }
      if (status === 'applications_in_progress' && fromStatus !== 'applications_in_progress') {
        shouldMarkClientReadyForAppIp = true;
      }
      job.status = status;
      if (!job.moveHistory) job.moveHistory = [];
      const movedAt = new Date();
      job.moveHistory.push({
        actionType: 'status_change',
        fromStatus,
        toStatus: status,
        movedBy: req.user?.email || 'unknown',
        movedByName: req.user?.name || '',
        movedAt
      });
      if (status === 'completed') job.applicationsCompletedAt = movedAt;
      
      // Mark LinkedIn phase as started when Resume Approved (same job appears in both columns)
      if (status === 'resume_approved' && fromStatus !== 'resume_approved' && !job.linkedInPhaseStarted) {
        job.linkedInPhaseStarted = true;
        
        // Auto-assign LinkedIn member using round-robin
        if (!job.linkedInMemberEmail) {
          const nextLinkedIn = await getNextLinkedInMember();
          if (nextLinkedIn) {
            job.linkedInMemberEmail = (nextLinkedIn.email || '').toLowerCase();
            job.linkedInMemberName = nextLinkedIn.name || '';
          }
        }
        
        // Notify LinkedIn team
        try {
          const linkedInTeam = await UserModel.find({
            role: 'onboarding_team',
            onboardingSubRole: 'linkedin_and_cover_letter_optimization',
            isActive: true
          }).select('email name').lean();
          
          if (linkedInTeam.length > 0) {
            const displayName = job.clientNumber != null ? `${job.clientNumber} - ${job.clientName || ''}` : (job.clientName || '');
            const notifications = linkedInTeam.map(user => ({
              userEmail: (user.email || '').toLowerCase().trim(),
              jobId: job._id,
              jobNumber: job.jobNumber,
              clientNumber: job.clientNumber ?? null,
              clientName: job.clientName || '',
              commentSnippet: `LinkedIn phase started: ${displayName}`,
              authorEmail: req.user?.email || 'system',
              authorName: req.user?.name || 'System',
              read: false
            })).filter(n => n.userEmail);
            
            if (notifications.length) {
              await OnboardingNotificationModel.insertMany(notifications).catch(err => console.error('LinkedIn phase notification insert:', err));
            }
          }
        } catch (err) {
          console.error('Failed to create LinkedIn phase notifications:', err);
        }
      }
      
      // Also set linkedInPhaseStarted if manually moved to LinkedIn statuses (for admin flexibility)
      if ((status === 'linkedin_in_progress' || status === 'linkedin_done') && !job.linkedInPhaseStarted) {
        job.linkedInPhaseStarted = true;
        // Auto-assign LinkedIn member if not already assigned
        if (!job.linkedInMemberEmail) {
          const nextLinkedIn = await getNextLinkedInMember();
          if (nextLinkedIn) {
            job.linkedInMemberEmail = (nextLinkedIn.email || '').toLowerCase();
            job.linkedInMemberName = nextLinkedIn.name || '';
          }
        }
      }
    }

    if (csmEmail !== undefined) {
      job.csmEmail = (csmEmail || '').toLowerCase().trim();
      job.csmName = csmName || '';
    }
    if (isAdmin && resumeMakerEmail !== undefined) {
      job.resumeMakerEmail = (resumeMakerEmail || '').toLowerCase().trim();
      job.resumeMakerName = resumeMakerName || '';
    }
    if (isAdmin && linkedInMemberEmail !== undefined) {
      const prevLinkedIn = (job.linkedInMemberName || job.linkedInMemberEmail || '').trim();
      const newLinkedIn = (linkedInMemberName || linkedInMemberEmail || '').trim();
      job.linkedInMemberEmail = (linkedInMemberEmail || '').toLowerCase().trim();
      job.linkedInMemberName = linkedInMemberName || '';
      if (newLinkedIn && (prevLinkedIn !== newLinkedIn)) {
        if (!job.moveHistory) job.moveHistory = [];
        job.moveHistory.push({
          actionType: 'assignment',
          targetRole: 'linkedin_member',
          targetName: newLinkedIn,
          movedBy: req.user?.email || 'unknown',
          movedByName: req.user?.name || '',
          movedAt: new Date()
        });
      }
    }
    const canManageOperations = isAdmin || isCsm || isTeamLead;
    if (canManageOperations && operatorEmail !== undefined) {
      job.operatorEmail = (operatorEmail || '').toLowerCase().trim();
      job.operatorName = operatorName || '';
      // Auto-add client to operator's managedUsers when assigning (so they appear in operations list)
      if (job.operatorEmail && job.clientEmail) {
        try {
          const client = await NewUserModel.findOne({ email: job.clientEmail.toLowerCase() }).lean();
          const opEmail = job.operatorEmail;
          const opEmailAlt = opEmail.replace('@flashfirehq.com', '@flashfirehq');
          const operator = await OperationsModel.findOne({ email: { $in: [opEmail, opEmailAlt] } });
          if (client && operator && !operator.managedUsers.some(id => id.toString() === client._id.toString())) {
            operator.managedUsers.push(client._id);
            await operator.save();
          }
        } catch (err) {
          console.error('Auto-add client to operator managedUsers:', err);
        }
      }
    }
    if (isAdmin && clientName !== undefined && typeof clientName === 'string') {
      job.clientName = clientName.trim() || job.clientName;
    }
    if (isAdmin && dashboardManagerName !== undefined && typeof dashboardManagerName === 'string') {
      const prevName = (job.dashboardManagerName || '').trim();
      const newName = dashboardManagerName.trim() || '';
      if (newName && !job.dashboardDetailsCompletedAt) job.dashboardDetailsCompletedAt = new Date();
      job.dashboardManagerName = newName;
      if (newName && prevName !== newName) {
        if (!job.moveHistory) job.moveHistory = [];
        job.moveHistory.push({
          actionType: 'assignment',
          targetRole: 'dashboard_manager',
          targetName: newName,
          movedBy: req.user?.email || 'unknown',
          movedByName: req.user?.name || '',
          movedAt: new Date()
        });
      }
      // Sync to Client model
      const clientEmailLower = (job.clientEmail || '').toLowerCase();
      await ClientModel.updateOne(
        { email: clientEmailLower },
        { $set: { dashboardTeamLeadName: job.dashboardManagerName, updatedAt: new Date().toLocaleString('en-US', 'Asia/Kolkata') } }
      );
      await NewUserModel.updateOne(
        { email: clientEmailLower },
        { $set: { dashboardManager: job.dashboardManagerName } },
        { runValidators: false }
      ).catch(() => {});
      clearAnalysisCache();
    }
    if ((isAdmin || isCsm || isTeamLead) && taggedDashboardManagerNames !== undefined && Array.isArray(taggedDashboardManagerNames)) {
      job.taggedDashboardManagerNames = taggedDashboardManagerNames.map((n) => (n && String(n).trim()) || '').filter(Boolean);
    }

    // Handle Gmail credentials update with history
    if (gmailCredentials !== undefined && typeof gmailCredentials === 'object') {
      const newUsername = (gmailCredentials.username || '').trim();
      const newPassword = (gmailCredentials.password || '').trim();
      const currentUsername = (job.gmailCredentials?.username || '').trim();
      const currentPassword = (job.gmailCredentials?.password || '').trim();

      const usernameChanged = newUsername !== currentUsername;
      const passwordChanged = newPassword !== currentPassword;

      if (usernameChanged || passwordChanged) {
        if (!job.gmailCredentialsHistory) job.gmailCredentialsHistory = [];
        if (currentUsername || currentPassword) {
          job.gmailCredentialsHistory.push({
            username: currentUsername,
            password: currentPassword,
            updatedBy: req.user?.email || req.user?.name || 'unknown',
            updatedAt: new Date()
          });
        }
        if (!job.gmailCredentials) job.gmailCredentials = {};
        if (newUsername) job.gmailCredentials.username = newUsername;
        if (newPassword) job.gmailCredentials.password = newPassword;
      }
    }

    const commentBody = comment && typeof comment.body === 'string' ? comment.body.trim() : '';
    const commentImages = Array.isArray(comment?.images)
      ? (comment.images.filter((img) => img && img.url).map((img) => ({ url: img.url, filename: img.filename || '' })))
      : [];
    const hasCommentContent = commentBody.length > 0 || commentImages.length > 0;
    if (comment && hasCommentContent) {
      if (!job.comments) job.comments = [];
      const taggedUserIds = Array.isArray(comment.taggedUserIds) ? comment.taggedUserIds : [];
      const taggedNames = Array.isArray(comment.taggedNames) ? comment.taggedNames : [];
      job.comments.push({
        body: commentBody || '(image)',
        authorEmail: req.user?.email || '',
        authorName: req.user?.name || req.user?.email || '',
        taggedUserIds,
        taggedNames,
        images: commentImages,
        createdAt: new Date()
      });
      job.updatedAt = new Date();
      // Non-admin comment → increment unread counter for admins (stored on doc, zero extra query)
      if (req.user?.role !== 'admin') {
        job.adminUnreadCount = (job.adminUnreadCount || 0) + 1;
      }
      await job.save();

      if (taggedUserIds.length > 0) {
        const commentSnippet = (commentBody || '(image)').slice(0, 120);
        const authorName = req.user?.name || req.user?.email || '';
        const authorEmail = req.user?.email || '';
        const cleanTaggedEmails = taggedUserIds.map(e => (e || '').toLowerCase().trim()).filter(Boolean);

        const notifications = cleanTaggedEmails.map((email) => ({
          userEmail: email,
          jobId: job._id,
          jobNumber: job.jobNumber,
          clientNumber: job.clientNumber ?? null,
          clientName: job.clientName || '',
          commentSnippet,
          authorEmail,
          authorName,
          read: false
        }));
        if (notifications.length) {
          await OnboardingNotificationModel.insertMany(notifications).catch(err => console.error('OnboardingNotification insert:', err));
          // Instant push over the chat SSE stream — replaces waiting for the
          // 2-minute notification poll on the onboarding board.
          notifications.forEach((n) => {
            emitToUsers([n.userEmail], 'notify', {
              kind: 'tag',
              jobId: String(n.jobId),
              jobNumber: n.jobNumber,
              clientName: n.clientName,
              authorName: n.authorName,
              commentSnippet: n.commentSnippet
            });
          });
        }

        // Per-user notification fan-out: chat DM + immediate email to the
        // user's OTP mail + Discord ping to their personal webhook channel.
        // Repeating Discord reminders (utils/chatCrons.js) then fire until the
        // tagged user resolves the comment.
        const taggedUsersData = await UserModel.find({ email: { $in: cleanTaggedEmails } })
          .select('email otpEmail name discordWebhookUrl')
          .lean();
        const taggedUserMap = new Map(taggedUsersData.map(u => [u.email.toLowerCase(), u]));
        const ticketRef = {
          jobId: job._id,
          jobNumber: job.jobNumber,
          clientName: job.clientName || '',
          clientNumber: job.clientNumber ?? null
        };
        cleanTaggedEmails.forEach((userEmail, i) => {
          const taggedUser = taggedUserMap.get(userEmail);
          const recipientName = (Array.isArray(comment.taggedNames) && comment.taggedNames[i]) || taggedUser?.name || userEmail;

          // 1. Chat widget DM (emailHandled: the email below is sent right away,
          //    so the 30-min escalation sweep must not duplicate it)
          sendChatMessageInternal({
            fromEmail: authorEmail,
            fromName: authorName,
            toEmail: userEmail,
            toName: recipientName,
            text: commentBody || '(image)',
            ticket: ticketRef,
            source: 'tag',
            emailHandled: true
          });

          // 2. Email to the user's OTP mail (falls back to login email)
          const toEmail = (taggedUser?.otpEmail || '').trim() || userEmail;
          sendTagNotificationEmail({
            toEmail,
            recipientName,
            authorName,
            commentSnippet,
            jobNumber: job.jobNumber,
            clientName: job.clientName || '',
            clientNumber: job.clientNumber ?? null,
            jobId: String(job._id)
          }).catch(err => console.error(`[Tag Email] failed to ${toEmail}:`, err?.message || err));

          // 3. Discord ping to their personal channel (if configured)
          if (taggedUser?.discordWebhookUrl) {
            sendTagDiscordPing({
              webhookUrl: taggedUser.discordWebhookUrl,
              recipientName,
              authorName,
              snippet: commentSnippet,
              clientName: job.clientName || '',
              clientNumber: job.clientNumber ?? null,
              jobNumber: job.jobNumber
            }).catch(() => {});
          }
        });

        // Keep the ticket's Dashboard Manager in the loop — an FYI, not a tag:
        // no resolve duty, no escalation, no reminder chasing. Skipped when the
        // DM wrote the comment or is already among the tagged users.
        (async () => {
          try {
            const dmName = (job.dashboardManagerName || '').trim();
            if (!dmName) return;
            const manager = await ManagerModel.findOne({ fullName: dmName, isActive: true }).select('email').lean();
            const dmEmail = (manager?.email || '').toLowerCase().trim();
            if (!dmEmail) return;
            if (dmEmail === (authorEmail || '').toLowerCase().trim()) return; // DM is the author
            if (cleanTaggedEmails.includes(dmEmail)) return; // DM is tagged — already fully notified
            const taggedLabel = (comment.taggedNames || []).filter(Boolean).join(', ') || cleanTaggedEmails.join(', ');

            OnboardingNotificationModel.create({
              userEmail: dmEmail,
              jobId: job._id,
              jobNumber: job.jobNumber,
              clientNumber: job.clientNumber ?? null,
              clientName: job.clientName || '',
              commentSnippet: `👀 ${authorName} tagged ${taggedLabel}: ${commentSnippet}`.slice(0, 120),
              authorEmail,
              authorName,
              read: false
            }).catch((err) => console.error('DM loop-in notification:', err));
            emitToUsers([dmEmail], 'notify', {
              kind: 'dm_fyi',
              jobId: String(job._id),
              jobNumber: job.jobNumber,
              clientName: job.clientName || '',
              authorName,
              commentSnippet
            });
            // Chat DM as source 'user': visible in the widget, but never enters
            // the escalation sweep — the tagged person owns the resolution.
            sendChatMessageInternal({
              fromEmail: authorEmail,
              fromName: authorName,
              toEmail: dmEmail,
              toName: dmName,
              text: `FYI — tagged ${taggedLabel} on your client:\n${commentBody || '(image)'}`,
              ticket: {
                jobId: job._id,
                jobNumber: job.jobNumber,
                clientName: job.clientName || '',
                clientNumber: job.clientNumber ?? null
              },
              source: 'user'
            });
            const dmUser = await UserModel.findOne({ email: dmEmail }).select('discordWebhookUrl name').lean();
            if (dmUser?.discordWebhookUrl) {
              sendTagDiscordPing({
                webhookUrl: dmUser.discordWebhookUrl,
                recipientName: dmUser.name || dmName,
                authorName,
                snippet: commentSnippet,
                clientName: job.clientName || '',
                clientNumber: job.clientNumber ?? null,
                jobNumber: job.jobNumber,
                fyi: true,
                taggedLabel
              }).catch(() => {});
            }
          } catch (e) {
            console.error('[Tag] DM loop-in failed:', e?.message || e);
          }
        })();
      }
    } else {
      job.updatedAt = new Date();
      await job.save();
    }

    // When ticket first reaches Applications In Progress, mark client as ready for reminders (unpaused, out of onboarding phase)
    let jobForResponse = job;
    if (shouldMarkClientReadyForAppIp) {
      const clientEmail = (job.clientEmail || '').toLowerCase().trim();
      if (clientEmail) {
        try {
          const clientBefore = await ClientModel.findOne({ email: clientEmail }).lean();
          await ClientModel.updateOne(
            { email: clientEmail },
            { $set: { onboardingPhase: false, isPaused: false, pausedAt: null } }
          );
          const movedBy = { email: req.user?.email || 'unknown', name: req.user?.name || '' };
          await addClientActionToJobMoveHistory(clientEmail, 'client_unpaused', movedBy);
          // Combined "started" email is dispatched by hourly cron once:
          // resumeSent + !onboardingPhase + count >= MIN_JOBS_FOR_EMAIL. No fire here.
          const refetched = await OnboardingJobModel.findById(id);
          if (refetched) jobForResponse = refetched;
        } catch (err) {
          console.error('Onboarding: client ready-for-AppIP update failed', err?.message || err);
        }
      }
    }

    jobListCache.clear(); // invalidate list cache after any mutation
    jobDetailCache.del(`job:${id}`);

    const updated = jobForResponse.toObject();
    const patchEnrichNow = new Date();

    // Parallel: fetch client status + manager email at the same time
    const enrichClientEmail = (updated.clientEmail || '').toLowerCase();
    const [clientDoc, managerDoc] = await Promise.all([
      enrichClientEmail
        ? ClientModel.findOne({ email: enrichClientEmail }).select('status isPaused onboardingPhase pausedAt').lean()
        : Promise.resolve(null),
      updated.dashboardManagerName
        ? ManagerModel.findOne({ fullName: updated.dashboardManagerName, isActive: true }).select('email').lean()
        : Promise.resolve(null)
    ]);

    updated.clientStatus = clientDoc?.status || 'active';
    updated.clientIsPaused = clientDoc?.isPaused || false;
    const patchPausedOnly =
      updated.clientIsPaused === true && clientDoc?.onboardingPhase !== true;
    updated.clientPausedDays =
      patchPausedOnly && clientDoc?.pausedAt
        ? Math.max(
            0,
            Math.floor((patchEnrichNow - new Date(clientDoc.pausedAt)) / (24 * 60 * 60 * 1000))
          )
        : null;
    updated.dashboardManagerEmail = managerDoc?.email || '';

    res.status(200).json({ job: updated });
  } catch (e) {
    console.error('patchOnboardingJob:', e);
    res.status(500).json({ error: e.message || 'Failed to update onboarding job' });
  }
}

export async function postOnboardingJob(req, res) {
  try {
    const { clientEmail, clientName, planType, dashboardManagerName, dashboardCredentials, bachelorsStartDate, mastersEndDate } = req.body || {};
    if (!clientEmail || !clientName) {
      return res.status(400).json({ error: 'clientEmail and clientName are required' });
    }
    const existing = await OnboardingJobModel.findOne({ clientEmail: clientEmail.toLowerCase().trim() });
    if (existing) {
      return res.status(400).json({ error: 'Onboarding job already exists for this client' });
    }
    const job = await createOnboardingJobPayload({
      clientEmail,
      clientName,
      planType: planType || 'Professional',
      dashboardManagerName: dashboardManagerName || '',
      bachelorsStartDate: bachelorsStartDate || '',
      mastersEndDate: mastersEndDate || '',
      dashboardCredentials: dashboardCredentials || {},
      createdBy: req.user?.email || '',
      createdByName: req.user?.name || ''
    });
    jobListCache.clear(); // invalidate list cache after new ticket
    
    // Create notification for ticket creation
    try {
      const csms = await UserModel.find({
        $or: [{ role: 'csm' }, { roles: { $in: ['csm'] } }],
        isActive: true
      }).select('email name').lean();
      
      if (csms.length > 0) {
        const displayName = job.clientNumber != null ? `${job.clientNumber} - ${job.clientName || ''}` : (job.clientName || '');
        const notifications = csms.map(csm => ({
          userEmail: (csm.email || '').toLowerCase().trim(),
          jobId: job._id,
          jobNumber: job.jobNumber,
          clientNumber: job.clientNumber ?? null,
          clientName: job.clientName || '',
          commentSnippet: `New client ticket created: ${displayName}`,
          authorEmail: req.user?.email || 'system',
          authorName: req.user?.name || 'System',
          read: false
        })).filter(n => n.userEmail);
        
        if (notifications.length) {
          await OnboardingNotificationModel.insertMany(notifications).catch(err => console.error('OnboardingNotification insert (ticket created):', err));
        }
      }
    } catch (err) {
      console.error('Failed to create ticket creation notifications:', err);
    }
    
    res.status(201).json({ job: job.toObject() });
  } catch (e) {
    console.error('postOnboardingJob:', e);
    res.status(500).json({ error: e.message || 'Failed to create onboarding job' });
  }
}

export async function getOnboardingRoles(req, res) {
  try {
    // Roles change only when admin updates users — serve from 60 s cache
    const cachedRoles = rolesCache.get('roles');
    if (cachedRoles) return res.status(200).json(cachedRoles);

    const [users, operationsList] = await Promise.all([
      UserModel.find({ isActive: true }).select('email role onboardingSubRole roles name').lean(),
      OperationsModel.find().select('email name').lean()
    ]);
    const csms = users.filter(u => u.roles?.includes?.('csm') || u.role === 'csm');
    const resumeMakers = users.filter(u => u.role === 'onboarding_team' && u.onboardingSubRole === 'resume_maker');
    const linkedInMembers = users.filter(u =>
      u.role === 'onboarding_team' &&
      u.onboardingSubRole === 'linkedin_and_cover_letter_optimization'
    );
    const teamLeads = users.filter(u => u.role === 'team_lead');
    const admins = users.filter(u => u.role === 'admin');
    // Operations Intern dropdown: use Operations Team (OperationsModel), same list as Operations Team tab
    const operationsInterns = (operationsList || []).map(o => ({ email: o.email, name: o.name || o.email }));
    const mentionableMap = new Map();
    [...csms, ...teamLeads, ...admins].forEach(u => {
      if (u.email) mentionableMap.set(u.email.toLowerCase(), { email: u.email, name: u.name || u.email });
    });
    operationsInterns.forEach(o => {
      if (o.email) mentionableMap.set((o.email || '').toLowerCase(), { email: o.email, name: o.name || o.email });
    });
    const mentionableUsers = Array.from(mentionableMap.values());
    const rolesPayload = {
      csms: csms.map(u => ({ email: u.email, name: u.name || u.email })),
      resumeMakers: resumeMakers.map(u => ({ email: u.email, name: u.name || u.email })),
      linkedInMembers: linkedInMembers.map(u => ({ email: u.email, name: u.name || u.email })),
      operationsInterns: operationsInterns.map(u => ({ email: u.email, name: u.name || u.email })),
      teamLeads: teamLeads.map(u => ({ email: u.email, name: u.name || u.email })),
      admins: admins.map(u => ({ email: u.email, name: u.name || u.email })),
      mentionableUsers
    };
    rolesCache.set('roles', rolesPayload);
    res.status(200).json(rolesPayload);
  } catch (e) {
    console.error('getOnboardingRoles:', e);
    res.status(500).json({ error: e.message || 'Failed to get onboarding roles' });
  }
}

// Exported so auth routes can invalidate when users are created/updated/deleted
export function invalidateRolesCache() { rolesCache.clear(); }

// Exported so client-profile proxy can invalidate when profileComplete/dashboardDetailsCompletedAt is updated
export function invalidateJobListCache() {
  jobListCache.clear();
  jobDetailCache.clear();
}

export async function getNextResumeMakerApi(req, res) {
  try {
    const next = await getNextResumeMaker();
    res.status(200).json(next ? { email: next.email, name: next.name } : { email: null, name: null });
  } catch (e) {
    console.error('getNextResumeMakerApi:', e);
    res.status(500).json({ error: e.message || 'Failed to get next resume maker' });
  }
}

export async function getOnboardingNotifications(req, res) {
  try {
    const email = (req.user?.email || '').toLowerCase().trim();
    if (!email) return res.status(200).json({ notifications: [] });
    const notifications = await OnboardingNotificationModel.find({ userEmail: email })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.status(200).json({ notifications });
  } catch (e) {
    console.error('getOnboardingNotifications:', e);
    res.status(500).json({ error: e.message || 'Failed to get notifications' });
  }
}

export async function markOnboardingNotificationRead(req, res) {
  try {
    const { id } = req.params;
    const email = (req.user?.email || '').toLowerCase().trim();
    if (!email) return res.status(401).json({ error: 'Unauthorized' });
    // Atomic single-query update — no find then save
    const notification = await OnboardingNotificationModel.findOneAndUpdate(
      { _id: id, userEmail: email },
      { $set: { read: true } },
      { new: true, lean: true }
    );
    if (!notification) return res.status(404).json({ error: 'Notification not found' });
    res.status(200).json({ notification });
  } catch (e) {
    console.error('markOnboardingNotificationRead:', e);
    res.status(500).json({ error: e.message || 'Failed to mark read' });
  }
}

export async function resolveOnboardingComment(req, res) {
  try {
    const { id: jobId, commentId } = req.params;
    const userEmail = (req.user?.email || '').toLowerCase().trim();
    if (!userEmail) return res.status(401).json({ error: 'Unauthorized' });
    const isAdmin = req.user?.role === 'admin';
    const job = await OnboardingJobModel.findById(jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const commentIndex = job.comments.findIndex(
      c => String(c._id) === commentId || String(c._id) === String(commentId)
    );
    if (commentIndex < 0) return res.status(404).json({ error: 'Comment not found' });
    const commentRef = job.comments[commentIndex];
    const taggedEmails = (commentRef.taggedUserIds || []).map(e => (e || '').toLowerCase().trim()).filter(Boolean);
    const resolvedByTagged = commentRef.resolvedByTagged || [];
    const alreadyResolvedByUser = resolvedByTagged.some(r => (r.email || '').toLowerCase() === userEmail);

    if (!isAdmin) {
      if (!taggedEmails.includes(userEmail)) {
        return res.status(403).json({ error: 'Only tagged users can mark this as resolved' });
      }
      if (alreadyResolvedByUser) {
        return res.status(200).json({ job: job.toObject(), alreadyResolved: true });
      }
    }

    if (!commentRef.resolvedByTagged) {
      job.comments[commentIndex].resolvedByTagged = [];
    }

    const newlyResolved = [];
    const now = new Date();
    const snippet = String(commentRef.body || '').replace(/\s+/g, ' ').trim().slice(0, 120);

    if (isAdmin) {
      const existingResolvedEmails = new Set(
        (job.comments[commentIndex].resolvedByTagged || []).map(r => (r.email || '').toLowerCase())
      );
      taggedEmails.forEach(email => {
        if (!existingResolvedEmails.has(email)) {
          job.comments[commentIndex].resolvedByTagged.push({ email, resolvedAt: now });
          newlyResolved.push(email);
          existingResolvedEmails.add(email);
        }
      });
      if (!existingResolvedEmails.has(userEmail)) {
        job.comments[commentIndex].resolvedByTagged.push({ email: userEmail, resolvedAt: now });
        newlyResolved.push(userEmail);
      }
    } else {
      job.comments[commentIndex].resolvedByTagged.push({
        email: userEmail,
        resolvedAt: now
      });
      newlyResolved.push(userEmail);
    }

    if (newlyResolved.length > 0) {
      if (!job.moveHistory) job.moveHistory = [];
      job.moveHistory.push({
        actionType: 'comment_resolved',
        movedBy: userEmail,
        movedByName: req.user?.name || '',
        movedAt: now,
        commentId: String(commentRef._id),
        commentSnippet: snippet,
        resolvedEmails: newlyResolved
      });
      job.markModified('moveHistory');
    }

    job.updatedAt = new Date();
    job.markModified('comments');
    await job.save();
    jobListCache.clear();
    jobDetailCache.del(`job:${jobId}`);
    res.status(200).json({ job: job.toObject() });
  } catch (e) {
    console.error('resolveOnboardingComment:', e);
    res.status(500).json({ error: e.message || 'Failed to mark as resolved' });
  }
}

/**
 * POST /api/onboarding/jobs/:id/comments/:commentId/replies
 * Add a thread reply to a comment. Notifies the parent comment's participants
 * (author + tagged users, excluding the replier) via bell + instant SSE.
 */
export async function addCommentReply(req, res) {
  try {
    const { id: jobId, commentId } = req.params;
    const userEmail = (req.user?.email || '').toLowerCase().trim();
    if (!userEmail) return res.status(401).json({ error: 'Unauthorized' });
    const body = (req.body?.body || '').trim();
    if (!body) return res.status(400).json({ error: 'Reply text required' });

    const job = await OnboardingJobModel.findById(jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const comment = (job.comments || []).find((c) => String(c._id) === String(commentId));
    if (!comment) return res.status(404).json({ error: 'Comment not found' });

    if (!comment.replies) comment.replies = [];
    comment.replies.push({
      body: body.slice(0, 4000),
      authorEmail: userEmail,
      authorName: req.user?.name || userEmail,
      createdAt: new Date()
    });
    job.updatedAt = new Date();
    job.markModified('comments');
    await job.save();
    jobListCache.clear();
    jobDetailCache.del(`job:${jobId}`);

    // Notify thread participants: parent author + tagged users + earlier
    // repliers, minus the person replying now.
    const participants = new Set(
      [
        comment.authorEmail,
        ...(comment.taggedUserIds || []),
        ...(comment.replies || []).map((r) => r.authorEmail)
      ]
        .map((e) => (e || '').toLowerCase().trim())
        .filter((e) => e && e !== userEmail && !e.includes('.internal'))
    );
    if (participants.size > 0) {
      const snippet = body.slice(0, 120);
      const notifications = [...participants].map((email) => ({
        userEmail: email,
        jobId: job._id,
        jobNumber: job.jobNumber,
        clientNumber: job.clientNumber ?? null,
        clientName: job.clientName || '',
        commentSnippet: `↩ ${snippet}`,
        authorEmail: userEmail,
        authorName: req.user?.name || userEmail,
        read: false
      }));
      OnboardingNotificationModel.insertMany(notifications).catch((err) =>
        console.error('reply notifications insert:', err)
      );
      for (const email of participants) {
        emitToUsers([email], 'notify', {
          kind: 'thread_reply',
          jobId: String(job._id),
          jobNumber: job.jobNumber,
          clientName: job.clientName || '',
          authorName: req.user?.name || userEmail,
          commentSnippet: snippet
        });
      }
    }

    res.status(200).json({ job: job.toObject() });
  } catch (e) {
    console.error('addCommentReply:', e);
    res.status(500).json({ error: e.message || 'Failed to add reply' });
  }
}

/**
 * PATCH /api/onboarding/jobs/:id/comments/:commentId/reopen
 * Clear a comment's resolutions (admin, comment author, or a tagged user).
 * Discord tag reminders restart because the reminder log is reset.
 */
export async function reopenComment(req, res) {
  try {
    const { id: jobId, commentId } = req.params;
    const userEmail = (req.user?.email || '').toLowerCase().trim();
    if (!userEmail) return res.status(401).json({ error: 'Unauthorized' });
    const isAdmin = req.user?.role === 'admin';

    const job = await OnboardingJobModel.findById(jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const comment = (job.comments || []).find((c) => String(c._id) === String(commentId));
    if (!comment) return res.status(404).json({ error: 'Comment not found' });

    const taggedEmails = (comment.taggedUserIds || []).map((e) => (e || '').toLowerCase().trim());
    const isAuthor = (comment.authorEmail || '').toLowerCase().trim() === userEmail;
    if (!isAdmin && !isAuthor && !taggedEmails.includes(userEmail)) {
      return res.status(403).json({ error: 'Only an admin, the author, or a tagged user can reopen this' });
    }
    if (!(comment.resolvedByTagged || []).length) {
      return res.status(400).json({ error: 'Comment is not resolved' });
    }

    comment.resolvedByTagged = [];
    if (!job.moveHistory) job.moveHistory = [];
    job.moveHistory.push({
      actionType: 'comment_reopened',
      movedBy: userEmail,
      movedByName: req.user?.name || '',
      movedAt: new Date(),
      commentId: String(comment._id),
      commentSnippet: (comment.body || '').slice(0, 120)
    });
    job.updatedAt = new Date();
    job.markModified('comments');
    job.markModified('moveHistory');
    await job.save();
    jobListCache.clear();
    jobDetailCache.del(`job:${jobId}`);

    // Reset Discord reminder counters so the re-opened tag gets chased again.
    TagReminderModel.deleteMany({ jobId: job._id, commentId: String(comment._id) }).catch(() => {});

    res.status(200).json({ job: job.toObject() });
  } catch (e) {
    console.error('reopenComment:', e);
    res.status(500).json({ error: e.message || 'Failed to reopen' });
  }
}

/**
 * GET /api/onboarding/issues/non-resolved
 * Returns count and list of non-resolved tagged issues for the current user, or for all (admin view).
 * - For non-admin: comments where the user is in taggedUserIds but not in resolvedByTagged.
 * - For admin (query ?admin=1): all comments that have at least one tagged user who hasn't resolved.
 */
export async function getNonResolvedIssues(req, res) {
  try {
    const userEmail = (req.user?.email || '').toLowerCase().trim();
    if (!userEmail) return res.status(401).json({ error: 'Unauthorized' });

    const isAdmin = req.user?.role === 'admin';
    const forAdmin = isAdmin && (req.query?.admin === '1' || req.query?.admin === 'true');

    if (forAdmin) {
      // Admin view: all comments with at least one tagged user who has not resolved
      const pipeline = [
        { $match: { 'comments.0': { $exists: true } } },
        { $unwind: '$comments' },
        { $match: { $expr: { $gt: [{ $size: { $ifNull: ['$comments.taggedUserIds', []] } }, 0] } } },
        {
          $addFields: {
            resolvedEmails: {
              $map: {
                input: { $ifNull: ['$comments.resolvedByTagged', []] },
                as: 'r',
                in: {
                  $toLower: {
                    $trim: { input: { $ifNull: ['$$r.email', ''] } }
                  }
                }
              }
            },
            taggedEmails: {
              $map: {
                input: { $ifNull: ['$comments.taggedUserIds', []] },
                as: 't',
                in: {
                  $toLower: {
                    $trim: { input: { $ifNull: ['$$t', ''] } }
                  }
                }
              }
            }
          }
        },
        {
          $addFields: {
            unresolvedTagged: {
              $filter: {
                input: '$taggedEmails',
                as: 'e',
                cond: {
                  $and: [
                    { $ne: ['$$e', ''] },
                    { $not: { $in: ['$$e', '$resolvedEmails'] } }
                  ]
                }
              }
            }
          }
        },
        { $match: { $expr: { $gt: [{ $size: '$unresolvedTagged' }, 0] } } },
        {
          $project: {
            jobId: '$_id',
            jobNumber: 1,
            clientName: 1,
            clientNumber: 1,
            commentId: '$comments._id',
            snippet: { $substr: [{ $ifNull: ['$comments.body', ''] }, 0, 120] },
            createdAt: '$comments.createdAt',
            authorName: '$comments.authorName',
            unresolvedCount: { $size: '$unresolvedTagged' },
            unresolvedEmails: '$unresolvedTagged'
          }
        },
        {
          $facet: {
            items: [{ $sort: { createdAt: -1 } }, { $limit: 100 }],
            totalCount: [{ $count: 'count' }]
          }
        },
        { $addFields: { count: { $ifNull: [{ $arrayElemAt: ['$totalCount.count', 0] }, 0] } } },
        { $project: { items: 1, count: 1 } }
      ];
      const result = await OnboardingJobModel.aggregate(pipeline).then((r) => r[0] || { items: [], count: 0 });
      const items = (result.items || []).map((it) => ({
        jobId: it.jobId,
        jobNumber: it.jobNumber,
        clientName: it.clientName,
        clientNumber: it.clientNumber,
        commentId: it.commentId,
        snippet: it.snippet,
        createdAt: it.createdAt,
        authorName: it.authorName,
        unresolvedCount: it.unresolvedCount,
        unresolvedEmails: it.unresolvedEmails || []
      }));

      // Build per-user summary for admin view
      const userCounts = {};
      items.forEach(it => {
        (it.unresolvedEmails || []).forEach(email => {
          userCounts[email] = (userCounts[email] || 0) + 1;
        });
      });
      const perUser = Object.entries(userCounts)
        .map(([email, count]) => ({ email, count }))
        .sort((a, b) => b.count - a.count);

      // Also fetch pending move requests for admin
      const pendingMoves = await OnboardingJobModel.find({ 'pendingMoveRequest.active': true })
        .select('jobNumber clientName clientNumber pendingMoveRequest')
        .lean();
      const pendingMoveItems = pendingMoves.map(j => ({
        type: 'move_request',
        jobId: j._id,
        jobNumber: j.jobNumber,
        clientName: j.clientName,
        clientNumber: j.clientNumber,
        targetStatus: j.pendingMoveRequest?.targetStatus,
        requestedBy: j.pendingMoveRequest?.requestedBy,
        requestedByName: j.pendingMoveRequest?.requestedByName,
        requestedAt: j.pendingMoveRequest?.requestedAt
      }));

      return res.status(200).json({
        count: result.count || 0,
        items,
        perUser,
        pendingMoves: pendingMoveItems,
        pendingMovesCount: pendingMoveItems.length
      });
    }

    // Current user's non-resolved (tagged but not resolved by me)
    const pipeline = [
      { $match: { 'comments.0': { $exists: true } } },
      { $unwind: '$comments' },
      {
        $addFields: {
          taggedEmails: {
            $map: {
              input: { $ifNull: ['$comments.taggedUserIds', []] },
              as: 't',
              in: {
                $toLower: {
                  $trim: { input: { $ifNull: ['$$t', ''] } }
                }
              }
            }
          },
          resolvedEmails: {
            $map: {
              input: { $ifNull: ['$comments.resolvedByTagged', []] },
              as: 'r',
              in: {
                $toLower: {
                  $trim: { input: { $ifNull: ['$$r.email', ''] } }
                }
              }
            }
          }
        }
      },
      {
        $addFields: {
          userTagged: { $in: [userEmail, '$taggedEmails'] },
          userResolved: { $in: [userEmail, '$resolvedEmails'] }
        }
      },
      { $match: { userTagged: true, userResolved: false } },
      {
        $project: {
          jobId: '$_id',
          jobNumber: 1,
          clientName: 1,
          clientNumber: 1,
          commentId: '$comments._id',
          snippet: { $substr: [{ $ifNull: ['$comments.body', ''] }, 0, 120] },
          createdAt: '$comments.createdAt',
          authorName: '$comments.authorName'
        }
      },
      {
        $facet: {
          items: [{ $sort: { createdAt: -1 } }, { $limit: 100 }],
          totalCount: [{ $count: 'count' }]
        }
      },
      { $addFields: { count: { $ifNull: [{ $arrayElemAt: ['$totalCount.count', 0] }, 0] } } },
      { $project: { items: 1, count: 1 } }
    ];
    const result = await OnboardingJobModel.aggregate(pipeline).then((r) => r[0] || { items: [], count: 0 });
    const items = (result.items || []).map((it) => ({
      jobId: it.jobId,
      jobNumber: it.jobNumber,
      clientName: it.clientName,
      clientNumber: it.clientNumber,
      commentId: it.commentId,
      snippet: it.snippet,
      createdAt: it.createdAt,
      authorName: it.authorName
    }));
    // User's own pending move requests
    const myPendingMoves = await OnboardingJobModel.find({
      'pendingMoveRequest.active': true,
      'pendingMoveRequest.requestedBy': userEmail
    }).select('jobNumber clientName clientNumber pendingMoveRequest').lean();
    const pendingMoveItems = myPendingMoves.map(j => ({
      type: 'move_request',
      jobId: j._id,
      jobNumber: j.jobNumber,
      clientName: j.clientName,
      clientNumber: j.clientNumber,
      targetStatus: j.pendingMoveRequest?.targetStatus,
      requestedBy: j.pendingMoveRequest?.requestedBy,
      requestedByName: j.pendingMoveRequest?.requestedByName,
      requestedAt: j.pendingMoveRequest?.requestedAt
    }));

    res.status(200).json({ count: result.count || 0, items, pendingMoves: pendingMoveItems, pendingMovesCount: pendingMoveItems.length });
  } catch (e) {
    console.error('getNonResolvedIssues:', e);
    res.status(500).json({ error: e.message || 'Failed to get non-resolved issues' });
  }
}

export async function postOnboardingJobAttachment(req, res) {
  try {
    const { id } = req.params;
    const { url, filename, name } = req.body || {};
    if (!url || !filename) return res.status(400).json({ error: 'url and filename are required' });
    const job = await OnboardingJobModel.findById(id);
    if (!job) return res.status(404).json({ error: 'Onboarding job not found' });
    if (!job.attachments) job.attachments = [];
    job.attachments.push({
      url,
      filename,
      name: (name && String(name).trim()) || filename,
      uploadedAt: new Date(),
      uploadedBy: req.user?.email || ''
    });
    job.updatedAt = new Date();
    await job.save();
    jobListCache.clear(); // invalidate list cache after attachment change
    res.status(201).json({ attachment: job.attachments[job.attachments.length - 1] });
  } catch (e) {
    console.error('postOnboardingJobAttachment:', e);
    res.status(500).json({ error: e.message || 'Failed to add attachment' });
  }
}

/**
 * PATCH /api/onboarding/jobs/:id/attachments/:index
 * Update a single attachment's name and/or url/filename (replace file).
 */
export async function patchOnboardingJobAttachment(req, res) {
  try {
    const { id, index } = req.params;
    const { name, url, filename } = req.body || {};
    if (!id || !id.match(/^[0-9a-fA-F]{24}$/)) return res.status(400).json({ error: 'Invalid job ID' });
    const idx = parseInt(index, 10);
    if (isNaN(idx) || idx < 0) return res.status(400).json({ error: 'Invalid attachment index' });
    const job = await OnboardingJobModel.findById(id);
    if (!job) return res.status(404).json({ error: 'Onboarding job not found' });
    if (!job.attachments || !Array.isArray(job.attachments) || idx >= job.attachments.length) {
      return res.status(404).json({ error: 'Attachment not found' });
    }
    const att = job.attachments[idx];
    if (name !== undefined && typeof name === 'string') att.name = name.trim() || att.filename || '';
    if (url !== undefined && typeof url === 'string') att.url = url;
    if (filename !== undefined && typeof filename === 'string') att.filename = filename;
    job.updatedAt = new Date();
    job.markModified('attachments');
    await job.save();
    jobListCache.clear();
    res.status(200).json({ attachment: job.attachments[idx], job: job.toObject ? job.toObject() : job });
  } catch (e) {
    console.error('patchOnboardingJobAttachment:', e);
    res.status(500).json({ error: e.message || 'Failed to update attachment' });
  }
}

/**
 * POST /api/onboarding/jobs/:id/admin-read
 * Admin-only. Atomically resets adminUnreadCount to 0.
 * Single findOneAndUpdate — no read first, no extra round-trips.
 * Clears the 5 s list cache so the next board refresh reflects the new count.
 */
export async function markAdminRead(req, res) {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }
    const { id } = req.params;
    await OnboardingJobModel.findOneAndUpdate(
      { _id: id, adminUnreadCount: { $gt: 0 } }, // only write if there's something to clear
      { $set: { adminUnreadCount: 0 } }
    );
    jobListCache.clear();
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('markAdminRead:', e);
    res.status(500).json({ error: e.message || 'Failed to mark as read' });
  }
}

// ---------------------------------------------------------------------------
// Move-request approval workflow
// ---------------------------------------------------------------------------

export async function requestMove(req, res) {
  try {
    const { id } = req.params;
    const { targetStatus } = req.body || {};
    if (!targetStatus || !ONBOARDING_STATUSES_LIST.includes(targetStatus)) {
      return res.status(400).json({ error: 'Invalid target status' });
    }
    const job = await OnboardingJobModel.findById(id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status === targetStatus) {
      return res.status(400).json({ error: 'Job is already in this status' });
    }
    if (job.pendingMoveRequest?.active) {
      return res.status(409).json({ error: 'A move request is already pending for this ticket' });
    }
    job.pendingMoveRequest = {
      targetStatus,
      requestedBy: req.user?.email || '',
      requestedByName: req.user?.name || req.user?.email || '',
      requestedAt: new Date(),
      active: true
    };
    job.updatedAt = new Date();
    await job.save();
    jobListCache.clear();
    res.status(200).json({ job: job.toObject() });
  } catch (e) {
    console.error('requestMove:', e);
    res.status(500).json({ error: e.message || 'Failed to request move' });
  }
}

export async function approveMove(req, res) {
  try {
    const role = req.user?.role;
    if (role !== 'admin' && role !== 'team_lead') {
      return res.status(403).json({ error: 'Only admin or team lead can approve moves' });
    }
    const { id } = req.params;
    const job = await OnboardingJobModel.findById(id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!job.pendingMoveRequest?.active) {
      return res.status(400).json({ error: 'No pending move request' });
    }
    const targetStatus = job.pendingMoveRequest.targetStatus;
    if (!ONBOARDING_STATUSES_LIST.includes(targetStatus)) {
      return res.status(400).json({ error: 'Invalid target status in pending request' });
    }
    const fromStatus = job.status;
    job.status = targetStatus;
    if (!job.moveHistory) job.moveHistory = [];
    job.moveHistory.push({
      actionType: 'status_change',
      fromStatus,
      toStatus: targetStatus,
      movedBy: req.user?.email || '',
      movedByName: req.user?.name || ''
    });
    job.pendingMoveRequest = { targetStatus: '', requestedBy: '', requestedByName: '', requestedAt: null, active: false };
    job.updatedAt = new Date();
    await job.save();
    jobListCache.clear();
    res.status(200).json({ job: job.toObject() });
  } catch (e) {
    console.error('approveMove:', e);
    res.status(500).json({ error: e.message || 'Failed to approve move' });
  }
}

export async function rejectMove(req, res) {
  try {
    const role = req.user?.role;
    if (role !== 'admin' && role !== 'team_lead') {
      return res.status(403).json({ error: 'Only admin or team lead can reject moves' });
    }
    const { id } = req.params;
    const updated = await OnboardingJobModel.findOneAndUpdate(
      { _id: id, 'pendingMoveRequest.active': true },
      { $set: { 'pendingMoveRequest.active': false, 'pendingMoveRequest.targetStatus': '', updatedAt: new Date() } },
      { new: true, lean: false }
    );
    if (!updated) return res.status(404).json({ error: 'No pending move request found' });
    jobListCache.clear();
    res.status(200).json({ job: updated.toObject() });
  } catch (e) {
    console.error('rejectMove:', e);
    res.status(500).json({ error: e.message || 'Failed to reject move' });
  }
}
