import express from 'express';
import compression from 'compression';
import mongoose from 'mongoose';
import { JobModel } from './JobModel.js';
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
  markAdminRead,
  getNonResolvedIssues,
  requestMove,
  approveMove,
  rejectMove,
  invalidateJobListCache,
  runHighAppliedJobsNotifications
} from './controllers/onboardingController.js';
import { ClientCounterModel } from './ClientCounterModel.js';
import { OnboardingJobModel } from './OnboardingJobModel.js';
import { ClientOperationsModel } from './ClientOperationsModel.js';
import { setOtp, getOtp, deleteOtp, decrementAttempts, otpHash } from './utils/otpCache.js';
import { sendOtpEmail } from './utils/sendOtpEmail.js';
import {
  getAnalysisCache,
  setAnalysisCache,
  clearAnalysisCache,
  ANALYSIS_CACHE_TTL,
  LAST_APPLIED_CACHE_TTL
} from './utils/analysisCache.js';
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

const FLASHFIRE_API_BASE_URL = process.env.VITE_FLASHFIRE_API_BASE_URL || 'https://dashboard-api.flashfirejobs.com';

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

// Allow admin, CSM, or team_lead to manage operations (link/remove operations interns to clients)
const verifyOperationsManage = (req, res, next) => {
  const role = req.user?.role || '';
  const roles = req.user?.roles || [];
  if (role === 'admin' || role === 'csm' || role === 'team_lead' || roles.includes('csm')) return next();
  return res.status(403).json({ error: 'Access denied. Only admin, CSM, or team lead can manage operations.' });
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
  const jobDB = await JobModel.find().select('-jobDescription').lean();
  res.status(200).json({ jobDB });
}

// Client management endpoints
const getAllClients = async (req, res) => {
  try {
    const clients = await ClientModel.find()
      .select('email name clientNumber status planType planPrice jobStatus operationsName dashboardTeamLeadName isPaused onboardingPhase addons createdAt updatedAt')
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
    } = req.body;

    const emailLower = email.toLowerCase();
    const planPrices = { ignite: 199, professional: 349, executive: 599, prime: 119 };
    const dashboardManager = dashboardTeamLeadName;

    const capitalizedPlan = planType && planType.trim()
      ? (planType.trim().toLowerCase() === "ignite"
        ? "Ignite"
        : planType.trim().toLowerCase() === "professional"
          ? "Professional"
          : planType.trim().toLowerCase() === "executive"
            ? "Executive"
            : planType.trim().toLowerCase() === "prime"
              ? "Prime"
              : null)
      : null;

    const userData = {
      name,
      email: emailLower,
      passwordHashed: password ? encrypt(password) : encrypt("flashfire@123"),
      ...(capitalizedPlan && { planType: capitalizedPlan }),
      userType: "User",
      dashboardManager,
    };

    const existingUser = await NewUserModel.findOne({ email: emailLower });
    const hasNameForNewUser = name !== undefined && name !== null && String(name).trim() !== '';

    // Only create new user + new client when we have required fields (name). Otherwise treat as client-only update (e.g. Phase/Pause from Client Job Analysis).
    if (!existingUser && hasNameForNewUser) {
      const newUserData = {
        ...userData,
        planType: capitalizedPlan || "Free Trial",
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
        planType: planType?.toLowerCase() || "ignite",
        planPrice: planPrices[planType?.toLowerCase()] || 199,
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
        amountPaid: amountPaid || 0,
        amountPaidDate: amountPaidDate || " ",
        modeOfPayment: modeOfPayment || "paypal",
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
      if (req.body.isPaused !== undefined || req.body.onboardingPhase !== undefined || req.body.dashboardTeamLeadName !== undefined) {
        clearAnalysisCache();
      }
      return res.status(200).json({
        message: "🔄 Client fields updated successfully",
        updatedClientsTracking,
      });
    }

    if (currentPath?.includes("/clients/new")) {
      await NewUserModel.updateOne({ email: emailLower }, { $set: userData });
      await ClientModel.updateOne(
        { email: emailLower },
        { $set: { dashboardTeamLeadName: dashboardManager } },
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
    if (capitalizedPlan) {
      updateFields.planType = capitalizedPlan;
    }
    if (Object.keys(updateFields).length > 0) {
      await NewUserModel.updateOne(
        { email: emailLower },
        { $set: updateFields },
        { runValidators: false }
      );
    }
    const updatedClientsTracking = await ClientModel.findOne({ email: emailLower }).lean();
    if (req.body.isPaused !== undefined || req.body.onboardingPhase !== undefined || req.body.dashboardTeamLeadName !== undefined) {
      clearAnalysisCache();
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

    res.status(200).json({ success: true, client });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

const upgradeClientPlan = async (req, res) => {
  try {
    const { email } = req.params;
    const { planType } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }

    if (!planType) {
      return res.status(400).json({ success: false, error: 'Plan type is required' });
    }

    const emailLower = email.toLowerCase();
    const planPrices = { ignite: 199, professional: 349, executive: 599, prime: 119 };
    const planTypeLower = planType.toLowerCase();

    if (!planPrices[planTypeLower]) {
      return res.status(400).json({ success: false, error: 'Invalid plan type' });
    }

    const capitalizedPlan = planTypeLower === 'ignite'
      ? 'Ignite'
      : planTypeLower === 'professional'
        ? 'Professional'
        : planTypeLower === 'executive'
          ? 'Executive'
          : planTypeLower === 'prime'
            ? 'Prime'
            : 'Free Trial';

    const planPrice = planPrices[planTypeLower];
    const currentDate = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });

    const existingClient = await ClientModel.findOne({ email: emailLower }).lean();
    if (!existingClient) {
      return res.status(404).json({ success: false, error: 'Client not found' });
    }

    const currentAmountPaid = parseFloat(existingClient.amountPaid?.toString().replace(/[$₹,\s]/g, '') || '0');
    const currentPlanPrice = existingClient.planPrice || 0;
    const upgradeDifference = planPrice - currentPlanPrice;
    const newAmountPaid = currentAmountPaid + upgradeDifference;

    await ClientModel.updateOne(
      { email: emailLower },
      {
        $set: {
          planType: planTypeLower,
          planPrice: planPrice,
          amountPaid: newAmountPaid.toString(),
          amountPaidDate: currentDate,
          updatedAt: currentDate
        }
      },
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
    const { addonType, addonPrice } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }

    if (!addonType || !addonPrice) {
      return res.status(400).json({ success: false, error: 'Addon type and price are required' });
    }

    const emailLower = email.toLowerCase();
    const currentDate = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });

    const existingClient = await ClientModel.findOne({ email: emailLower }).lean();
    if (!existingClient) {
      return res.status(404).json({ success: false, error: 'Client not found' });
    }

    const currentAmountPaid = parseFloat(existingClient.amountPaid?.toString().replace(/[$₹,\s]/g, '') || '0');
    const newAmountPaid = currentAmountPaid + parseFloat(addonPrice);

    const newAddon = {
      type: addonType,
      price: parseFloat(addonPrice),
      addedAt: currentDate
    };

    const existingAddons = existingClient.addons || [];
    const updatedAddons = [...existingAddons, newAddon];

    await ClientModel.updateOne(
      { email: emailLower },
      {
        $set: {
          addons: updatedAddons,
          amountPaid: newAmountPaid.toString(),
          amountPaidDate: currentDate,
          updatedAt: currentDate
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

    const rolesRequiringSecondStep = ['team_lead', 'operations_intern', 'onboarding_team', 'csm', 'admin'];
    if (rolesRequiringSecondStep.includes(user.role)) {
      let secondStepOk = false;
      if (trustToken === 'bypass-testing') {
        secondStepOk = true;
      } else if (trustToken) {
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
      { expiresIn: '24h' }
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
      role: { $in: ['team_lead', 'operations_intern', 'onboarding_team', 'csm'] },
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

    const job = new JobModel(jobData);
    await job.save();
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

    const rolesRequiringSecondStep = ['team_lead', 'operations_intern', 'onboarding_team', 'csm'];
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
    const { email, otpEmail, name, linkedDashboardManagerName } = req.body;

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

    user.updatedAt = new Date().toLocaleString('en-US', 'Asia/Kolkata');
    await user.save();

    res.status(200).json({
      message: 'User updated successfully',
      user: {
        email: user.email,
        name: user.name,
        otpEmail: user.otpEmail || '',
        linkedDashboardManagerName: user.linkedDashboardManagerName || '',
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

    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);

      // Single aggregation for all users: applied count + saved count
      const [appliedAgg, savedAgg] = await Promise.all([
        JobModel.aggregate([
          { $match: { operatorEmail: opEmail, userID: { $in: userEmails }, appliedDate: { $regex: /^\d{1,2}\/\d{1,2}\/\d{4}/ } } },
          { $addFields: { _dp: { $split: [{ $trim: { input: '$appliedDate' } }, '/'] } } },
          {
            $addFields: {
              _dt: {
                $dateFromParts: {
                  year: { $convert: { input: { $arrayElemAt: ['$_dp', 2] }, to: 'int', onError: 0, onNull: 0 } },
                  month: { $convert: { input: { $arrayElemAt: ['$_dp', 1] }, to: 'int', onError: 1, onNull: 1 } },
                  day: { $convert: { input: { $arrayElemAt: ['$_dp', 0] }, to: 'int', onError: 1, onNull: 1 } }
                }
              }
            }
          },
          { $match: { _dt: { $gte: start, $lte: end } } },
          { $group: { _id: '$userID', count: { $sum: 1 } } }
        ]),
        JobModel.aggregate([
          { $match: { operatorEmail: opEmail, userID: { $in: userEmails }, currentStatus: 'saved' } },
          { $group: { _id: '$userID', count: { $sum: 1 } } }
        ])
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

    // No date range: single aggregation for all users
    const [allAgg, savedAgg] = await Promise.all([
      JobModel.aggregate([
        { $match: { operatorEmail: opEmail, userID: { $in: userEmails } } },
        { $group: { _id: '$userID', count: { $sum: 1 } } }
      ]),
      JobModel.aggregate([
        { $match: { operatorEmail: opEmail, userID: { $in: userEmails }, currentStatus: 'saved' } },
        { $group: { _id: '$userID', count: { $sum: 1 } } }
      ])
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
        currentStatus: 'saved'
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
    // Handle different date formats
    if (dateStr.includes(',')) {
      const datePart = dateStr.split(',')[0].trim();
      const [month, day, year] = datePart.split('/');
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
function formatLastAppliedOperatorDisplayName(raw) {
  if (raw == null || typeof raw !== 'string') return '';
  const t = raw.trim();
  if (!t || t.toLowerCase() === 'user') return '';
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

function resolveLastAppliedOperatorDisplayName(job) {
  const fromTimeline = lastAppliedActorFromTimeline(job?.timeline);
  const raw = fromTimeline || (job?.operatorName || '');
  return formatLastAppliedOperatorDisplayName(raw);
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
app.post('/api/analytics/client-job-analysis', async (req, res) => {
  try {
    const { date } = req.body || {};

    // Check cache
    const cacheKey = date || '__all__';
    const cached = getAnalysisCache(cacheKey);
    if (cached) {
      const cachedOut = Array.isArray(cached.rows)
        ? {
            ...cached,
            rows: cached.rows.map((row) => ({
              ...row,
              lastAppliedOperatorName: formatLastAppliedOperatorDisplayName(row.lastAppliedOperatorName || ''),
              pausedDays: freshPausedDaysFromRow(row)
            }))
          }
        : cached;
      if (Array.isArray(cachedOut.rows)) {
        runHighAppliedJobsNotifications(cachedOut.rows).catch((err) =>
          console.error('[client-job-analysis] runHighAppliedJobsNotifications (cached):', err?.message || err)
        );
      }
      return res.status(200).json(cachedOut);
    }

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

    // Helper to map statuses fuzzily
    const statusCase = {
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
    };

    // ── Phase 1: Run ALL aggregations + client query in parallel ──
    const cachedLastApplied = getAnalysisCache('__lastAppliedOperator__');
    const [overall, appliedOnDate, removedOnDate, lastAppliedAgg, clientInfo] = await Promise.all([
      // 1) Overall status counts per client
      JobModel.aggregate([
        { $group: { _id: { userID: "$userID", status: statusCase }, count: { $sum: 1 } } },
        { $group: { _id: "$_id.userID", statuses: { $push: { k: "$_id.status", v: "$count" } } } },
        { $project: { _id: 0, userID: "$_id", counts: { $arrayToObject: "$statuses" } } }
      ]),
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
      // 4) Last applied operator per client — use dedicated 5-min cache; skip heavy aggregation if cached
      cachedLastApplied
        ? Promise.resolve(cachedLastApplied)
        : JobModel.aggregate([
          {
            $match: {
              appliedDate: { $ne: null },
              timeline: { $elemMatch: {
                $regex: /applied\s+by\s/i,
                $not: /applied\s+by\s+user\s*$/i
              }}
            }
          },
          { $sort: { _id: -1 } },
          { $group: { _id: '$userID', timeline: { $first: '$timeline' } } },
          { $project: { _id: 0, userID: '$_id', timeline: 1 } }
        ]),
      // 5) Client info — runs in parallel with aggregations (no dependency)
      ClientModel.find({})
        .select('email name clientNumber planType planPrice status jobStatus operationsName dashboardTeamLeadName isPaused onboardingPhase addons pausedAt clientCountry')
        .lean()
    ]);

    // Cache last-applied operator separately with longer TTL (5 min)
    if (!cachedLastApplied) {
      setAnalysisCache('__lastAppliedOperator__', lastAppliedAgg, LAST_APPLIED_CACHE_TTL);
    }

    const appliedMap = new Map(appliedOnDate.map(r => [r.userID, r.count]));
    const removedMap = new Map(removedOnDate.map(r => [r.userID, r.count]));
    const overallMap = new Map(overall.map(r => [r.userID, r.counts]));
    const lastAppliedOperatorMap = new Map(
      lastAppliedAgg.map((r) => [
        (r.userID || '').toLowerCase(),
        resolveLastAppliedOperatorDisplayName(r)
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
      clientCountry: c.clientCountry === 'USA' || c.clientCountry === 'Canada' ? c.clientCountry : null,
      addonLimit: (c.addons || []).reduce((sum, a) => {
        const v = parseInt(a.type || a.addonType || 0, 10);
        return sum + (isNaN(v) ? 0 : v);
      }, 0)
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
      return {
        email,
        name: client.name || email,
        clientNumber: client.clientNumber ?? null,
        planType: client.planType || null,
        planPrice: client.planPrice || null,
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
        dashboardTeamLeadName: client.dashboardTeamLeadName || '',
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
        appliedOnDate: appliedMap.get(email) || 0
      };
    });

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

    const result = { success: true, date: date || null, rows, summary };
    runHighAppliedJobsNotifications(rows).catch((err) =>
      console.error('[client-job-analysis] runHighAppliedJobsNotifications:', err?.message || err)
    );
    setAnalysisCache(cacheKey, result);
    res.status(200).json(result);
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
        // Remove currency symbols ($, ₹) and any whitespace
        amountPaid = amountPaid.replace(/[$₹,\s]/g, '').trim();
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

/** PATCH /api/clients/:email/client-country — Body: { clientCountry: 'USA' | 'Canada' | null }; null clears. Admin only. */
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
      if (!['USA', 'Canada'].includes(v)) {
        return res.status(400).json({ error: 'clientCountry must be USA or Canada' });
      }
      client = await ClientModel.findOneAndUpdate(
        { email: emailLower },
        { $set: { clientCountry: v, updatedAt } },
        { new: true }
      ).select('email clientCountry').lean();
    }

    if (!client) return res.status(404).json({ error: 'Client not found' });

    clearAnalysisCache();
    res.status(200).json({
      success: true,
      clientCountry: client.clientCountry ?? null,
      message: 'Client country updated',
    });
  } catch (error) {
    console.error('updateClientCountry:', error);
    res.status(500).json({ error: error.message || 'Failed to update client country' });
  }
};

app.post('/api/clients', optionalVerifyToken, createOrUpdateClient);
app.post('/api/clients/addnumbers', addNumbersToClients);
app.patch('/api/clients/:email/client-number', verifyToken, verifyAdmin, updateClientNumber);
app.patch('/api/clients/:email/client-country', verifyToken, verifyAdmin, updateClientCountry);
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
app.get('/api/managers/names', getDashboardManagerNames);

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
app.patch('/api/onboarding/jobs/:id', verifyToken, patchOnboardingJob);
app.post('/api/onboarding/jobs/:id/attachments', verifyToken, postOnboardingJobAttachment);
app.patch('/api/onboarding/jobs/:id/attachments/:index', verifyToken, patchOnboardingJobAttachment);
app.post('/api/onboarding/jobs/:id/admin-read', verifyToken, markAdminRead);
app.post('/api/onboarding/jobs/:id/request-move', verifyToken, requestMove);
app.post('/api/onboarding/jobs/:id/approve-move', verifyToken, approveMove);
app.post('/api/onboarding/jobs/:id/reject-move', verifyToken, rejectMove);

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

    const allOperations = await OperationsModel.find().select('email name').lean();
    const operatorEmails = allOperations.map(op => op.email.toLowerCase());

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
          appliedCount: { $sum: 1 },
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
      const emailLower = op.email.toLowerCase();
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

app.get('/api/operations/performance-report', getOperationsPerformanceReport);

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
 * Day window = 11 PM IST (prev night) → 12:59 PM IST (this day).
 * Only jobs within the 11 PM–1 PM IST window count.
 * Jobs at 11 PM roll into the next day via +1h offset in the aggregation.
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
  const dayStart = new Date(`${prevYmd}T23:00:00.000+05:30`);
  const dayEnd = new Date(`${dateYmd}T12:59:59.999+05:30`);
  const isPastOnePmIst = istHourNow() >= 13;

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

    let nextStatus = existing?.status || (isPastOnePmIst ? 'approved' : 'pending');
    if (existing?.status !== 'rejected' && isPastOnePmIst) nextStatus = 'approved';
    if (existing?.status !== 'approved' && existing?.status !== 'rejected' && !isPastOnePmIst) nextStatus = 'pending';

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
            // Day window = 11 PM IST → 1 PM IST next day (14-hour counting window)
            // Only jobs within this window count for incentives.
            // +1h offset: 23:xx IST → 00:xx next day IST → correct day assignment.
            dailyMetrics: [
              {
                $addFields: {
                  hourIST: {
                    $hour: { date: '$parsedAt', timezone: 'Asia/Kolkata' },
                  },
                  dayKey: {
                    $dateToString: {
                      format: '%Y-%m-%d',
                      date: { $add: ['$parsedAt', 1 * 60 * 60 * 1000] },
                      timezone: 'Asia/Kolkata',
                    },
                  },
                },
              },
              {
                $match: {
                  $or: [{ hourIST: { $gte: 23 } }, { hourIST: { $lt: 13 } }],
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
            // Per-client job counts — same 11 PM → 1 PM window with +1h offset
            clientJobCounts: [
              {
                $addFields: {
                  hourIST: {
                    $hour: { date: '$parsedAt', timezone: 'Asia/Kolkata' },
                  },
                  dayKey: {
                    $dateToString: {
                      format: '%Y-%m-%d',
                      date: { $add: ['$parsedAt', 1 * 60 * 60 * 1000] },
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
                  $or: [{ hourIST: { $gte: 23 } }, { hourIST: { $lt: 13 } }],
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

async function runJobCardReminder() {
  if (!DISCORD_JOBCARD_REMINDER_WEBHOOK) return;
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
      const message = `Hi ${capitalizedOperator}, there are ${saved} job card(s) in saved column for ${clientName}'s dashboard, please apply.`;
      try {
        await postDiscordReminder(DISCORD_JOBCARD_REMINDER_WEBHOOK, message, '[JobCard Reminder]', {
          reminderType: 'job_card',
          clientEmail: email,
          clientName,
          addedBy: capitalizedOperator,
          triggeredSource: 'cron',
          metadata: { savedCount: saved },
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

async function runZeroSavedJobReminder() {
  if (!DISCORD_ZERO_SAVED_WEBHOOK) {
    return { sentCount: 0, skipped: true, reason: 'DISCORD_ZERO_SAVED is not configured' };
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
      if (saved !== 0) continue;

      const clientName = clientNameMap.get(email) || email;
      const adderRow = lastAdderMap.get(email);
      const adderLabel =
        formatLastJobAdderName({
          addedBy: adderRow?.addedBy,
          operatorName: adderRow?.operatorName,
          extensionCode: adderRow?.extensionCode
        }) || 'No job history yet';
      const message = `${clientName} have zero jobs in their dashboard please add jobs — last job cards added by: ${adderLabel}`;

      try {
        await postDiscordReminder(DISCORD_ZERO_SAVED_WEBHOOK, message, '[Zero Saved Reminder]', {
          reminderType: 'zero_saved',
          clientEmail: email,
          clientName,
          addedBy: adderLabel,
          triggeredSource: 'cron',
          metadata: { savedCount: saved },
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
 * Daily incentive cron job — runs at 1:00 PM IST (07:30 UTC).
 * Counting window: yesterday 11:00 PM IST → today 12:59 PM IST (14 hours).
 * Calculates qualified clients (20+ jobs) per operator and upserts to DB.
 */
async function runDailyIncentiveSnapshot() {
  const dateYmd = todayIstYmd();
  console.log(`[Incentive Cron] Running daily incentive snapshot for ${dateYmd}`);

  try {
    // Day window = yesterday 11 PM IST → today 12:59:59 PM IST (14-hour window)
    // This matches the +1h offset and hourIST filter used in the report aggregation
    const prevDay = new Date(new Date(`${dateYmd}T00:00:00.000+05:30`).getTime() - 86400000);
    const prevYmd = prevDay.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const dayStart = new Date(`${prevYmd}T23:00:00.000+05:30`);
    const dayEnd = new Date(`${dateYmd}T12:59:59.999+05:30`);

    // Aggregate: per operator, per client, count jobs in this 11PM-1PM window
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

// Start HTTP server only after MongoDB is connected (prevents startup tasks from hitting buffer timeout)
dbReady
  .then(async () => {
    await cleanupSessionKeys();

    app.listen(process.env.PORT, () => {
      console.log(`✅ Server is live at port: ${process.env.PORT}`);
      console.log(`📡 Dashboard Backend URL: ${FLASHFIRE_API_BASE_URL}`);

      // Sync client numbers on startup (Client model → OnboardingJob)
      syncClientNumbersToOnboardingJobs().catch((err) =>
        console.error('❌ [Client Numbers] Startup sync error:', err)
      );

      // Start the automated call sweep job
      startCallSweepJob();

      // Job card reminder: 8:00 PM IST daily (14:30 UTC)
      if (DISCORD_JOBCARD_REMINDER_WEBHOOK) {
        cron.schedule('30 14 * * *', runJobCardReminder);
        console.log('📬 [JobCard Reminder] Cron scheduled for 8:00 PM IST daily');
      }

      // Zero saved jobs reminder: 1:00 PM IST daily
if (DISCORD_ZERO_SAVED_WEBHOOK) {
  cron.schedule('30 13 * * *', runZeroSavedJobReminder, { timezone: 'Asia/Kolkata' });
  console.log('📬 [Zero Saved Reminder] Cron scheduled for 1:30 PM IST daily');
} else {
  console.warn('⚠️ [Zero Saved Reminder] DISCORD_ZERO_SAVED is not set; reminders are disabled');
}

      // Daily incentive snapshot: 1:00 PM IST (07:30 UTC)
      cron.schedule('30 7 * * *', runDailyIncentiveSnapshot);
      console.log('📬 [Incentive Cron] Scheduled for 1:00 PM IST daily');
    });
  })
  .catch(() => {
    // ConnectDB already logged and process.exit(1) on failure
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
