/**
 * Real deps for the onboarding sweep, on top of mongoose.
 * Read-only against users, onboardingjobs and tracking_portal_users (they share
 * one MongoDB with the dashboard backend, reached via mongoose.connection.db
 * like the rest of index.js). Writes only go to the two Discord models.
 * Not tested against a real database.
 */
import mongoose from 'mongoose';
import { DiscordClientThreadModel } from './DiscordClientThreadModel.js';
import { DiscordOnboardingAlertModel } from './DiscordOnboardingAlertModel.js';

// Never project credentials (passwordHashed and friends).
const USER_PROJECTION = {
  _id: 1,
  name: 1,
  email: 1,
  planType: 1,
  createdAt: 1,
  resumeLink: 1,
  coverLetters: 1,
  baseCoverLetter: 1,
  dashboardManager: 1,
};

// A 'claimed' alert older than this is treated as abandoned by a crashed run.
const STALE_CLAIM_MS = 15 * 60 * 1000;

const lower = (s) => String(s || '').trim().toLowerCase();

/**
 * @param {{discord: object}} p
 */
export function createMongoDeps({ discord }) {
  const db = () => mongoose.connection.db;

  return {
    discord,

    async listCandidateClients({ since, excludePlans }) {
      const users = await db()
        .collection('users')
        .find({ createdAt: { $gte: since }, planType: { $nin: excludePlans } }, { projection: USER_PROJECTION })
        .toArray();
      if (users.length === 0) return [];

      const emails = [...new Set(users.map((u) => lower(u.email)).filter(Boolean))];
      const jobs = await db()
        .collection('onboardingjobs')
        .find(
          { clientEmail: { $in: emails } },
          { projection: { clientEmail: 1, clientNumber: 1, status: 1, csmEmail: 1, csmName: 1, resumeMakerEmail: 1, resumeMakerName: 1, createdAt: 1 } }
        )
        .toArray();
      // Most recent job per email.
      const jobByEmail = new Map();
      for (const j of jobs) {
        const k = lower(j.clientEmail);
        const prev = jobByEmail.get(k);
        if (!prev || new Date(j.createdAt || 0) > new Date(prev.createdAt || 0)) jobByEmail.set(k, j);
      }

      const csmEmails = [...new Set([...jobByEmail.values()].map((j) => lower(j.csmEmail)).filter(Boolean))];
      const csms = csmEmails.length
        ? await db()
            .collection('tracking_portal_users')
            .find(
              { email: { $in: csmEmails }, $or: [{ role: 'csm' }, { roles: 'csm' }] },
              { projection: { email: 1, name: 1, discordUserId: 1 } }
            )
            .toArray()
        : [];
      const csmByEmail = new Map(csms.map((c) => [lower(c.email), c]));

      // One extra query for the resume makers (any portal role, matched by email).
      const makerEmails = [...new Set([...jobByEmail.values()].map((j) => lower(j.resumeMakerEmail)).filter(Boolean))];
      const makers = makerEmails.length
        ? await db()
            .collection('tracking_portal_users')
            .find({ email: { $in: makerEmails } }, { projection: { email: 1, name: 1, discordUserId: 1 } })
            .toArray()
        : [];
      const makerByEmail = new Map(makers.map((m) => [lower(m.email), m]));

      return users.map((user) => {
        const onboardingJob = jobByEmail.get(lower(user.email)) || null;
        return {
          user,
          onboardingJob,
          csmPortalUser: csmByEmail.get(lower(onboardingJob?.csmEmail)) || null,
          resumeMakerPortalUser: makerByEmail.get(lower(onboardingJob?.resumeMakerEmail)) || null,
        };
      });
    },

    async getThread(userId) {
      const row = await DiscordClientThreadModel.findOne({ userId }).lean();
      return row ? { threadId: row.threadId, channelId: row.channelId } : null;
    },

    async saveThread({ userId, clientEmail, threadId, channelId, guildId }) {
      await DiscordClientThreadModel.updateOne(
        { userId },
        { $set: { clientEmail, threadId, channelId, guildId } },
        { upsert: true }
      );
    },

    /**
     * Insert the unique row; true only if this call created it. A 'failed' row
     * is flipped back to claimed atomically so a retry can post. A claimed row
     * older than STALE_CLAIM_MS (crashed run) is reclaimable the same way.
     */
    async tryClaimAlert({ userId, need, istDay }) {
      try {
        await DiscordOnboardingAlertModel.create({ userId, need, istDay, status: 'claimed' });
        return true;
      } catch (e) {
        if (e?.code !== 11000) throw e;
        // Reclaim a failed row, or a 'claimed' row nobody finished (the process
        // died between claim and post). The filter + $set is one atomic update, so
        // two runs racing for the same row cannot both win: the winner refreshes
        // updatedAt, which makes the row ineligible for the loser.
        const staleBefore = new Date(Date.now() - STALE_CLAIM_MS);
        const r = await DiscordOnboardingAlertModel.updateOne(
          {
            userId,
            need,
            istDay,
            $or: [{ status: 'failed' }, { status: 'claimed', updatedAt: { $lt: staleBefore } }],
          },
          { $set: { status: 'claimed', error: '' } }
        );
        return r.modifiedCount === 1;
      }
    },

    async markAlert({ userId, need, istDay, status, messageId = '', threadId = '', error = '' }) {
      await DiscordOnboardingAlertModel.updateOne(
        { userId, need, istDay },
        { $set: { status, messageId, threadId, error } }
      );
    },

    async countAlertDays({ userId, need }) {
      return DiscordOnboardingAlertModel.countDocuments({ userId, need, status: { $in: ['sent', 'resolved'] } });
    },
  };
}
