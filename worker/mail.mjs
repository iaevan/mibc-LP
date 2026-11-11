// Ticket email queue. The GitHub Actions sender (.github/workflows/mail-sender.yml)
// asks this API for the next person about once a minute, sends through the
// club's Hostinger mailbox, and reports back. Workers cannot send through
// Hostinger SMTP themselves: its servers sit on Cloudflare IPs, which Worker
// sockets may not connect to. Test users (source = 'test') always go first.

import { renderEmail, ticketFileName } from './mail-template.mjs';
import { sha256Hex } from './ticketing-shared.mjs';

const EVENT_ID = 1;
const STUCK_MS = 10 * 60 * 1000;
const MAX_FAILURES_IN_ROW = 3;

export class MailError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' },
  });
}

async function readBody(request) {
  try { return await request.json(); } catch { return {}; }
}

function runnerReady(env) {
  return Boolean(env.MAIL_RUNNER_TOKEN);
}

async function getCampaign(env) {
  const row = await env.DB.prepare('SELECT * FROM mail_campaign WHERE id = 1').first();
  if (!row) throw new MailError(503, 'Run the mail database migration first');
  return {
    state: row.state,
    scope: row.scope,
    failuresInRow: row.failures_in_row,
    lastError: row.last_error,
    lastTickAt: row.last_tick_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

function setCampaign(env, fields, username = null) {
  const keys = Object.keys(fields);
  const sets = keys.map(key => `${key} = ?`).join(', ');
  return env.DB.prepare(`UPDATE mail_campaign SET ${sets}, updated_at = ?, updated_by = COALESCE(?, updated_by) WHERE id = 1`)
    .bind(...keys.map(key => fields[key]), Date.now(), username);
}

const scopeFilter = "(? = 'all' OR source = 'test')";

async function status(env) {
  const campaign = await getCampaign(env);
  const rows = await env.DB.prepare(`SELECT id, name, email, source, mail_status, mail_attempts, mail_error, mail_sent_at, ticket_ready_at
    FROM attendees WHERE event_id = ? ORDER BY source = 'test' DESC, id`).bind(EVENT_ID).all();
  const people = rows.results.map(row => ({
    id: row.id,
    name: row.name,
    email: row.email,
    test: row.source === 'test',
    status: row.email ? row.mail_status : 'no_email',
    attempts: row.mail_attempts,
    error: row.mail_error,
    sentAt: row.mail_sent_at,
    ticketReady: Boolean(row.ticket_ready_at),
  }));
  return json({ campaign, people, runnerReady: runnerReady(env), from: env.SMTP_USER ?? null, serverTime: Date.now() });
}

async function start(request, env, username) {
  const body = await readBody(request);
  const scope = body.scope === 'test' ? 'test' : 'all';
  if (!runnerReady(env)) throw new MailError(409, 'The MAIL_RUNNER_TOKEN secret is not set on the Worker yet.');
  const missing = await env.DB.prepare(`SELECT COUNT(*) AS count FROM attendees WHERE event_id = ? AND email IS NOT NULL
    AND mail_status = 'pending' AND ticket_ready_at IS NULL AND ${scopeFilter}`).bind(EVENT_ID, scope).first();
  if (missing?.count) throw new MailError(409, `${missing.count} people in the queue have no ticket image yet. Upload tickets first.`);
  await setCampaign(env, { state: 'running', scope, failures_in_row: 0, last_error: null }, username).run();
  return status(env);
}

async function pause(env, username) {
  await setCampaign(env, { state: 'paused' }, username).run();
  return status(env);
}

async function retryFailed(env) {
  await env.DB.prepare("UPDATE attendees SET mail_status = 'pending', mail_error = NULL WHERE event_id = ? AND mail_status = 'failed'")
    .bind(EVENT_ID).run();
  return status(env);
}

async function requeueTests(env) {
  await env.DB.prepare(`UPDATE attendees SET mail_status = 'pending', mail_error = NULL, mail_sent_at = NULL
    WHERE event_id = ? AND source = 'test' AND mail_status != 'sending'`).bind(EVENT_ID).run();
  return status(env);
}

async function deleteTests(env) {
  const tests = await env.DB.prepare("SELECT id, token FROM attendees WHERE event_id = ? AND source = 'test'").bind(EVENT_ID).all();
  if (env.TICKET_IMAGES) await Promise.all(tests.results.map(row => env.TICKET_IMAGES.delete(row.token)));
  await env.DB.batch([
    env.DB.prepare("DELETE FROM scans WHERE attendee_id IN (SELECT id FROM attendees WHERE event_id = ? AND source = 'test')").bind(EVENT_ID),
    env.DB.prepare("DELETE FROM attendees WHERE event_id = ? AND source = 'test'").bind(EVENT_ID),
  ]);
  const response = await status(env);
  const data = await response.json();
  return json({ ...data, deleted: tests.results.length });
}

export async function handleMailApi(request, env, path, username) {
  const method = request.method;
  if (path === 'mail/status' && method === 'GET') return status(env);
  if (path === 'mail/start' && method === 'POST') return start(request, env, username);
  if (path === 'mail/pause' && method === 'POST') return pause(env, username);
  if (path === 'mail/retry-failed' && method === 'POST') return retryFailed(env);
  if (path === 'mail/requeue-tests' && method === 'POST') return requeueTests(env);
  if (path === 'mail/delete-tests' && method === 'POST') return deleteTests(env);
  return null;
}


// The sender authenticates with the MAIL_RUNNER_TOKEN shared secret.
async function runnerAuthorized(request, env) {
  const header = request.headers.get('authorization') || '';
  if (!env.MAIL_RUNNER_TOKEN || !header.startsWith('Bearer ')) return false;
  const [given, wanted] = await Promise.all([sha256Hex(header.slice(7)), sha256Hex(env.MAIL_RUNNER_TOKEN)]);
  return given === wanted;
}

function base64(buffer) {
  const bytes = new Uint8Array(buffer);
  if (typeof bytes.toBase64 === 'function') return bytes.toBase64();
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

// Hands the next person to the sender. Returns { stop } when there is nothing
// to do, { wait } when a send is still in flight, or the email to send.
async function claim(env) {
  const now = Date.now();
  const campaign = await getCampaign(env);
  if (campaign.state !== 'running') return json({ stop: true, state: campaign.state });
  await setCampaign(env, { last_tick_at: now }).run();

  // A send that never reported back may or may not have gone out. Mark it failed
  // so a person checks the inbox before retrying, rather than sending twice.
  await env.DB.prepare(`UPDATE attendees SET mail_status = 'failed', mail_error = ?
    WHERE event_id = ? AND mail_status = 'sending' AND mail_started_at < ?`)
    .bind('Interrupted while sending. Check the inbox before retrying.', EVENT_ID, now - STUCK_MS).run();

  const person = await env.DB.prepare(`UPDATE attendees SET mail_status = 'sending', mail_started_at = ?, mail_attempts = mail_attempts + 1, mail_error = NULL
    WHERE id = (SELECT id FROM attendees WHERE event_id = ? AND email IS NOT NULL AND mail_status = 'pending' AND ${scopeFilter}
      ORDER BY source = 'test' DESC, id LIMIT 1)
    AND mail_status = 'pending'
    AND NOT EXISTS (SELECT 1 FROM attendees WHERE event_id = ? AND mail_status = 'sending')
    RETURNING id, token, name, email, source`).bind(now, EVENT_ID, campaign.scope, EVENT_ID).first();

  if (!person) {
    const busy = await env.DB.prepare("SELECT COUNT(*) AS count FROM attendees WHERE event_id = ? AND mail_status = 'sending'").bind(EVENT_ID).first();
    if (busy?.count) return json({ wait: true });
    await setCampaign(env, { state: 'done' }).run();
    return json({ stop: true, state: 'done' });
  }

  const image = env.TICKET_IMAGES ? await env.TICKET_IMAGES.get(person.token, 'arrayBuffer') : null;
  if (!image) {
    await env.DB.prepare("UPDATE attendees SET mail_status = 'failed', mail_error = ? WHERE id = ?")
      .bind('No ticket image uploaded for this person', person.id).run();
    return json({ wait: true });
  }
  const { subject, text, html } = renderEmail(person.name);
  return json({
    id: person.id,
    to: { name: person.name, email: person.email },
    subject,
    text,
    html,
    attachment: { filename: ticketFileName(person.name), contentType: 'image/jpeg', base64: base64(image) },
  });
}

// The sender reports each result. serverProblem means the mailbox or connection
// failed, so the person goes back in the queue and sending pauses.
async function report(request, env) {
  const body = await readBody(request);
  const id = Number(body.id);
  if (!Number.isInteger(id)) throw new MailError(400, 'Missing id');
  const row = await env.DB.prepare("SELECT mail_status FROM attendees WHERE id = ? AND event_id = ?").bind(id, EVENT_ID).first();
  if (!row || row.mail_status !== 'sending') return json({ ok: true, ignored: true });
  const campaign = await getCampaign(env);

  if (body.ok) {
    await env.DB.batch([
      env.DB.prepare("UPDATE attendees SET mail_status = 'sent', mail_sent_at = ?, mail_error = NULL WHERE id = ?").bind(Date.now(), id),
      setCampaign(env, { failures_in_row: 0, last_error: null }),
    ]);
  } else {
    const message = String(body.error || 'Unknown error').slice(0, 300);
    if (body.serverProblem) {
      await env.DB.batch([
        env.DB.prepare("UPDATE attendees SET mail_status = 'pending', mail_error = ? WHERE id = ?").bind(message, id),
        setCampaign(env, { state: 'paused', last_error: `Paused: ${message}` }),
      ]);
    } else {
      const failures = campaign.failuresInRow + 1;
      await env.DB.batch([
        env.DB.prepare("UPDATE attendees SET mail_status = 'failed', mail_error = ? WHERE id = ?").bind(message, id),
        failures >= MAX_FAILURES_IN_ROW
          ? setCampaign(env, { failures_in_row: failures, state: 'paused', last_error: `Paused after ${failures} failures in a row. Last: ${message}` })
          : setCampaign(env, { failures_in_row: failures, last_error: message }),
      ]);
    }
  }
  const after = await getCampaign(env);
  return json({ ok: true, stop: after.state !== 'running' });
}

export async function handleRunnerApi(request, env, path) {
  if (!(await runnerAuthorized(request, env))) throw new MailError(401, 'Unauthorized');
  if (path === 'mail/runner/claim' && request.method === 'POST') return claim(env);
  if (path === 'mail/runner/report' && request.method === 'POST') return report(request, env);
  throw new MailError(404, 'Not found');
}
