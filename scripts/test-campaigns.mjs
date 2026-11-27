import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile, readdir } from "node:fs/promises";
import {
  handleCampaignApi,
  parseTeamSheet,
  withIssues,
  fixPhone,
  safeHtml,
  render,
} from "../worker/campaigns/api.mjs";
import { hashPassword } from "../worker/campaigns/shared.mjs";
import service from "../worker/campaigns/entry.mjs";
import { campaignGateway } from "../worker/campaigns/gateway.mjs";

// Real SQLite statements behind the same binding interface, without network or SMTP.
const sqlite = new DatabaseSync(":memory:");
const migrationDir = new URL("../campaign-migrations/", import.meta.url);
for (const file of (await readdir(migrationDir)).filter((f) => f.endsWith(".sql")).sort())
  sqlite.exec(await readFile(new URL(file, migrationDir), "utf8"));
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
const addUser = async (username, role, name = null) =>
  sqlite
    .prepare("INSERT INTO admins(username,password_hash,role,display_name) VALUES(?,?,?,?)")
    .run(username, await hashPassword(password), role, name);
await addUser("test@nsumibc.online", "admin");
await addUser("lengra", "helper", "Lengra Faiyaz");
await addUser("madok", "helper", "Madok Mursalin");

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
async function login(username) {
  const { response, result } = await call("login", { username, password });
  cookie = response.headers.get("set-cookie").split(";")[0];
  return result;
}
const runner = (action, data) =>
  call(`runner/${action}`, data, 200, {
    authorization: `Bearer ${env.CAMPAIGN_RUNNER_TOKEN}`,
  });
const resetRate = () => sqlite.prepare("UPDATE sender SET next_at=0").run();

// The Google Forms export: submitter email first, then repeated member groups.
const csv = [
  'Timestamp,Email Address,Team Name:,Name:,Institute of the participant:,Student ID:,Email Address:,Phone:,Name:,Institute of the participant:,Student ID:,Email Address:,Phone:,Name:,Institute of the participant:,Student ID:,Email:,Phone:',
  '11/23/2026 14:00,submitter@example.com,The Overthinkers,Any Ahmed,North South University,2534471042,leader1@example.com,01317419187,Md Marzuq,North South University,2534473043,member@example.com,01795702109,,,,,',
  '11/24/2026 12:10,someone@example.com,"Taka nai, Idea ase",Israt Jahan,North South University,2621832030,leader2@example.com,1757044271,Md Arafat,North South University,2623422630,arafat@example.com,1612371064,Sumaita Afrid,Bangladesh University,2521141008,sumaita@example.com,1730335682',
  '11/24/2026 13:00,x@example.com,alpha squad,Rafi,NSU,1,LEADER3@EXAMPLE.COM,01700000000,,,,,,,,,,',
].join("\n");
const parsed = parseTeamSheet(csv);
assert.deepEqual(
  parsed.map((t) => t.team),
  ["alpha squad", "Taka nai, Idea ase", "The Overthinkers"],
  "Teams are sorted by team name",
);
const taka = parsed.find((t) => t.team.startsWith("Taka"));
assert.equal(taka.leader_email, "leader2@example.com", "Member 1 is the leader, not the submitter");
assert.equal(taka.leader_name, "Israt Jahan");
assert.equal(taka.members.length, 3);
assert.equal(taka.members[0].phone, "01757044271", "Lost leading zero restored");
assert.equal(taka.members[2].institute, "Bangladesh University");
assert.equal(parsed[0].leader_email, "leader3@example.com", "Emails are lowercased");
assert.equal(fixPhone("01711111111"), "01711111111");
assert.equal(
  parseTeamSheet(csv.replace("Team Name:,Name:", "Team Name:,Leader Name:"))[0].leader_name,
  "Rafi",
  "A renamed Leader Name heading still works",
);
assert.throws(() => parseTeamSheet('Team Name,Name,Email\n"unterminated'));
assert.throws(() => parseTeamSheet("Something,Else\n1,2"));
const flagged = withIssues([
  { id: "a", team: "One", leader_name: "A", leader_email: "same@example.com" },
  { id: "b", team: "Two", leader_name: "B", leader_email: "same@example.com" },
  { id: "c", team: "one", leader_name: "C", leader_email: "c@example.com" },
  { id: "d", team: "Four", leader_name: "", leader_email: "d@example.com" },
  { id: "e", team: "Five", leader_name: "E", leader_email: "bad" },
]);
assert.equal(flagged[1].issue, "Same leader email as another team");
assert.equal(flagged[2].issue, "Same team name as another team");
assert.equal(flagged[3].issue, "Missing leader name");
assert.equal(flagged[4].issue, "Leader email is missing or invalid");
assert.doesNotMatch(
  safeHtml('<script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">x</a>'),
  /script|onerror|javascript/,
);
const rendered = render(
  { subject: "{{team_name}}", html: "<p>Hi {{leader_name}}</p>", case_link: "https://nsumibc.online/case/abc/" },
  { team: "A\r\nB <img>", name: "N & M" },
);
assert.equal(rendered.subject, "A B <img>");
assert.match(rendered.html, /Hi N &amp; M/);
assert.match(rendered.html, /href="https:\/\/nsumibc.online\/case\/abc\/"/);

// Sign-in and roles.
await call("session", undefined, 401);
await call("login", { username: "lengra", password: "wrong" }, 401);
const helper = await login("lengra");
assert.equal(helper.role, "helper");
assert.equal(helper.name, "Lengra Faiyaz");
await call("emails", undefined, 403);
await call("activity", undefined, 403);
await call("lists", { name: "Blocked" }, 403, { origin: "https://other.local" });

// A helper creates the list from the sheet, then fixes and adds teams.
const { id: listId } = (await call("lists", { name: "Case Competition 2026", rounds: 3, csv })).result;
let list = (await call(`lists/${listId}`)).result;
assert.equal(list.teams.length, 3);
assert.equal(list.rounds, 3);
const over = list.teams.find((t) => t.team === "The Overthinkers");
let edit = (
  await call(`teams/${over.id}`, {
    ...over,
    leader_email: "fixed@example.com",
    members: over.members.map((m, i) => (i === 1 ? { ...m, phone: "01799999999" } : m)),
  })
).result;
assert.equal(edit.team.leader_email, "fixed@example.com");
assert.equal(edit.team.members[0].email, "fixed@example.com", "Member 1 follows the leader");
// A second helper editing an older copy gets a clear conflict, not an overwrite.
await login("madok");
const conflict = (await call(`teams/${over.id}`, { ...over, team: "Stale" }, 409)).result;
assert.match(conflict.error, /Lengra Faiyaz changed this team/);
assert.equal(conflict.team.leader_email, "fixed@example.com");
const added = (
  await call(`lists/${listId}/team`, {
    team: "Delta",
    members: [{ name: "Dee", email: "dee@example.com" }],
  })
).result;
assert.equal(added.teams.length, 4);
// Adding a sheet again skips teams that already exist.
const merge = (
  await call(`lists/${listId}/preview`, {
    csv: csv + "\n11/25/2026,y@example.com,Echo,Eve,NSU,9,eve@example.com,01800000000,,,,,,,,,,",
  })
).result;
assert.deepEqual(
  merge.teams.map((t) => t.status).sort(),
  ["existing", "existing", "existing", "new"],
);
assert.deepEqual(
  (await call(`lists/${listId}/add`, { teams: merge.teams.filter((t) => t.status === "new") })).result,
  { added: 1, skipped: 0 },
);
list = (await call(`lists/${listId}`)).result;
assert.equal(list.teams.length, 5);
const echo = list.teams.find((t) => t.team === "Echo");
await call(`teams/${echo.id}/delete`, {});
await call(`teams/${echo.id}/restore`, {});

// Results pasted by team name or leader email move teams to the next round.
await call(`lists/${listId}/team`, {
  team: "alpha squad",
  members: [{ name: "Other", email: "other@example.com" }],
});
const match = (
  await call(`lists/${listId}/match`, {
    text: "Taka nai, Idea ase\nfixed@example.com\nAlpha Squad\nNobody\n",
  })
).result.results;
assert.deepEqual(match.map((m) => m.status), ["match", "match", "ambiguous", "missing"]);
assert.equal(match[2].candidates.length, 2);
const qualified = [match[0].candidates[0].id, match[1].candidates[0].id, match[2].candidates[0].id];
const moved = (await call(`lists/${listId}/round`, { teamIds: qualified, round: 2 })).result;
assert.equal(moved.moved, 3);
await call(`lists/${listId}/round`, { teamIds: qualified, round: 4 }, 400);
await call(`lists/${listId}/settings`, { rounds: 1 }, 409);

// Main admins see the activity log with helper names.
await login("test@nsumibc.online");
const log = (await call("activity")).result;
assert.ok(log.items.some((a) => a.name === "Lengra Faiyaz" && a.summary.includes('leader email "leader1@example.com" to "fixed@example.com"')));
assert.ok(log.items.some((a) => a.name === "Madok Mursalin" && a.action === "move_round"));
assert.ok(log.people.some((p) => p.username === "sada") === false);

// Round 2 email: audience, optional test, launch snapshot and live stats.
let email = (await call("emails", { name: "Round 2 case", list_id: listId })).result;
email = (
  await call(`emails/${email.id}/save`, {
    version: email.version,
    subject: "Round 2: {{team_name}}",
    html: "<p>Dear {{leader_name}}, your team {{team_name}} qualified.</p>",
    audience_round: 2,
    case_link: "https://nsumibc.online/case/round2/",
  })
).result;
await call(`emails/${email.id}/save`, { version: email.version - 1, subject: "stale" }, 409);
await call(`emails/${email.id}/save`, { version: email.version, case_link: "javascript:alert(1)" }, 400);
let audience = (await call(`emails/${email.id}/audience`)).result;
assert.equal(audience.teams.length, 3, "Round 2 audience is the qualified teams only");
const skip = audience.teams.find((t) => t.team === "alpha squad");
email = (await call(`emails/${email.id}/save`, { version: email.version, excluded: [skip.id] })).result;
audience = (await call(`emails/${email.id}/audience`)).result;
assert.equal(audience.teams.filter((t) => !t.excluded && !t.issue).length, 2);
// Test emails are optional and go only to the test address.
email = (
  await call(`emails/${email.id}/test`, { email: "admin@example.com", teamId: audience.teams[0].id })
).result;
const testClaim = crypto.randomUUID();
let job = (await runner("claim", { claim: testClaim })).result;
assert.equal(job.to.email, "admin@example.com");
assert.match(job.subject, /^\[TEST\] Round 2: /);
assert.match(job.html, /Open the case/);
await runner("report", { claim: testClaim, ok: true, messageId: "test" });
await call(`emails/${email.id}/start`, { confirm: true, expected: 5 }, 409);
await call(`emails/${email.id}/start`, { expected: 2 }, 400);
email = (await call(`emails/${email.id}/start`, { confirm: true, expected: 2 })).result;
assert.equal(email.state, "running");
assert.equal(email.counts.total, 2);
await call(`emails/${email.id}/save`, { version: email.version, subject: "late" }, 409);
// Editing a team after launch does not change who receives the sent email.
await login("lengra");
list = (await call(`lists/${listId}`)).result;
const taka2 = list.teams.find((t) => t.team.startsWith("Taka"));
await call(`teams/${taka2.id}`, { ...taka2, leader_email: "changed@example.com" });
await login("test@nsumibc.online");
resetRate();
const first = crypto.randomUUID();
job = (await runner("claim", { claim: first })).result;
assert.equal(job.to.email, "leader2@example.com", "Sent in team name order, using the address from launch time");
assert.equal(job.subject, "Round 2: Taka nai, Idea ase");
await runner("report", { claim: first, ok: false, error: "Mailbox full" });
let stats = (await call(`emails/${email.id}/stats`)).result;
assert.equal(stats.counts.failed, 1);
assert.equal(stats.counts.queued, 1);
assert.equal(stats.recent[0].status, "failed");
// Stop takes effect before the next claim.
await call(`emails/${email.id}/pause`, {});
resetRate();
assert.ok((await runner("claim", { claim: crypto.randomUUID() })).result.stop);
await call(`emails/${email.id}/retry`, { status: "failed" });
await call(`emails/${email.id}/start`, {});
resetRate();
const second = crypto.randomUUID();
job = (await runner("claim", { claim: second })).result;
assert.equal(job.to.email, "leader2@example.com", "A retried email keeps the address from launch time");
await runner("report", { claim: second, ok: true, messageId: "ok" });
resetRate();
const third = crypto.randomUUID();
job = (await runner("claim", { claim: third })).result;
assert.equal(job.to.email, "fixed@example.com");
assert.match(job.html, /Dear Any Ahmed, your team The Overthinkers qualified/);
await runner("report", { claim: third, ok: true, messageId: "ok" });
resetRate();
await runner("claim", { claim: crypto.randomUUID() });
email = (await call(`emails/${email.id}`)).result;
assert.equal(email.state, "done");
assert.equal(email.counts.sent, 2);
const page = (await call(`emails/${email.id}/recipients?status=sent`)).result;
assert.equal(page.total, 2);
assert.equal((await call(`emails/${email.id}/recipients?q=overthinkers`)).result.total, 1);
// Resends need confirmation and count against the daily allowance.
await call(`emails/${email.id}/retry`, { status: "sent" }, 400);
const oneSent = (await call(`emails/${email.id}/recipients?status=sent`)).result.items[0];
await call(`emails/${email.id}/retry`, { status: "sent", confirm: true, recipientId: oneSent.id });
assert.equal((await call(`emails/${email.id}/stats`)).result.counts.queued, 1, "Only that team is queued again");
await call(`emails/${email.id}/start`, {});
resetRate();
env.CAMPAIGN_DAILY_LIMIT = "3";
assert.ok((await runner("claim", { claim: crypto.randomUUID() })).result.stop);
assert.equal((await call(`emails/${email.id}/stats`)).result.settings.used, null, "Live polls skip the costly count");
stats = (await call(`emails/${email.id}/stats?full=1`)).result;
assert.ok(stats.settings.resumeAt > Date.now(), "Dashboard can say when sending resumes");
env.CAMPAIGN_DAILY_LIMIT = "900";
// Sent emails cannot be deleted mid-send, but stopped ones go to Trash and back.
await call(`emails/${email.id}/archive`, {}, 409);
await call(`emails/${email.id}/pause`, {});
await call(`emails/${email.id}/archive`, {});
assert.ok((await call("emails?trash=1")).result.some((c) => c.id === email.id));
assert.equal((await call(`emails/${email.id}/restore`, {})).result.state, "paused");
const copy = (await call(`emails/${email.id}/copy`, {})).result;
assert.equal(copy.state, "draft");
assert.equal(copy.audience_round, 2);
assert.equal(copy.case_link, "https://nsumibc.online/case/round2/");
assert.equal(copy.counts, null);

// A diagnostic run can claim only its own test.
await call(`emails/${copy.id}/test`, { email: "b@example.com", teamId: audience.teams[0].id });
const target = (await call(`emails/${copy.id}`)).result.tests[0];
resetRate();
const targeted = crypto.randomUUID();
assert.equal((await runner("claim", { claim: targeted, testId: target.id })).result.to.email, "b@example.com");
await runner("report", { claim: targeted, ok: false, error: "Synthetic" });
resetRate();
assert.ok((await runner("claim", { claim: crypto.randomUUID(), testId: "none" })).result.stop);

// 3,000 teams fit the same model, and launching snapshots all of them.
const big = ["Timestamp,Email Address,Team Name,Name,Email,Phone"];
for (let i = 0; i < 3000; i++) big.push(`t,s@x.com,Team ${i},Leader ${i},leader${i}@example.com,0170000${String(i).padStart(4, "0")}`);
const { id: bigList } = (await call("lists", { name: "Scale", rounds: 2, csv: big.join("\n") })).result;
let bigEmail = (await call("emails", { name: "Everyone", list_id: bigList })).result;
bigEmail = (
  await call(`emails/${bigEmail.id}/save`, {
    version: bigEmail.version,
    subject: "Hello {{team_name}}",
    html: "<p>Hi</p>",
  })
).result;
bigEmail = (await call(`emails/${bigEmail.id}/start`, { confirm: true, expected: 3000 })).result;
assert.equal(bigEmail.counts.total, 3000);
await call(`emails/${bigEmail.id}/pause`, {});

// Logout, then the isolated backend refuses direct traffic.
await call("logout", {});
await call("session", undefined, 401);
const serviceEnv = { ...env, CAMPAIGN_GATEWAY_TOKEN: "local-gateway", PUBLIC_ORIGIN: "https://nsumibc.online" };
assert.equal(
  (await service.fetch(new Request("https://backend.local/api/campaigns/session"), serviceEnv)).status,
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
      headers: { "cf-connecting-ip": "192.0.2.2", "x-campaign-client-ip": "spoofed" },
    }),
    { CAMPAIGN_API_ORIGIN: "https://backend.local", CAMPAIGN_GATEWAY_TOKEN: "local-gateway" },
  );
  assert.equal(gateway.status, 200);
} finally {
  globalThis.fetch = realFetch;
}
// ---- Hardening checks ----
await login("test@nsumibc.online");
// Hot sender and dashboard queries use indexes instead of scanning every recipient.
const plan = (sql) =>
  sqlite
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all()
    .map((row) => row.detail)
    .join(" | ");
for (const sql of [
  "SELECT 1 FROM recipients WHERE status='sending' LIMIT 1",
  "UPDATE recipients SET status='uncertain' WHERE status='sending' AND claimed_at<1",
  "UPDATE attempts SET status='uncertain' WHERE status='sending' AND started_at<1",
  "SELECT status, COUNT(*) FROM recipients WHERE campaign_id='x' AND import_id='y' AND is_test=0 GROUP BY status",
  "DELETE FROM recipients WHERE campaign_id='x' AND is_test=0 AND import_id IS NOT 'y' AND NOT EXISTS(SELECT 1 FROM attempts a WHERE a.recipient_id=recipients.id)",
]) {
  const detail = plan(sql);
  assert.doesNotMatch(detail, /SCAN (recipients|attempts)(?! USING (COVERING )?INDEX)/, `${sql} -> ${detail}`);
  assert.doesNotMatch(detail, /SCAN a\b(?! USING)/, `${sql} -> ${detail}`);
}
// Emails carry a complete HTML document and a plain-text copy.
let hard = (await call("emails", { name: "Hardening", list_id: listId })).result;
hard = (
  await call(`emails/${hard.id}/save`, {
    version: hard.version,
    subject: "Hi {{team_name}}",
    html: '<p>Dear <strong>{{leader_name}}</strong> &amp; team,</p><ul><li>One</li><li>Two</li></ul><p><a href="https://nsumibc.online/x">Schedule</a></p>',
    case_link: "https://nsumibc.online/case/c1/",
  })
).result;
const hardTeams = (await call(`emails/${hard.id}/audience`)).result.teams;
// A second test replaces a waiting one instead of being refused.
await call(`emails/${hard.id}/test`, { email: "one@example.com", teamId: hardTeams[0].id });
hard = (await call(`emails/${hard.id}/test`, { email: "two@example.com", teamId: hardTeams[0].id })).result;
assert.deepEqual(hard.tests.map((t) => `${t.email}:${t.status}`).slice(0, 2), ["two@example.com:queued", "one@example.com:cancelled"]);
// Editing after queuing a test cancels it, because it would show the old wording.
hard = (await call(`emails/${hard.id}/save`, { version: hard.version, subject: "Hello {{team_name}}" })).result;
assert.equal(hard.tests[0].status, "cancelled");
assert.match(hard.tests[0].error, /Replaced by later edits/);
hard = (await call(`emails/${hard.id}/test`, { email: "three@example.com", teamId: hardTeams[0].id })).result;
resetRate();
const docClaim = crypto.randomUUID();
job = (await runner("claim", { claim: docClaim })).result;
assert.match(job.html, /^<!doctype html>/);
assert.match(job.html, /max-width:640px/);
assert.match(job.text, /^Dear .+ & team,/);
assert.match(job.text, /- One\n- Two/);
assert.match(job.text, /Schedule \(https:\/\/nsumibc.online\/x\)/);
assert.match(job.text, /Open the case \(https:\/\/nsumibc.online\/case\/c1\/\)/);
await runner("report", { claim: docClaim, ok: true, messageId: "doc" });
// An empty queue tells a waiting sender to keep waiting, and frees the rate slot.
resetRate();
const idle = (await runner("claim", { claim: crypto.randomUUID() })).result;
assert.equal(idle.idle, true);
assert.ok(sqlite.prepare("SELECT next_at FROM sender").get().next_at <= Date.now());
// Mass resend of everyone already sent is refused; one team at a time is allowed.
await call(`emails/${email.id}/retry`, { status: "sent", confirm: true }, 400);

// Background list refreshes are answered from the list row when nothing changed.
list = (await call(`lists/${listId}`)).result;
assert.equal((await call(`lists/${listId}?since=${list.updated_at}`)).result.unchanged, true);
// Autosaves within two minutes are one log entry measured from the original.
await login("lengra");
let alpha = list.teams.find((t) => t.team === "Delta");
alpha = (await call(`teams/${alpha.id}`, { ...alpha, team: "Delta One" })).result.team;
alpha = (await call(`teams/${alpha.id}`, { ...alpha, team: "Delta Two" })).result.team;
assert.ok((await call(`lists/${listId}?since=${list.updated_at}`)).result.teams, "A change shows up on refresh");
await login("test@nsumibc.online");
const deltaLog = (await call("activity")).result.items.filter((a) => a.action === "edit_team" && a.summary.includes("Delta"));
assert.equal(deltaLog.length, 1);
assert.match(deltaLog[0].summary, /team name "Delta" to "Delta Two"/);
// Editing it back removes the entry, since nothing changed in the end.
await login("lengra");
await call(`teams/${alpha.id}`, { ...alpha, team: "Delta" });
await login("test@nsumibc.online");
assert.equal((await call("activity")).result.items.filter((a) => a.action === "edit_team" && a.summary.includes("Delta")).length, 0);

// More Google Form heading styles, and a submitter name before the team name.
const variants = parseTeamSheet(
  [
    "Timestamp,Your Name,Team Name,Team Leader Name,Leader Email,Leader Phone,Name (Member 2),Email (Member 2),Member 3 Name,Member 3 Email",
    "t,Submitter,Gamma,Lead Person,LEAD@example.com,1811111111,Second,second@example.com,Third,third@example.com",
  ].join("\n"),
);
assert.equal(variants[0].leader_name, "Lead Person", "The submitter is not the leader");
assert.equal(variants[0].leader_email, "lead@example.com");
assert.equal(variants[0].members[0].phone, "01811111111");
assert.deepEqual(variants[0].members.map((m) => m.name), ["Lead Person", "Second", "Third"]);
assert.equal(variants[0].members[2].email, "third@example.com");

// Wrong passwords lock that account after 8 tries, not the whole network.
cookie = "";
for (let i = 0; i < 8; i++)
  await call("login", { username: "madok", password: "wrong" }, 401, { "cf-connecting-ip": "198.51.100.7" });
await call("login", { username: "madok", password }, 429, { "cf-connecting-ip": "198.51.100.7" });
await call("login", { username: "lengra", password }, 200, { "cf-connecting-ip": "198.51.100.7" });

sqlite.close();
console.log(
  "Campaign integration checks passed: sheet parsing, roles, team edits and conflicts, rounds, activity log, audiences, optional tests, launch snapshots, stop and resume, retries, quota and isolation. No emails sent.",
);
