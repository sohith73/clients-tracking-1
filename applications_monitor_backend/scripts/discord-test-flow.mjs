#!/usr/bin/env node
/**
 * Starts the Discord onboarding TEST flow with a fake client. No database.
 *
 *   node scripts/discord-test-flow.mjs --client "sohith" --resume-maker <discordId> --csm <discordId> [--confirm]
 *
 * Reads DISCORD_BOT_TOKEN, DISCORD_CLIENTS_CHANNEL_ID and DISCORD_GUILD_ID from
 * the environment and never prints them. Without --confirm it only prints the
 * plan and makes no network call. With --confirm it creates a public thread
 * "TEST <client>" and posts the first message. The rest of the flow is driven
 * by button clicks on the running backend (custom ids starting with "tst:").
 */
import { createDiscordApi } from '../discordBot/discordApi.js';
import { buildTestFlowStart, parseTestFlowArgs, validateTestFlowInput } from '../discordBot/testFlow.js';

async function main() {
  const args = parseTestFlowArgs(process.argv.slice(2));
  const input = validateTestFlowInput(args, process.env, { requireToken: args.confirm });
  const start = buildTestFlowStart(input, new Date());

  console.log(`Thread:  ${start.threadName}`);
  console.log(`Message: ${start.message.content}`);
  console.log(`Button:  ${start.message.components[0].components[0].custom_id}`);
  console.log(`Tags:    ${start.message.allowedUserIds.join(', ')}`);

  if (!args.confirm) {
    console.log('Dry run: nothing was sent. Add --confirm to post to Discord.');
    return;
  }

  const discord = createDiscordApi({ token: process.env.DISCORD_BOT_TOKEN, fetchImpl: fetch });
  const thread = await discord.createThread(input.channelId, { name: start.threadName });
  const sent = await discord.postMessage(thread.id, start.message);
  console.log(`Posted. Thread id ${thread.id}, message id ${sent?.id || 'unknown'}.`);
}

main().catch((err) => {
  console.error(`discord-test-flow failed: ${String(err?.message || err).slice(0, 300)}`);
  process.exit(1);
});
