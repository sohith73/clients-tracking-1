#!/usr/bin/env node
/**
 * Starts the Discord onboarding TEST flow with a fake client. No database.
 *
 *   node scripts/discord-test-flow.mjs --client "sohith" --resume-maker <discordId> --csm <discordId> [--confirm]
 *
 * Reads DISCORD_BOT_TOKEN and DISCORD_GUILD_ID from
 * the environment and never prints them. Without --confirm it only prints the
 * plan and makes no network call. With --confirm it creates a text channel
 * "test-<client>" in the clients category and posts the first message. The rest of the flow is driven
 * by button clicks on the running backend (custom ids starting with "tst:").
 */
import { createDiscordApi } from '../discordBot/discordApi.js';
import { loadOnboardingConfig } from '../discordBot/config.js';
import { createClientChannel } from '../discordBot/channelPlacement.js';
import { buildTestFlowStart, parseTestFlowArgs, validateTestFlowInput } from '../discordBot/testFlow.js';

async function main() {
  const args = parseTestFlowArgs(process.argv.slice(2));
  const input = validateTestFlowInput(args, process.env, { requireToken: args.confirm });
  const start = buildTestFlowStart(input, new Date());

  console.log(`Channel: ${start.channelName}`);
  console.log(`Message: ${start.message.content}`);
  console.log(`Button:  ${start.message.components[0].components[0].custom_id}`);
  console.log(`Tags:    ${start.message.allowedUserIds.join(', ')}`);

  if (!args.confirm) {
    console.log('Dry run: nothing was sent. Add --confirm to post to Discord.');
    return;
  }

  const discord = createDiscordApi({ token: process.env.DISCORD_BOT_TOKEN, fetchImpl: fetch });
  const config = loadOnboardingConfig(process.env);
  const channels = (await discord.listGuildChannels(input.guildId)) || [];
  const made = await createClientChannel({
    discord,
    guildId: input.guildId,
    channels,
    baseName: config.categoryName,
    max: config.categoryMaxChannels,
    name: start.channelName,
    topic: 'Onboarding bot test channel, safe to delete',
  });
  const sent = await discord.postMessage(made.id, start.message);
  console.log(`Posted in channel ${made.id} (category ${made.categoryId}), message id ${sent?.id || 'unknown'}.`);
}

main().catch((err) => {
  console.error(`discord-test-flow failed: ${String(err?.message || err).slice(0, 300)}`);
  process.exit(1);
});
