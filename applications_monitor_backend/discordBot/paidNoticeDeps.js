/**
 * Real deps for paidNotice.js, on top of mongoose. Writes only to the paid notice model.
 * Reads users and dashboardtrackings (the same database the dashboard uses). Not tested against a real database.
 */
import mongoose from 'mongoose';
import { PaidNoticeModel } from './PaidNoticeModel.js';

const lower = (s) => String(s || '').trim().toLowerCase();
// A 'claimed' row older than this was abandoned by a crashed run.
const STALE_CLAIM_MS = 15 * 60 * 1000;

/** @param {{discord: object}} p */
export function createPaidNoticeDeps({ discord }) {
  const db = () => mongoose.connection.db;
  return {
    discord,

    /** True when a dashboard user exists under this email, or a client record has it as its CRM email. */
    async dashboardExists(email) {
      const e = lower(email);
      const [user, tracking] = await Promise.all([
        db().collection('users').findOne({ email: e }, { projection: { _id: 1 } }),
        db().collection('dashboardtrackings').findOne({ $or: [{ email: e }, { crmEmail: e }] }, { projection: { _id: 1 } }),
      ]);
      return Boolean(user || tracking);
    },

    /** True only if this call took the row: inserted it, or reclaimed a failed or abandoned one. */
    async claim({ email, name, plan, amount, currency, country, source }) {
      const e = lower(email);
      try {
        await PaidNoticeModel.create({ email: e, name, plan, amount, currency, country, source, status: 'claimed' });
        return true;
      } catch (err) {
        if (err?.code !== 11000) throw err;
        const staleBefore = new Date(Date.now() - STALE_CLAIM_MS);
        const r = await PaidNoticeModel.updateOne(
          { email: e, $or: [{ status: 'failed' }, { status: 'claimed', updatedAt: { $lt: staleBefore } }] },
          { $set: { status: 'claimed', error: '' } }
        );
        return r.modifiedCount === 1;
      }
    },

    async markPosted({ email, channelId, messageId, day }) {
      await PaidNoticeModel.updateOne(
        { email: lower(email) },
        { $set: { status: 'posted', channelId, messageId, lastRemindedDay: day, error: '' } }
      );
    },

    async markFailed({ email, error }) {
      await PaidNoticeModel.updateOne({ email: lower(email) }, { $set: { status: 'failed', error: String(error || '').slice(0, 300) } });
    },

    async markDone(email) {
      await PaidNoticeModel.updateOne({ email: lower(email) }, { $set: { status: 'done' } });
    },

    async listPending({ since }) {
      return PaidNoticeModel.find({ status: 'posted', createdAt: { $gte: since } }).sort({ createdAt: 1 }).lean();
    },

    /** True only for the first caller each IST day (one atomic update), so 8:00 and 8:30 never both remind. */
    async claimReminder({ email, day }) {
      const r = await PaidNoticeModel.updateOne(
        { email: lower(email), status: 'posted', lastRemindedDay: { $ne: day } },
        { $set: { lastRemindedDay: day } }
      );
      return r.modifiedCount === 1;
    },

    /** Give the day back after a failed post so the next run can retry. */
    async releaseReminder({ email, day }) {
      await PaidNoticeModel.updateOne({ email: lower(email), lastRemindedDay: day }, { $set: { lastRemindedDay: '' } });
    },

    async setChannel({ email, channelId }) {
      await PaidNoticeModel.updateOne({ email: lower(email) }, { $set: { channelId } });
    },

    /** The channel made at payment time for a client, looked up by any of their emails. */
    async findNoticeChannel(emails) {
      const list = [...new Set((emails || []).map(lower).filter(Boolean))];
      if (!list.length) return null;
      const row = await PaidNoticeModel.findOne({ email: { $in: list }, channelId: { $ne: '' }, status: { $in: ['posted', 'done'] } }).sort({ createdAt: -1 }).lean();
      return row ? { email: row.email, channelId: row.channelId } : null;
    },
  };
}
