// Sends queued ticket emails through the club mailbox, at most one per minute.
// Asks the Worker for the next person, sends with SMTP, reports the result, and
// stops when the queue is paused, finished or idle. Run by GitHub Actions.
//
// The repository is public, so its Actions logs are too: never log names,
// email addresses or message content here, only queue row numbers.
//
// Environment: MAIL_API (site origin), MAIL_RUNNER_TOKEN, SMTP_HOST, SMTP_PORT,
// SMTP_USER, SMTP_PASSWORD, optional MAIL_FROM_NAME and MAX_MINUTES.

import nodemailer from 'nodemailer';

const env = process.env;
for (const name of ['MAIL_API', 'MAIL_RUNNER_TOKEN', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD']) {
  if (!env[name]) { console.error(`Missing ${name}`); process.exit(1); }
}

const INTERVAL_MS = Number(env.INTERVAL_SECONDS || 60) * 1000;
const deadline = Date.now() + Number(env.MAX_MINUTES || 330) * 60_000;
const port = Number(env.SMTP_PORT || 465);
const fromName = env.MAIL_FROM_NAME || 'NSU MIBC';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function call(path, body) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(new URL(`/api/tm/mail/runner/${path}`, env.MAIL_API), {
        method: 'POST',
        headers: { authorization: `Bearer ${env.MAIL_RUNNER_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) throw Object.assign(new Error('The Worker rejected MAIL_RUNNER_TOKEN'), { fatal: true });
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      return data;
    } catch (error) {
      if (error.fatal || attempt >= 5) throw error;
      console.warn(`Worker call ${path} failed (${error.message}), retrying`);
      await sleep(attempt * 5000);
    }
  }
}

// Mailbox and connection problems pause the queue; a rejected recipient does not.
function isServerProblem(error) {
  if (['EAUTH', 'ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ETLS', 'ECONNRESET', 'EPROTOCOL'].includes(error.code)) return true;
  const status = Number(error.responseCode);
  if (status === 421 || (status >= 450 && status < 460)) return true;
  if (status >= 500 && error.code !== 'EENVELOPE') return true;
  return false;
}

function redact(message, to) {
  let text = String(message || 'Unknown error');
  if (to?.email) text = text.split(to.email).join('<recipient>');
  return text.slice(0, 300);
}

const transport = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port,
  secure: port === 465,
  auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
  connectionTimeout: 20_000,
  greetingTimeout: 20_000,
  socketTimeout: 60_000,
});

let sent = 0;
let lastSendAt = 0;
while (Date.now() < deadline) {
  const job = await call('claim');
  if (job.stop) { console.log(`Queue is ${job.state}. Stopping.`); break; }
  if (job.wait) { await sleep(30_000); continue; }

  let result;
  try {
    await transport.sendMail({
      from: { name: fromName, address: env.SMTP_USER },
      replyTo: { name: fromName, address: env.SMTP_USER },
      to: { name: job.to.name, address: job.to.email },
      subject: job.subject,
      text: job.text,
      html: job.html,
      attachments: [{ filename: job.attachment.filename, contentType: job.attachment.contentType, content: job.attachment.base64, encoding: 'base64' }],
    });
    sent += 1;
    result = { id: job.id, ok: true };
    console.log(`Row ${job.id}: sent (${sent} this run)`);
  } catch (error) {
    const serverProblem = isServerProblem(error);
    result = { id: job.id, ok: false, serverProblem, error: redact(error.message, job.to) };
    console.log(`Row ${job.id}: failed, ${serverProblem ? 'mailbox or connection problem' : 'recipient problem'}: ${error.code || ''} ${error.responseCode || ''}`);
  }
  lastSendAt = Date.now();
  const after = await call('report', result);
  if (after.stop) { console.log('Queue paused or finished. Stopping.'); break; }

  const wait = lastSendAt + INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
}

transport.close();
console.log(`Done. Sent ${sent} emails this run.`);
