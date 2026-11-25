import mongoose from 'mongoose';

// One row per paid client who has no dashboard yet. The unique email index is the idempotency
// lock: the row is inserted BEFORE posting, so a CRM mark, a payment and a Stripe event for the
// same client can never post twice.
const PaidNoticeSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true },
    name: { type: String, default: '' },
    plan: { type: String, default: '' },
    amount: { type: Number, default: null },
    currency: { type: String, default: '' },
    country: { type: String, default: '' },
    source: { type: String, default: '' },
    // claimed: being posted now. posted: waiting for someone to create the dashboard. done: dashboard exists. failed: retry.
    status: { type: String, enum: ['claimed', 'posted', 'done', 'failed'], default: 'claimed' },
    channelId: { type: String, default: '' },
    messageId: { type: String, default: '' },
    lastRemindedDay: { type: String, default: '' },
    error: { type: String, default: '' },
  },
  { collection: 'discord_paid_notices', timestamps: true }
);

export const PaidNoticeModel =
  mongoose.models.PaidNotice || mongoose.model('PaidNotice', PaidNoticeSchema);
