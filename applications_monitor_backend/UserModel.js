import mongoose from "mongoose";

export const UserSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ["admin", "team_lead", "operations_intern", "onboarding_team", "csm", "bda"],
    required: true,
    default: "team_lead"
  },
  name: { type: String, trim: true, default: "" },
  otpEmail: { type: String, trim: true, lowercase: true, default: "" },
  // Personal Discord channel webhook — tag notifications + unresolved-comment
  // reminders are posted here when set.
  discordWebhookUrl: { type: String, trim: true, default: "" },
  linkedDashboardManagerName: { type: String, trim: true, default: "" },
  onboardingSubRole: {
    type: String,
    enum: ["resume_maker", "linkedin_and_cover_letter_optimization"],
    default: null
  },
  roles: [{ type: String }],
  lastResumeAssignedAt: { type: Date, default: null },
  lastLinkedInAssignedAt: { type: Date, default: null },
  isActive: {
    type: Boolean,
    required: true,
    default: true
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

export const UserModel = mongoose.model('tracking_portal_users', UserSchema);
// Indexes: see utils/ensureDbIndexes.js
