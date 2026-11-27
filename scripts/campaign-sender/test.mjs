import { test } from "node:test";
import assert from "node:assert/strict";
import { deliver, run } from "./send.mjs";
const job = {
  provider: "hostinger",
  claim: "synthetic",
  to: { name: "Test", email: "recipient@example.com" },
  subject: "Test subject",
  html: "<p>Test</p>",
};
const env = { SMTP_PASSWORD: "synthetic-password" };
test("SMTP accepted messages preserve recipient, sender and safe attachment settings", async () => {
  let sent;
  const smtp = {
    sendMail: async (message) => {
      sent = message;
      return { accepted: [job.to.email], messageId: "synthetic-message" };
    },
    close: () => assert.fail("A shared pool must stay open"),
  };
  assert.deepEqual(await deliver(job, env, smtp), {
    ok: true,
    messageId: "synthetic-message",
  });
  assert.equal(sent.to.address, job.to.email);
  assert.equal(sent.from.address, "info@nsumibc.online");
  assert.equal(sent.subject, job.subject);
  assert.equal(sent.disableFileAccess, true);
  assert.equal(sent.disableUrlAccess, true);
});
test("Unknown SMTP outcomes pause without automatic resend", async () => {
  const result = await deliver(job, env, {
    sendMail: async () => {
      throw new Error("socket interrupted");
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.uncertain, true);
  assert.equal(result.pause, true);
});
test("Provider throttling is a definite failure and pauses the sender", async () => {
  const result = await deliver(job, env, {
    sendMail: async () => {
      throw Object.assign(new Error("rate limited"), { responseCode: 451 });
    },
  });
  assert.equal(result.uncertain, false);
  assert.equal(result.pause, true);
});
test("Missing credentials cannot send email", async () => {
  assert.equal((await deliver(job, {})).ok, false);
});
test("The plain-text copy travels with the HTML", async () => {
  let sent;
  await deliver({ ...job, text: "Plain copy" }, env, {
    sendMail: async (message) => {
      sent = message;
      return { accepted: [job.to.email], messageId: "x" };
    },
  });
  assert.equal(sent.text, "Plain copy");
});
test("A manual run waits for work, then sends it; a scheduled run exits at once", async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  let claims = 0;
  globalThis.fetch = async (url, options) => {
    const action = url.split("/").pop();
    calls.push(action);
    const body = JSON.parse(options.body);
    if (action === "claim") {
      claims++;
      // Nothing queued at first, then one email appears, then nothing again.
      if (claims === 2) return new Response(JSON.stringify({ ...job, claim: body.claim }));
      return new Response(JSON.stringify({ stop: true, idle: true, reason: "No queued campaign" }));
    }
    return new Response(JSON.stringify({ ok: true }));
  };
  try {
    const base = {
      CAMPAIGN_RUNNER_TOKEN: "synthetic",
      CAMPAIGN_API: "https://example.test",
      IDLE_POLL_MS: "1",
      MAX_MINUTES: "10",
    };
    await run({ ...base, GITHUB_EVENT_NAME: "schedule" });
    assert.deepEqual(calls, ["claim"], "Scheduled runs exit when idle");
    calls.length = 0;
    claims = 0;
    // No SMTP password: deliver() reports a paused failure instead of sending anything.
    await run({ ...base, GITHUB_EVENT_NAME: "workflow_dispatch", IDLE_MINUTES: "0.001" });
    assert.ok(calls.includes("report"), "The email that appeared while waiting was handled");
  } finally {
    globalThis.fetch = realFetch;
  }
});
