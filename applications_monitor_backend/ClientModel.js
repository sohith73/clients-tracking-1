import mongoose from "mongoose";

export const ClientSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  clientNumber: {
    type: Number,
    required: false,
    default: null
  },
  jobDeadline: {
    type: String,
    required: true,
    default: ' '
  },
  applicationStartDate: {
    type: String,
    required: true,
    default: ' '
  },
  dashboardInternName: {
    type: String,
    required: true,
    default: ' '
  },
  dashboardTeamLeadName: {
    type: String,
    required: true,
    default: ' '
  },
  planType: {
    type: String,
    enum: ["ignite", "professional", "executive", "prime"],
    required: true,
    default: "ignite"
  },
  planPrice: {
    type: Number,
    required: true,
    default: 199
  },
  onboardingDate: {
    type: String,
    required: true,
    default: Date.now()
  },
  whatsappGroupMade: {
    type: Boolean,
    required: true,
    default: false
  },
  whatsappGroupMadeDate: {
    type: String,
    required: true,
    default: ' '
  },
  dashboardCredentialsShared: {
    type: Boolean,
    required: true,
    default: false
  },
  dashboardCredentialsSharedDate: {
    type: String,
    required: true,
    default: ' '
  },
  resumeSent: {
    type: Boolean,
    required: true,
    default: false
  },
  resumeSentDate: {
    type: String,
    required: true,
    default: ' '
  },
  coverLetterSent: {
    type: Boolean,
    required: true,
    default: false
  },
  coverLetterSentDate: {
    type: String,
    required: true,
    default: ' '
  },
  portfolioMade: {
    type: Boolean,
    required: true,
    default: false
  },
  portfolioMadeDate: {
    type: String,
    required: false,
    default: ' '
  },
  linkedinOptimization: {
    type: Boolean,
    required: true,
    default: false
  },
  linkedinOptimizationDate: {
    type: String,
    required: true,
    default: ' '
  },
  gmailCredentials: {
    email: {
      type: String,
      required: false,
      default: ""
    },
    password: {
      type: String,
      required: false,
      default: ""
    }
  },
  dashboardCredentials: {
    username: {
      type: String,
      required: false,
      default: ""
    },
    password: {
      type: String,
      required: false,
      default: ""
    }
  },
  linkedinCredentials: {
    username: {
      type: String,
      required: false,
      default: ""
    },
    password: {
      type: String,
      required: false,
      default: ""
    }
  },
  amountPaid: {
    type: String,
    required: false,
    default: '0'
  },
  amountPaidDate: {
    type: String,
    required: true,
    default: ' '
  },
  modeOfPayment: {
    type: String,
    enum: ["paypal", "wire_transfer", "inr"],
    required: true,
    default: "paypal"
  },
  /** Client Job Analysis: USA vs Canada (optional until set). */
  clientCountry: {
    type: String,
    enum: ["USA", "Canada"],
    required: false,
    default: undefined,
  },
  status: {
    type: String,
    enum: ["active", "inactive"],
    required: true,
    default: "active"
  },
  isPaused: {
    type: Boolean,
    required: false,
    default: false
  },
  /** Set when client enters explicit Paused (not New/onboarding). Cleared on unpause. Used for "days paused" on onboarding cards. */
  pausedAt: {
    type: Date,
    required: false,
    default: null
  },
  /** True while client is in onboarding (resume, LinkedIn, etc.). No Discord reminders until ticket reaches Applications In Progress. */
  onboardingPhase: {
    type: Boolean,
    required: false,
    default: false
  },
  jobStatus: {
    type: String,
    enum: ["still_searching", "job_done"],
    required: true,
    default: "still_searching"
  },
  companyName: {
    type: String,
    required: true,
    default: ' '
  },
  lastApplicationDate: {
    type: String,
    required: true,
    default: ' '
  },
  operationsName: {
    type: String,
    required: false,
    default: '',
    trim: true
  },
  addons: {
    type: Array,
    required: false,
    default: []
  },
  createdAt: {
    type: String,
    default: () => new Date().toLocaleString('en-US', 'Asia/Kolkata'),
    required: true,
    immutable: true
  },
  updatedAt: {
    type: String,
    required: true,
    default: () => new Date().toLocaleString('en-US', 'Asia/Kolkata')
  }
});

export const ClientModel = mongoose.model('DashboardTracking', ClientSchema);
