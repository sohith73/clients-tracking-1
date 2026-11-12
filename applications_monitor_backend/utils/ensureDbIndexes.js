import { Attendance, Leave, Settings } from '../attendance/models.js';
/**
 * Run after mongoose.connect() succeeds. Index creation must not run at model import time
 * or Mongoose buffers operations and can throw "buffering timed out after 10000ms" when the DB is slow/unreachable.
 */
import { JobModel } from '../JobModel.js';
import { ExtensionIncentiveComplaintModel } from '../ExtensionIncentiveComplaintModel.js';
import { UserModel } from '../UserModel.js';
import { ManagerModel } from '../ManagerModel.js';
import { CallLogModel } from '../CallLogModel.js';
import { OnboardingJobModel } from '../OnboardingJobModel.js';
import { ChatConversationModel, ChatMessageModel } from '../ChatModels.js';
import { TagReminderModel } from '../TagReminderModel.js';

export async function ensureDbIndexes() {
  await Promise.all([
    Attendance.collection.createIndex({ user: 1, date: 1 }, { unique: true }),
    Attendance.collection.createIndex({ date: 1 }),
    Leave.collection.createIndex({ user: 1, fromDate: -1 }),
    Leave.collection.createIndex({ status: 1, createdAt: -1 }),
    Leave.collection.createIndex({ days: 1, status: 1 }),
    Leave.collection.createIndex({ user: 1, days: 1 }, { unique: true, partialFilterExpression: { status: { $in: ["pending", "approved"] } } }),
    Settings.collection.createIndex({ key: 1 }, { unique: true }),
    JobModel.collection.createIndex({ createdAt: 1 }),
    JobModel.collection.createIndex({ appliedDate: 1 }),
    JobModel.collection.createIndex({ dateAdded: 1 }),
    JobModel.collection.createIndex({ updatedAt: 1 }),
    JobModel.collection.createIndex({ currentStatus: 1 }),
    JobModel.collection.createIndex({ userID: 1 }),
    JobModel.collection.createIndex({ operatorEmail: 1 }),
    JobModel.collection.createIndex({ operatorEmail: 1, appliedDate: 1, currentStatus: 1 }),
    JobModel.collection.createIndex({ operatorEmail: 1, appliedDate: 1, downloaded: 1 }),
    JobModel.collection.createIndex({ currentStatus: 1, appliedDate: 1 }),
    JobModel.collection.createIndex({ userID: 1, operatorName: 1, appliedDate: 1 }),
    // Serves the client-job-analysis "overall counts" group ({userID, currentStatus})
    // as a covered index scan — no document fetch over the whole collection.
    JobModel.collection.createIndex({ userID: 1, currentStatus: 1 }),
    // Serves the "jobs added per 22:00 IST window" aggregations in
    // utils/clientAddStats.js. createdByRole is the leading field so the ops-only
    // match is an index seek, and _id second so the window range bound
    // ({ _id: { $gte: <window start ObjectId> } }) is satisfied inside the same
    // scan instead of fetching every ops job ever pushed.
    JobModel.collection.createIndex({ createdByRole: 1, _id: 1 }),
    // Duplicate-link lookup on the add paths in flashfire-dashboard-backend-main
    // (Utils/jobLinkKey.js). Declared here as well because both services share
    // the jobdbs collection and this is the explicit index manager — relying on
    // the other repo's mongoose autoIndex would leave it missing wherever
    // autoIndex is disabled. NOT unique: joblinkKey is '' for placeholder links,
    // duplicates already exist, and a race should surface as a readable message
    // rather than a raw E11000.
    JobModel.collection.createIndex({ userID: 1, joblinkKey: 1 }),
    // Shared-application-form guard: counts distinct employers per link across
    // ALL clients, so userID cannot lead this one.
    JobModel.collection.createIndex({ joblinkKey: 1 }),
    UserModel.collection.createIndex({ email: 1 }, { unique: true }),
    UserModel.collection.createIndex({ isActive: 1 }),
    UserModel.collection.createIndex({ isActive: 1, onboardingSubRole: 1 }),
    UserModel.collection.createIndex({ lastResumeAssignedAt: 1 }),
    UserModel.collection.createIndex({ lastLinkedInAssignedAt: 1 }),
    ManagerModel.collection.createIndex({ fullName: 1, isActive: 1 }),
    ManagerModel.collection.createIndex({ isActive: 1 }),
    CallLogModel.collection.createIndex({ status: 1 }),
    CallLogModel.collection.createIndex({ twilioCallSid: 1 }),
    CallLogModel.collection.createIndex({ phoneNumber: 1, createdAt: -1 }),
    CallLogModel.collection.createIndex({ scheduledFor: 1, status: 1 }),
    ExtensionIncentiveComplaintModel.collection.createIndex({ dateYmd: 1, addedBy: 1 }),
    ExtensionIncentiveComplaintModel.collection.createIndex({ createdAt: -1 }),
    // NOTE: the 'users' collection already has a UNIQUE { email: 1 } index (created
    // by the app that owns that model), which already serves the referral $in
    // lookup in client-job-analysis. Do NOT add a second { email: 1 } here — a
    // non-unique createIndex collides with the existing auto-named "email_1".
    // Onboarding "non-resolved issues" admin view filters/unwinds on comments tags.
    // (Per-client email-log index { clientEmail:1, createdAt:-1 } is already declared
    //  on ClientEmailLogSchema itself, so it is not repeated here.)
    OnboardingJobModel.collection.createIndex({ 'comments.taggedUserIds': 1 })
  ]);

  // ── Chat ──
  // Migration: the first chat release had UNIQUE { participants: 1 } — on an
  // ARRAY that is per-element (multikey), so a user with 2+ conversations hit
  // E11000. Uniqueness now lives on the scalar `key` ("a|b", sorted pair).
  await ChatConversationModel.collection.dropIndex('participants_1').catch(() => { /* absent on fresh DBs */ });
  const missingKey = await ChatConversationModel.collection
    .find({ key: { $exists: false } })
    .project({ participants: 1 })
    .toArray();
  for (const doc of missingKey) {
    const key = [...(doc.participants || [])].sort().join('|');
    await ChatConversationModel.collection.updateOne({ _id: doc._id }, { $set: { key } });
  }
  await Promise.all([
    ChatConversationModel.collection.createIndex({ key: 1 }, { unique: true }),
    ChatConversationModel.collection.createIndex({ participants: 1, lastMessageAt: -1 }),
    ChatMessageModel.collection.createIndex({ conversationId: 1, createdAt: -1 }),
    ChatMessageModel.collection.createIndex({ source: 1, 'escalation.emailSentAt': 1, createdAt: 1 }),
    ChatMessageModel.collection.createIndex({ source: 1, 'escalation.adminNotifiedAt': 1, createdAt: 1 }),
    TagReminderModel.collection.createIndex({ jobId: 1, commentId: 1, userEmail: 1 }, { unique: true })
  ]);

  // ── Jobs Added report (written by the Flashfire Autopilot, read by
  // GET /api/job-add-report): one row per client per cap day.
  const db = JobModel.db.db;
  await db.collection('jobaddreports').createIndex({ day: 1, email: 1 }, { unique: true });
}
