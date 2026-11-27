# Email campaigns

The private email workspace lives at https://nsumibc.online/admin/. It is an independent system from the ticket desk.

## Ownership and isolation

| Resource | Campaign system | Ticket system |
| --- | --- | --- |
| Browser page | `/admin/` | `/ticketmanagement/` |
| API | `/api/campaigns/*` | `/api/tm/*` |
| Session cookie | `campaign_session`, API path only | `tm_session` |
| Database | `mibc-campaigns`, Tanbin account | `mibc-tickets`, existing website account |
| Backend | `wrangler.campaigns.jsonc` | Existing `wrangler.jsonc` |
| Sender workflow | `campaign-sender.yml` | Existing `mail-sender.yml` |
| Runner secret | `CAMPAIGN_RUNNER_TOKEN` | `MAIL_RUNNER_TOKEN` |

The website forwards campaign requests over HTTPS to the separate backend. A private gateway token authenticates that connection. The backend rejects direct requests without that token. The browser still uses the main domain, and the user never sees a different service URL.

The campaign backend does not have ticket database or ticket-image bindings. The existing ticket sender is unchanged. Both senders currently use the same Hostinger mailbox; they therefore share its real provider quota. This system cannot see unrelated mailbox use. Lower its allowance if ticket or manual email volume is high.

## Accounts and roles

- **Main admins** sign in with an nsumibc.online address. They manage team lists, emails and sending, and can read the activity log.
- **Helpers** sign in with a short username. They see only Team lists: they can create lists from a sheet, add teams from another sheet, edit, add, delete and restore teams, and move teams between rounds. Emails, sending and the activity log are hidden from them.
- Every change by anyone is written to the activity log with the person's name, what changed, and the old and new values.

Add or reset an account by passing JSON over standard input to `node scripts/campaigns.mjs user`: `{"username":"...","password":"...","role":"admin"|"helper","name":"Display name"}`. Never put passwords in saved commands or repository files.

## Team lists

1. Download the registration sheet from Google Sheets as CSV (File, Download, Comma-separated values) and create a team list with a name and the number of rounds.
2. The importer reads the Team Name column and the repeated Name, Institute, Student ID, Email and Phone groups. Member 1 is the leader and the only recipient. The submitter email at the start of the row is ignored. A first heading renamed to "Leader Name" also works. Bangladeshi mobile numbers that lost their leading zero get it back.
3. Teams are sorted by team name. "Needs attention" lists teams with a missing team name, leader name or leader email, and teams that share a leader email or team name with another team. A duplicate can be kept on purpose by ticking "This is a different team".
4. Open a team to edit it. Changes save about a second after typing stops. If someone else changed the same team first, the editor says who and offers to load the latest version instead of overwriting it.
5. "Add teams from a sheet" never replaces anything. Teams whose team name or leader email already exist are skipped.
6. "Move qualified teams" takes pasted team names or leader emails, one per line. Unique matches are moved; duplicate names ask which team is meant; unknown lines are listed. Teams can also be ticked in the list and moved together. Moving a team back works the same way.

## Sending an email

1. Create an email and pick the team list. Under "Who gets it" choose All teams or Teams in Round N (teams that reached that round or later). Individual teams can be unticked. Teams with problems are skipped until they are fixed.
2. Write the subject and body. `{{team_name}}` and `{{leader_name}}` are replaced for each team. Paste from Google Docs keeps bold, italic, lists and links. For a case PDF, upload it at `/casemanagement/`, copy its share link and paste it in "Case link"; the email ends with an "Open the case" link. Everything autosaves.
3. Review and send shows the sender, audience, time needed and the 24-hour allowance. A test email is optional. A new test replaces one that is still waiting, and editing the email cancels a waiting test because it would show the old wording. Press "Send to N team leaders". The recipient list is copied at that moment, so later team edits never change an email that is already sending. Sending also cancels a test that has not gone out yet.
4. Start the sender: open the Campaign sender workflow in GitHub Actions (`https://github.com/iaevan/mibc-LP/actions/workflows/campaign-sender.yml`), press Run workflow and confirm. A run started by hand keeps waiting for 15 minutes when there is nothing to send, so it can be started just before Send, and Resume after a Stop continues without another click while it is waiting. The dashboard shows a warning with this link whenever an email is sending but the sender has not checked in for 90 seconds. GitHub's 10-minute schedule is unreliable and can be hours late, so do not wait for it.
5. The dashboard updates every 3 seconds while sending: progress bar, sent, waiting, failed and "check delivery" counts, latest activity and every team's status. "Stop sending now" takes effect before the next email; at most one email already handed to the mail server can still go out. Stopped emails can be resumed, failed ones retried, single teams resent, and results downloaded as CSV.

`Sent` means the mail server accepted the email. It is not proof of inbox delivery, and there is no open tracking.

## Limits and failure recovery

- Target: 20 attempts per minute, with a configurable maximum of 25 for Hostinger and at most 900 reserved attempts in a rolling 24 hours. Tests and resends count. Hostinger Business Starter's advertised mailbox limit is 1,000 messages per day; the 900 setting leaves some headroom but cannot reserve capacity against the other sender. The public limits page does not guarantee a specific minute-level SMTP allowance. Provider throttling pauses sending.
- At the 20-per-minute target, 500 team emails would take about 25 minutes plus provider and scheduling delays. Actual SMTP latency can reduce throughput. This does not remove the rolling daily allowance.
- The import/API data model is tested with 3,000 teams and accepts up to 10,000 within the upload size limit. Sending capacity is independent of import capacity.
- GitHub scheduled runs can be delayed. Each active run can continue for 330 minutes; subsequent runs pick up the queue. Runs exit promptly when idle. Manual **Run workflow** on Campaign sender can start a queued test without waiting for the schedule. Its optional `test_id` input claims only that queued test and stops after one attempt, so diagnostic runs cannot start unrelated participant sends.
- The SMTP sender reuses one secure pooled connection and processes one claim at a time. Provider refusal pauses the affected campaign; ambiguous outcomes still require review rather than automatic resend.
- GitHub may disable schedules in inactive public repositories. Check Actions if the dashboard's sender heartbeat stops.
- Claims and attempt reservations are atomic. Network retries reuse a claim; reporting is idempotent. A process crash after SMTP acceptance is treated as uncertain, rather than automatically retried.
- An abandoned claim becomes uncertain after ten minutes and pauses a running campaign. Check Hostinger Sent/provider logs or the recipient first. Then confirm delivery without resending, or explicitly retry while accepting the risk of a duplicate.
- Authentication, quota and transport trouble pauses the affected running campaign. Test failures leave the campaign editable in draft.
- Version checks reject conflicting saves of the same team or email from two browsers, and say who made the other change.
- Team lists, audiences and results are paginated and searchable. The attempt ledger keeps the full history in D1.

For higher volume, `scripts/campaign-sender/send.mjs` has a separate Brevo transport. Before changing `CAMPAIGN_PROVIDER` to `brevo`, authenticate the sending domain, set the hidden `CAMPAIGN_BREVO_API_KEY` Actions secret, and choose an allowance/rate matching the purchased or free provider plan. The account is not created or activated by this code. Keep imports and templates unchanged when replacing a transport.

## Deployment and credentials

Public website updates continue to use its existing Cloudflare deployment. The independent backend has the workflow **Deploy campaign backend**, triggered by changes to its modules, database migrations, dependency files or configuration on `main`. It applies only campaign migrations, runs campaign tests, and deploys only `mibc-campaigns`.

The deployment workflow requires `CLOUDFLARE_CAMPAIGNS_API_TOKEN`, scoped to the Tanbin account with Workers Scripts Write and D1 Write. Keep it in GitHub Actions secrets. A missing token produces an explicit failed deployment, rather than silently leaving the backend outdated.

Other secrets:

- `CAMPAIGN_GATEWAY_TOKEN`: the same private value in the main website Worker and campaign Worker. Rotate both together. Never expose it to browser bundles.
- `CAMPAIGN_RUNNER_TOKEN`: the same private value in the campaign Worker and the GitHub Actions secret. It does not authorize the ticket sender.
- `CAMPAIGN_SMTP_PASSWORD`: optional dedicated Actions secret. If absent, the campaign workflow uses the already configured `SMTP_PASSWORD` for `info@nsumibc.online`. It does not replace that existing secret.

Only password hashes are stored in D1. There are no login passwords in repository files. To add or reset an account, pass JSON with `username` and `password` through standard input to `node scripts/campaigns.mjs user`. Use an interactive credential prompt or password manager; do not put real passwords in saved shell commands. This revokes the account's existing sessions. `--local` changes only the local preview database.

API sessions expire after eight hours. Login failures are throttled by username and client address. Session cookies are HttpOnly, Secure on production and SameSite Strict. Administrative pages and APIs are not cached or indexed and do not initialize PostHog. Templates are sanitized on save and again after personalization; previews run in a sandboxed frame.

## Local development

```powershell
npm ci
npm run build
npm run test:campaigns
node scripts/campaigns.mjs local-config
node scripts/campaigns.mjs migrate --local
# Add a local account through standard input using the user operation above.
npx wrangler dev --config .wrangler/campaign-local.json --port 8791
```

Local preview binds only the local campaign database. It does not connect to the production sender. For queue tests, provide a synthetic `CAMPAIGN_RUNNER_TOKEN` to local Wrangler and simulate claim/report calls; never run the real SMTP sender against test data.

Create future schema changes in `campaign-migrations/`, never in the ticket `migrations/` folder. Preserve old queue states and attempt records when changing transports. Do not edit deployed migration files after they have been applied.

Operational references: [Hostinger mailbox limits](https://www.hostinger.com/support/4625828-parameters-and-limits-of-hostinger-email/), [GitHub Actions limits](https://docs.github.com/en/actions/reference/limits), [Cloudflare D1 limits](https://developers.cloudflare.com/d1/platform/limits/).
