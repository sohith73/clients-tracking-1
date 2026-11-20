# Discord onboarding bot: technical notes

## Architecture
The bot is an HTTP interactions endpoint, not a gateway (websocket) bot.
Discord POSTs button clicks to `POST /api/discord/interactions`, and the bot answers in the HTTP response.
We chose this because the host suspends idle web services, and a gateway bot needs a process that stays alive.
Posting messages happens in a daily sweep, triggered by a GitHub Action calling `POST /api/internal/run-discord-onboarding`.
There is no in-process node-cron job for this feature.

Code lives in `applications_monitor_backend/discordBot/`.
`discordRoutes.js` registers both routes before the global `express.json()`, because Discord signature checks need the raw body.
`interactions.js` handles the button click.
`onboardingSweep.js` finds new clients that still need a resume, LinkedIn work or a cover letter, and starts the sequence below in the client's thread.
Everything is built lazily on the first request, so missing env vars never break boot.

## Sequential flow
Everything happens inside the client's thread, strictly in this order.
1. Resume stage: the 8 AM sweep posts "Resume not made for {client}" and tags the resume maker.
2. The resume maker comes from the latest onboarding job (`resumeMakerEmail`, `resumeMakerName`), matched to a `tracking_portal_users` doc.
3. The tag uses that doc's `discordUserId`, else a name match against guild members.
4. If no resume maker resolves, the sweep tags the CSM, and if that fails too it prints `CSM not matched: {name}` as plain text.
5. When the resume button is clicked and the database re-check confirms it, the handler edits the message to the resolved text and removes the button.
6. In the same click the handler posts a new message in the thread tagging every LinkedIn/cover letter assignee (`DISCORD_PRANJAL_USER_IDS`).
7. That message has one button per need the plan has: Executive gets "LinkedIn done" and "Cover letter done", Professional gets "LinkedIn done", other plans get none and skip to the final message.
8. Each LinkedIn or cover letter click is re-checked against the database and removes only its own button.
9. When no button is left on the message, the handler posts the final message tagging the CSM: "Please start the applications for {client}. ..." with no button.
10. If the CSM id is unknown the final message tags nobody and says `CSM not matched: {name}`.
11. If the resume is already linked at sweep time but LinkedIn or cover letter is pending, the sweep posts the step 6 message directly and no resume message.
12. If everything is already done at sweep time the sweep posts nothing. The final message is only ever posted by a button click.
13. The handler records the step 6 message as alert rows with status `sent` (`recordFollowUp`) so the next sweep does not repeat it for the same IST day while buttons are open.
14. A failed follow-up post never turns a verified click into an error: the click stays resolved and one line is logged without secrets.

## custom_id contract
Button state is carried in the `custom_id`, so no extra database state is needed.

| Format | Use |
| --- | --- |
| `onb:<need>:<userId 24 hex>:<csmId>` | Real flow. `<csmId>` is the CSM Discord user id (digits) or `0` when unknown. |
| `onb:<need>:<userId 24 hex>` | Legacy buttons already posted. CSM is treated as unknown. |
| `tst:<step>:<csmId>:<resumeMakerId>` | Test flow. Both ids are digits only. |

`need` and `step` are one of `resume`, `linkedin`, `cover`.
The parser is a strict regex, anything else is answered with "Not supported" before any database or auth call.
The longest possible id is 64 characters, under Discord's limit of 100, and a test pins that.

## Request flow for a click
1. Discord sends the click with `x-signature-ed25519` and `x-signature-timestamp`.
2. The route rejects missing or invalid signatures with 401, and timestamps more than 5 minutes off.
3. `custom_id` must match one of the formats above.
4. The clicker must be a configured assignee, an id in `DISCORD_ALLOWED_CLICKER_IDS`, or an active portal user with a stored `discordUserId` and role admin, team_lead or csm (or `csm` in `roles`), or an `onboarding_team` user whose `onboardingSubRole` is `resume_maker`.
5. The handler re-checks the database and never trusts the click.
6. If the need is done, the alert is marked resolved, the message is edited in place, and the next step of the sequence runs.
7. If not, the clicker gets an ephemeral reply and the button stays.
Mentions in client names are neutralised, every post lists only the ids it means to mention in `allowedUserIds`, and edits use `allowed_mentions: { parse: [] }`.
Messages never contain resume URLs or credentials.

## Test flow
The test flow runs the same sequence for a fake client with no database access.
Test clicks never call `loadUser`, `loadOnboardingJob`, `markResolved` or `recordFollowUp`.
The database re-check is skipped, but the same clicker rule (`canClick`) applies.
The test client is treated as Executive, so the resume click posts both buttons and the last click posts the final message tagging `<@csmId>`.
The client name comes from the thread name (`TEST <client>`, sanitised), never from the message text.
Every test message starts with `[TEST]`.

Start it with the script, which needs `DISCORD_BOT_TOKEN`, `DISCORD_CLIENTS_CHANNEL_ID` and `DISCORD_GUILD_ID` in the environment:
```
node scripts/discord-test-flow.mjs --client "sohith" --resume-maker <discordId> --csm <discordId>
node scripts/discord-test-flow.mjs --client "sohith" --resume-maker <discordId> --csm <discordId> --confirm
```
Without `--confirm` it only prints what it would do and makes no network call.
With `--confirm` it creates a public thread `TEST <client>` and posts the first message with the button `tst:resume:<csmId>:<resumeMakerId>`.
The backend must be running with the Discord interactions endpoint live so the clicks are answered.

## Data it reads and writes
Reads:
- `users` collection (by ObjectId): `name`, `email`, `resumeLink`, `coverLetters`, `baseCoverLetter`.
- `users` also supplies `planType`, which decides the LinkedIn and cover letter needs.
- `OnboardingJob` (by `clientEmail`): `status`, `csmName`, `resumeMakerEmail`, `resumeMakerName`.
- `tracking_portal_users`: `discordUserId`, `role`, `roles`, `isActive`, `onboardingSubRole`, and the resume maker docs (one extra `$in` query by lowercased email).

Writes:
- `discord_onboarding_alerts`: one row per user, need and IST day, with status `sent`, `dry_run`, `failed` or `resolved` (the click handler also upserts `sent` rows for the LinkedIn and cover letter message), plus `resolvedBy` and `resolvedAt`.
- `discord_client_threads` (owned by the sweep).
- New field `discordUserId` on `tracking_portal_users`, filled by an admin. No index is needed for it at this size.

## Environment variables
| Variable | Purpose |
| --- | --- |
| `DISCORD_BOT_TOKEN` | Bot token. If missing, routes answer 503. |
| `DISCORD_APP_PUBLIC_KEY` | Verifies interaction signatures. |
| `DISCORD_APPLICATION_ID` | Application id. |
| `DISCORD_GUILD_ID` | Server id. |
| `DISCORD_CLIENTS_CHANNEL_ID` | Channel where client threads live. |
| `DISCORD_PRANJAL_USER_IDS` | Comma-separated Discord ids of the LinkedIn and cover letter assignees. |
| `DISCORD_ONBOARDING_ENABLED` | Master switch. Defaults to false. |
| `DISCORD_BOT_DRY_RUN` | Defaults to true. Records what would be sent without posting. |
| `DISCORD_CRON_SECRET` | Required for the sweep route. Unset means 503, never open. Header `x-cron-secret` only. |
| `DISCORD_NEW_CLIENT_DAYS` | Age limit for a client to count as new. |
| `DISCORD_ALLOW_CREATE_CHANNEL` | Lets the bot create a channel when none exists. |

The GitHub repo needs a secret `DISCORD_CRON_SECRET` with the same value.

## Go-live checklist
1. Set all env vars on the host, keeping `DISCORD_ONBOARDING_ENABLED=false` and `DISCORD_BOT_DRY_RUN=true`.
2. Deploy the backend.
3. In the Discord developer portal, set the Interactions Endpoint URL to `https://<backend>/api/discord/interactions`. Discord sends a PING and the save succeeds only if signature checks pass.
4. Fill `discordUserId` for the CSM team in the portal users.
5. Run the "Discord Onboarding Cron" workflow with `workflow_dispatch` for a dry run.
6. Review the summary counts and the `dry_run` rows in `discord_onboarding_alerts`.
7. Set `DISCORD_BOT_DRY_RUN=false` and `DISCORD_ONBOARDING_ENABLED=true`, then redeploy.
8. Watch the next 8:00 AM IST run (cron `30 2 * * *` UTC).

## Rollback
Set `DISCORD_ONBOARDING_ENABLED=false` and redeploy.
The sweep stops posting, and existing buttons keep working until you also remove the bot from the server.
To stop interaction handling, clear the Interactions Endpoint URL in the developer portal.

## Open product questions
- Which Pranjal accounts should receive LinkedIn and cover letter alerts, and are the Discord ids final?
- What is the definition of a new client: age in days since signup, plan start, or onboarding job status?
- What does "LinkedIn done" mean: job status at or past `linkedin_done`, or a field on the client?
- What does "cover letter done" mean: job status, an uploaded cover letter, or a base cover letter key?
- Should Sunday be skipped, as client mail is?

## Tests
Run `npm test` in `applications_monitor_backend`.
Interactions and routes are tested with fakes, and the routes test signs requests with a freshly generated ed25519 key.
