import { test } from "node:test";
import assert from "node:assert/strict";
import { deliver } from "./send.mjs";
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
