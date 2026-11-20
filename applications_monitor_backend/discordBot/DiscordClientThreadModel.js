import mongoose from 'mongoose';

// One Discord thread per client, reused across days.
const DiscordClientThreadSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true },
    clientEmail: { type: String, default: '' },
    threadId: { type: String, required: true },
    channelId: { type: String, default: '' },
    guildId: { type: String, default: '' },
  },
  { collection: 'discord_client_threads', timestamps: true }
);

export const DiscordClientThreadModel =
  mongoose.models.DiscordClientThread ||
  mongoose.model('DiscordClientThread', DiscordClientThreadSchema);
