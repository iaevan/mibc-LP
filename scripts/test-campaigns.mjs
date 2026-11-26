import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import {
  handleCampaignApi,
  importTeams,
  safeHtml,
  render,
} from "../worker/campaigns/api.mjs";
import { hashPassword } from "../worker/campaigns/shared.mjs";
import service from "../worker/campaigns/entry.mjs";
import { campaignGateway } from "../worker/campaigns/gateway.mjs";

// Real SQLite statements behind the same binding interface, without network or SMTP.
const sqlite = new DatabaseSync(":memory:");
sqlite.exec(
  await readFile(
    new URL("../campaign-migrations/0001_campaigns.sql", import.meta.url),
    "utf8",
  ),
);
class Statement {
  constructor(sql, args = []) {
    this.sql = sql;
    this.args = args;
  }
  bind(...args) {
    return new Statement(this.sql, args);
  }
  async first() {
    return sqlite.prepare(this.sql).get(...this.args) ?? null;
  }
  async all() {
    return { results: sqlite.prepare(this.sql).all(...this.args) };
  }
  async run() {
    const result = sqlite.prepare(this.sql).run(...this.args);
    return { meta: { changes: result.changes }, results: [] };
  }
}
const db = {
  prepare: (sql) => new Statement(sql),
  async batch(statements) {
    sqlite.exec("BEGIN");
    try {
      const results = [];
      for (const s of statements) {
        const stmt = sqlite.prepare(s.sql);
        if (stmt.columns().length)
          results.push({ results: stmt.all(...s.args) });
        else {
          const result = stmt.run(...s.args);
          results.push({ results: [], meta: { changes: result.changes } });
        }
      }
      sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
  },
};
const env = { CAMPAIGN_DB: db, CAMPAIGN_RUNNER_TOKEN: "synthetic-test-token" };
const password = "synthetic-test-only";
sqlite
  .prepare("INSERT INTO admins VALUES(?,?)")
  .run("test@nsumibc.online", await hashPassword(password));
let cookie = "";
async function call(path = "", data, expected = 200, headers = {}) {
  const response = await handleCampaignApi(
    new Request(`https://test.local/api/campaigns/${path}`, {
      method: data === undefined ? "GET" : "POST",
      headers: { cookie, origin: "https://test.local", ...headers },
      body: data === undefined ? undefined : JSON.stringify(data),
    }),
    env,
  );
  const result = await response.json();
  assert.equal(response.status, expected, `${path}: ${JSON.stringify(result)}`);
  return { result, response };
}
const runner = (action, data) =>
  call(`runner/${action}`, data, 200, {
    authorization: `Bearer ${env.CAMPAIGN_RUNNER_TOKEN}`,
  });
const resetRate = () => sqlite.prepare("UPDATE sender SET next_at=0").run();
const csv =
  "Timestamp,Email Address,Team Name:,Name:,Institute of the participant:,Student ID:,Email Address:,Phone:,Name:,Institute of the participant:,Student ID:,Email:,Phone:\n2026,submitter@example.com,The Overthinkers,Mahjabin,NSU,2531,first@example.com,0131,Marzuq,NSU,2532,second@example.com,0179";
const teams = importTeams(csv);
assert.equal(teams[0].email, "first@example.com");
assert.equal(teams[0].members.length, 2);
assert.equal(
  importTeams(csv.replace("first@example.com", ""))[0].issue,
  "Invalid first participant email",
);
assert.throws(() => importTeams('Team Name,Name,Email\n"unterminated'));
assert.ok(
  importTeams(
    csv + "\n2026,x@x.com,Second,Other,NSU,2,first@example.com,0",
  )[1].issue.includes("Shared"),
);
assert.doesNotMatch(
  safeHtml(
    '<script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">x</a>',
  ),
  /script|onerror|javascript/,
);
assert.equal(
  render(
    { subject: "{{team_name}}", html: "<p>{{team_name}}</p>" },
    { team: "A\r\nB <img>", name: "N" },
  ).subject,
  "A B <img>",
);
await call("session", undefined, 401);
await call(
  "login",
  { username: "test@nsumibc.online", password: "wrong" },
  401,
);
const login = await call("login", {
  username: "test@nsumibc.online",
  password,
});
cookie = login.response.headers.get("set-cookie").split(";")[0];
assert.ok(login.response.headers.get("set-cookie").includes("HttpOnly"));
await call("parse", { csv }, 403, { origin: "https://other.local" });
let c = (await call("", { name: "Integration test" })).result;
const id = c.id;
c = (await call(`${id}/import`, { version: c.version, teams })).result;
c = (
  await call(`${id}/save`, {
    version: c.version,
    name: c.name,
    subject: "Hello {{team_name}}",
    html: "<p>Dear {{team_name}}, {{recipient_name}}</p>",
  })
).result;
await call(
  `${id}/save`,
  { version: c.version - 1, subject: "stale", html: "old" },
  409,
);
await call(`${id}/start`, {}, 409);
c = (
  await call(`${id}/test`, {
    email: "admin@example.com",
    recipientId: c.people[0].id,
  })
).result;
const claim = crypto.randomUUID();
let job = (await runner("claim", { claim })).result;
assert.equal(job.to.email, "admin@example.com");
assert.match(job.subject, /\[TEST\] Hello The Overthinkers/);
assert.equal((await runner("claim", { claim })).result.claim, claim);
assert.ok((await runner("claim", { claim: crypto.randomUUID() })).result.wait);
await runner("report", { claim, ok: true, messageId: "test-accepted" });
await runner("report", { claim, ok: false }); // Idempotent report.
c = (await call(id)).result;
assert.equal(c.tested_version, c.version);
c = (await call(`${id}/start`, {})).result;
assert.equal(c.state, "running");
await call(`${id}/import`, { version: c.version, teams }, 409);
await call(`${id}/pause`, {});
resetRate();
assert.ok((await runner("claim", { claim: crypto.randomUUID() })).result.stop);
await call(`${id}/start`, {});
resetRate();
const primary = crypto.randomUUID();
job = (await runner("claim", { claim: primary })).result;
assert.equal(job.to.email, "first@example.com");
assert.ok(!JSON.stringify(job).includes("second@example.com"));
await runner("report", {
  claim: primary,
  ok: false,
  uncertain: true,
  pause: true,
  error: "Connection lost",
});
c = (await call(id)).result;
assert.equal(c.state, "paused");
assert.equal(c.people.find((p) => !p.is_test).status, "uncertain");
await call(`${id}/retry`, { status: "uncertain" }, 400);
c = (await call(`${id}/retry`, { status: "uncertain", confirm: true })).result;
await call(`${id}/start`, {});
resetRate();
const retry = crypto.randomUUID();
job = (await runner("claim", { claim: retry })).result;
await runner("report", { claim: primary, ok: true }); // A stale report cannot overwrite a new attempt.
c = (await call(id)).result;
assert.equal(c.people.find((p) => !p.is_test).status, "sending");
await runner("report", { claim: retry, ok: true, messageId: "accepted" });
resetRate();
await runner("claim", { claim: crypto.randomUUID() });
c = (await call(id)).result;
assert.equal(c.state, "done");
assert.equal(c.people.find((p) => !p.is_test).status, "sent");
assert.equal(c.history.length, 3);
// Resends require an explicit confirmation, and reserve quota again.
await call(`${id}/retry`, { status: "sent" }, 400);
await call(`${id}/retry`, { status: "sent", confirm: true });
await call(`${id}/start`, {});
resetRate();
env.CAMPAIGN_DAILY_LIMIT = "3";
assert.ok((await runner("claim", { claim: crypto.randomUUID() })).result.stop);
env.CAMPAIGN_DAILY_LIMIT = "0";
assert.equal((await call(id)).result.settings.ready, false);
await call("logout", {});
await call("session", undefined, 401);
// The cross-account service cannot be used directly, even with a valid user login.
const serviceEnv = {
  ...env,
  CAMPAIGN_GATEWAY_TOKEN: "local-gateway",
  PUBLIC_ORIGIN: "https://nsumibc.online",
};
assert.equal(
  (
    await service.fetch(
      new Request("https://backend.local/api/campaigns/session"),
      serviceEnv,
    )
  ).status,
  404,
);
const forwarded = await service.fetch(
  new Request("https://backend.local/api/campaigns/login", {
    method: "POST",
    headers: {
      "x-campaign-gateway": "local-gateway",
      "x-campaign-client-ip": "192.0.2.1",
      origin: "https://nsumibc.online",
    },
    body: JSON.stringify({ username: "test@nsumibc.online", password }),
  }),
  serviceEnv,
);
assert.equal(forwarded.status, 200);
assert.ok(forwarded.headers.get("set-cookie").includes("Secure"));
const realFetch = globalThis.fetch;
try {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://backend.local/api/campaigns/session");
    assert.equal(options.headers.get("x-campaign-gateway"), "local-gateway");
    assert.equal(options.headers.get("x-campaign-client-ip"), "192.0.2.2");
    return new Response("ok");
  };
  const gateway = await campaignGateway(
    new Request("https://nsumibc.online/api/campaigns/session", {
      headers: {
        "cf-connecting-ip": "192.0.2.2",
        "x-campaign-client-ip": "spoofed",
      },
    }),
    {
      CAMPAIGN_API_ORIGIN: "https://backend.local",
      CAMPAIGN_GATEWAY_TOKEN: "local-gateway",
    },
  );
  assert.equal(gateway.status, 200);
} finally {
  globalThis.fetch = realFetch;
}
// A future event with 3,000 teams fits the same independent data model.
let large = await call("login", { username: "test@nsumibc.online", password });
cookie = large.response.headers.get("set-cookie").split(";")[0];
large = (await call("", { name: "Scale check" })).result;
const many = Array.from({ length: 3000 }, (_, i) => ({
  ...teams[0],
  team: `Team ${i}`,
  email: `leader${i}@example.com`,
}));
large = (
  await call(`${large.id}/import`, { version: large.version, teams: many })
).result;
assert.equal(large.people.length, 3000);
// A failed transport test must not freeze a draft or bypass the test requirement.
env.CAMPAIGN_DAILY_LIMIT = '900';
large = (await call(`${large.id}/save`, { version:large.version,name:large.name,subject:'Test {{team_name}}',html:'<p>Hello {{team_name}}</p>' })).result;
await call(`${large.id}/test`,{email:'test@example.com',recipientId:large.people[0].id});
resetRate();
const failedTest=crypto.randomUUID();
assert.equal((await runner('claim',{claim:failedTest})).result.to.email,'test@example.com');
await runner('report',{claim:failedTest,ok:false,pause:true,error:'Synthetic SMTP failure'});
large=(await call(large.id)).result;
assert.equal(large.state,'draft');
await call(`${large.id}/start`,{},409);
sqlite.close();
console.log(
  "Campaign integration checks passed: auth, isolation, CSV recipient selection, sanitizing, preview tokens, draft conflicts, required tests, claim/report recovery, pause, resends and quota. No emails sent.",
);
