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

## Organizer flow

1. Sign in with a campaign account and create a named campaign.
2. Upload the CSV exported from the registration spreadsheet. Google Forms repeated member headings are supported. The first participant group's email is selected, not the submission email at the beginning of a row. Other members are retained for team details but receive no email.
3. Review flagged rows. Correct or exclude missing/invalid recipients. Shared addresses require explicit confirmation. Save the team list. New imports do not overwrite the active list until the whole import succeeds.
4. Compose the subject and body. Paste formatted Google Docs content or upload HTML. Bold, italic, underline, lists, links, tables and basic alignment are supported. Scripts, external images and unsafe styling are removed. Save explicitly before leaving the step.
5. Use `{{team_name}}` and `{{recipient_name}}` in the subject or body. Choose a team in Review & test to see its personalized copy. Unsupported or incomplete placeholders block sending.
6. Queue a test to your own address. Wait for the scheduled sender and inspect the actual email. Provider acceptance of the current saved version is required before launch. Editing the template or team list invalidates the previous test.
7. Start sending only after reviewing the selected recipients. Launch freezes the campaign and recipient list; create a new campaign when content needs to change after launch.
8. Use Sending & results to pause, resume, search, filter, export results, retry failed emails or resend an individual copy. A paused sender may finish its one in-progress email.

`Provider accepted` is not proof of inbox delivery. Hostinger SMTP does not supply a recipient delivery webhook here, so bounces, spam placement and opens are not presented as delivery facts. There is no tracking pixel.

## Limits and failure recovery

- Defaults: one attempt per minute and at most 900 reserved attempts in a rolling 24 hours. Tests and resends count. Hostinger Business Starter's advertised mailbox limit is 1,000 messages per day; the 900 setting leaves some headroom but cannot reserve capacity against the other sender.
- At one per minute, 500 team emails take about 8 hours 20 minutes, plus scheduling delays. This configuration does not promise 3,000 recipients in one or two hours.
- The import/API data model is tested with 3,000 teams and accepts up to 10,000 within the upload size limit. Sending capacity is independent of import capacity.
- GitHub scheduled runs can be delayed. Each active run can continue for 330 minutes; subsequent runs pick up the queue. Runs exit promptly when idle. Manual **Run workflow** on Campaign sender can start a queued test without waiting for the schedule.
- GitHub may disable schedules in inactive public repositories. Check Actions if the dashboard's sender heartbeat stops.
- Claims and attempt reservations are atomic. Network retries reuse a claim; reporting is idempotent. A process crash after SMTP acceptance is treated as uncertain, rather than automatically retried.
- An abandoned claim becomes uncertain after ten minutes and pauses a running campaign. Check Hostinger Sent/provider logs or the recipient first. Then confirm delivery without resending, or explicitly retry while accepting the risk of a duplicate.
- Authentication, quota and transport trouble pauses the affected running campaign. Test failures leave the campaign editable in draft.
- Draft version checks reject conflicting saves from two browsers. Reload and review instead of overwriting another organizer's changes.
- Team cards are paginated and searchable. Attempt history shows the latest 500 attempts across the campaign; the ledger retains the full history in D1.

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
