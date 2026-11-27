import nodemailer from "nodemailer";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function smtpTransport(env) {
  return nodemailer.createTransport({
    host: env.SMTP_HOST || "smtp.hostinger.com",
    port: Number(env.SMTP_PORT) || 465,
    secure: true,
    pool: true,
    maxConnections: 1,
    maxMessages: 100,
    auth: {
      user: env.SMTP_USER || "info@nsumibc.online",
      pass: env.SMTP_PASSWORD,
    },
    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 90000,
    tls: { minVersion: "TLSv1.2" },
  });
}
// This transport boundary can be replaced without changing imports, campaigns or UI.
export async function deliver(job, env = process.env, connection = null) {
  const from = {
    name: "NSU MIBC",
    address: env.SMTP_USER || "info@nsumibc.online",
  };
  if (job.provider === "brevo") {
    if (!env.BREVO_API_KEY)
      return {
        ok: false,
        pause: true,
        error: "Brevo credentials missing. Contact the administrator.",
      };
    try {
      const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": env.BREVO_API_KEY,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sender: { name: from.name, email: from.address },
          to: [{ email: job.to.email, name: job.to.name }],
          subject: job.subject,
          htmlContent: job.html,
        }),
        signal: AbortSignal.timeout(90000),
      });
      if (response.ok) {
        const result = await response.json();
        return { ok: true, messageId: result.messageId };
      }
      // A server error can follow acceptance. Never retry it automatically.
      return {
        ok: false,
        uncertain: response.status >= 500,
        pause: true,
        error: `Provider returned HTTP ${response.status}. Check provider activity before retrying.`,
      };
    } catch {
      return {
        ok: false,
        uncertain: true,
        pause: true,
        error:
          "Provider response was interrupted. Check delivery before retrying.",
      };
    }
  }
  if (job.provider !== "hostinger" || !env.SMTP_PASSWORD)
    return {
      ok: false,
      pause: true,
      error:
        "SMTP credentials missing or provider unsupported. Contact the administrator.",
    };
  const smtp = connection || smtpTransport(env);
  try {
    const result = await smtp.sendMail({
      from,
      to: { name: job.to.name, address: job.to.email },
      replyTo: from.address,
      subject: job.subject,
      html: job.html,
      messageId: `<campaign.${job.claim}@nsumibc.online>`,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    if (!result.accepted?.length)
      return { ok: false, error: "SMTP rejected the recipient." };
    return { ok: true, messageId: result.messageId };
  } catch (error) {
    const code = Number(error.responseCode);
    const definite =
      (code >= 400 && code < 600) ||
      ["EAUTH", "EDNS", "ECONNECTION"].includes(error.code);
    return {
      ok: false,
      uncertain: !definite,
      pause: !(code >= 500 && error.command === "RCPT TO"),
      error: definite
        ? `SMTP rejected this attempt${code ? ` (${code})` : ""}. Check credentials, quota or recipient.`
        : "SMTP connection interrupted. Check delivery before retrying.",
    };
  } finally {
    if (!connection) smtp.close();
  }
}

export async function run(env = process.env) {
  if (!env.CAMPAIGN_RUNNER_TOKEN) {
    console.log("Campaign sender is not activated.");
    return;
  }
  const base = env.CAMPAIGN_API || "https://nsumibc.online";
  if (!base.startsWith("https://"))
    throw new Error("Campaign API must use HTTPS");
  const deadline =
    Date.now() + Math.min(330, Number(env.MAX_MINUTES) || 330) * 60000;
  async function api(action, data) {
    for (let n = 0; n < 4; n++) {
      try {
        const response = await fetch(`${base}/api/campaigns/runner/${action}`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${env.CAMPAIGN_RUNNER_TOKEN}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(data),
          signal: AbortSignal.timeout(30000),
        });
        if (!response.ok)
          throw new Error(`Campaign API returned ${response.status}`);
        return await response.json();
      } catch (error) {
        if (n === 3) throw error;
        await pause(2000 * (n + 1));
      }
    }
  }
  let accepted = 0;
  let connection;
  try {
    while (Date.now() < deadline - 120000) {
      // Network retries reuse the claim. A second process cannot claim the same recipient.
      const job = await api("claim", {
        claim: randomUUID(),
        testId: env.CAMPAIGN_TEST_ID || "",
      });
      if (job.stop) {
        console.log(job.reason);
        break;
      }
      if (job.wait) {
        await pause(Math.min(60, Math.max(0.05, job.wait)) * 1000);
        continue;
      }
      if (job.provider === "hostinger" && env.SMTP_PASSWORD && !connection)
        connection = smtpTransport(env);
      const result = await deliver(job, env, connection);
      // Retry reporting only. Never retry deliver() after an uncertain response.
      await api("report", { claim: job.claim, ...result });
      if (result.ok) accepted++;
      if (env.CAMPAIGN_TEST_ID) break;
      if (result.pause) {
        console.log("Campaign paused. Review the dashboard before resuming.");
        break;
      }
    }
  } finally {
    connection?.close();
  }
  console.log(
    `${accepted} emails accepted by the provider in this run. No inbox delivery guarantee.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  run().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
