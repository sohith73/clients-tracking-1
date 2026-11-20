import mongoose from 'mongoose';

// One row per client, need and IST day. The unique index is the idempotency
// lock: a row is inserted BEFORE posting, so concurrent runs cannot double-post.
const DiscordOnboardingAlertSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    need: { type: String, enum: ['resume', 'linkedin', 'coverLetter'], required: true },
    istDay: { type: String, required: true },
    // 'claimed' is the in-flight state set by tryClaimAlert before posting.
    status: { type: String, enum: ['claimed', 'sent', 'dry_run', 'failed', 'resolved'], default: 'claimed' },
    messageId: { type: String, default: '' },
    threadId: { type: String, default: '' },
    error: { type: String, default: '' },
    resolvedBy: { type: String, default: '' },
    resolvedAt: { type: Date, default: null },
  },
  { collection: 'discord_onboarding_alerts', timestamps: true }
);

DiscordOnboardingAlertSchema.index({ userId: 1, need: 1, istDay: 1 }, { unique: true });

export const DiscordOnboardingAlertModel =
  mongoose.models.DiscordOnboardingAlert ||
  mongoose.model('DiscordOnboardingAlert', DiscordOnboardingAlertSchema);
