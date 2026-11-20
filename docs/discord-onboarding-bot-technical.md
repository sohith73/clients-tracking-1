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
`onboardingSweep.js` finds new clients that still need a resume, LinkedIn work or a cover letter, and posts an alert with a button per need.
Everything is built lazily on the first request, so missing env vars never break boot.

## Request flow for a click
1. Discord sends the click with `x-signature-ed25519` and `x-signature-timestamp`.
2. The route rejects missing or invalid signatures with 401, and timestamps more than 5 minutes off.
3. `custom_id` must match `onb:<resume|linkedin|cover>:<24 hex userId>`.
4. The clicker must be a configured assignee or an active portal user with a stored `discordUserId` and role admin, team_lead or csm (or `csm` in `roles`).
5. The handler re-checks the database and never trusts the click.
6. If the need is done, the alert is marked resolved and the message is edited in place with the button removed.
7. If not, the clicker gets an ephemeral reply and the button stays.
Mentions in client names are neutralised, and resolved messages use `allowed_mentions: { parse: [] }`.

## Data it reads and writes
Reads:
- `users` collection (by ObjectId): `name`, `email`, `resumeLink`, `coverLetters`, `baseCoverLetter`.
- `OnboardingJob` (by `clientEmail`): `status`.
- `tracking_portal_users`: `discordUserId`, `role`, `roles`, `isActive`.

Writes:
- `discord_onboarding_alerts`: one row per user, need and IST day, with status `sent`, `dry_run`, `failed` or `resolved`, plus `resolvedBy` and `resolvedAt`.
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
