import sanitizeHtml from "sanitize-html";
import { sha256Hex, randomHex, verifyPassword } from "./shared.mjs";
import {
  CampaignError,
  activity,
  body,
  clean,
  fail,
  inline,
  json,
  validEmail,
} from "./util.mjs";
import { MAX_TEAMS, getList, handleTeams, listTeams } from "./teams.mjs";

export { CampaignError };
export { parseTeamSheet, withIssues, fixPhone } from "./teams.mjs";

export function safeHtml(html) {
  return sanitizeHtml(String(html), {
    allowedTags: [
      "p",
      "br",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "ul",
      "ol",
      "li",
      "a",
      "blockquote",
      "h1",
      "h2",
      "h3",
      "div",
      "span",
      "table",
      "tbody",
      "tr",
      "td",
      "th",
    ],
    allowedAttributes: { a: ["href"], "*": ["style"] },
    allowedSchemes: ["https", "http", "mailto"],
    allowedStyles: {
      "*": {
        "text-align": [/^(left|right|center)$/],
        "font-weight": [/^(bold|normal|[1-9]00)$/],
        "font-style": [/^(italic|normal)$/],
        "text-decoration": [/^underline$/],
      },
    },
  });
}
const escape = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const PLACEHOLDER = /{{\s*(team_name|recipient_name|leader_name)\s*}}/g;
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };
// A plain-text copy next to the HTML improves spam scores and helps text-only readers.
export function htmlToText(html) {
  return String(html)
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => {
      const text = label.replace(/<[^>]+>/g, "").trim();
      return text && text !== href ? `${text} (${href})` : href;
    })
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-3]|blockquote|tr|ul|ol)>/gi, "\n\n")
    .replace(/<\/t[dh]>/gi, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, name) => ENTITIES[name])
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
export function render(campaign, person) {
  const value = (key) => (key === "team_name" ? person.team : person.name);
  const replace = (text, html) =>
    String(text).replace(PLACEHOLDER, (_, key) =>
      html ? escape(value(key)) : inline(value(key)),
    );
  const caseBlock = campaign.case_link
    ? `<p><a href="${escape(campaign.case_link)}"><strong>Open the case</strong></a></p>`
    : "";
  const body = safeHtml(replace(campaign.html, true) + caseBlock);
  return {
    subject: replace(campaign.subject, false),
    html: body,
    text: htmlToText(body),
  };
}
// A complete document renders consistently across Gmail, Outlook and phones.
const emailDocument = (body) =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;padding:0;background:#ffffff"><div style="max-width:640px;margin:0 auto;padding:20px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#222222">${body}</div></body></html>`;
function validate(c) {
  if (
    !c.subject ||
    !c.html ||
    !sanitizeHtml(c.html, { allowedTags: [], allowedAttributes: {} }).trim()
  )
    fail(400, "Write a subject and an email body first");
  const rest = (c.subject + c.html).replace(PLACEHOLDER, "");
  if (rest.includes("{{") || rest.includes("}}"))
    fail(400, "Use only the Team name and Leader name placeholders");
}

async function campaign(db, id) {
  const c = await db
    .prepare("SELECT * FROM campaigns WHERE id=?")
    .bind(id)
    .first();
  if (!c) fail(404, "Email not found");
  return c;
}
const WORKFLOW_URL =
  "https://github.com/iaevan/mibc-LP/actions/workflows/campaign-sender.yml";
// Sending limits from configuration only. No database reads.
function config(env) {
  const provider = env.CAMPAIGN_PROVIDER || "hostinger";
  const configured = Number(
    env.CAMPAIGN_DAILY_LIMIT ?? (provider === "hostinger" ? 900 : 0),
  );
  const cap = Math.max(
    0,
    Math.min(
      provider === "hostinger" ? 900 : 100000,
      Number.isFinite(configured) ? configured : 0,
    ),
  );
  const rate =
    provider === "hostinger"
      ? Math.max(1, Math.min(25, Number(env.CAMPAIGN_PER_MINUTE) || 20))
      : Math.max(1, Math.min(50, Number(env.CAMPAIGN_PER_MINUTE) || 1));
  return {
    provider,
    dailyLimit: cap,
    perMinute: rate,
    ready: !!env.CAMPAIGN_RUNNER_TOKEN && cap > 0,
    workflowUrl: WORKFLOW_URL,
  };
}
// The 24-hour count reads one index entry per attempt, so live polling skips it.
async function settings(db, env, withUsage = true) {
  const sender = await db
    .prepare("SELECT heartbeat FROM sender WHERE id=1")
    .first();
  const base = { ...config(env), heartbeat: sender?.heartbeat ?? null };
  if (!withUsage) return { ...base, used: null, resumeAt: null };
  const used = await db
    .prepare(
      "SELECT COUNT(*) AS n, MIN(started_at) AS oldest FROM attempts WHERE started_at>?",
    )
    .bind(Date.now() - 86400000)
    .first();
  return {
    ...base,
    used: used.n,
    // When the allowance is used up, room frees as the oldest attempt ages out.
    resumeAt:
      used.n >= base.dailyLimit && used.oldest ? used.oldest + 86400000 : null,
  };
}
const parseExcluded = (c) => {
  try {
    const value = JSON.parse(c.excluded || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
};
// Who would receive this email right now, and who is skipped and why.
async function audience(db, c, withMembers = false) {
  if (!c.list_id) return { list: null, teams: [] };
  const list = await getList(db, c.list_id);
  const excluded = new Set(parseExcluded(c));
  const teams = (await listTeams(db, c.list_id))
    .filter((t) => !t.deleted_at && t.round >= c.audience_round)
    .map((t) => ({
      id: t.id,
      team: t.team,
      leader_name: t.leader_name,
      leader_email: t.leader_email,
      round: t.round,
      issue: t.issue,
      excluded: excluded.has(t.id),
      ...(withMembers ? { members: t.members } : {}),
    }));
  return { list, teams };
}
const STATUSES = ["queued", "sending", "sent", "failed", "uncertain"];
// Reads only the covering index, so the 3-second dashboard refresh stays cheap.
async function counts(db, c) {
  const { results } = await db
    .prepare(
      "SELECT status, COUNT(*) AS n FROM recipients WHERE campaign_id=? AND import_id=? AND is_test=0 GROUP BY status",
    )
    .bind(c.id, c.import_id || "")
    .all();
  const out = { queued: 0, sending: 0, sent: 0, failed: 0, uncertain: 0 };
  for (const row of results)
    if (STATUSES.includes(row.status)) out[row.status] = row.n;
  out.total = STATUSES.reduce((sum, status) => sum + out[status], 0);
  return out;
}
async function detail(db, c, env) {
  const tests = await db
    .prepare(
      "SELECT id,team,name,email,status,error,sent_at FROM recipients WHERE campaign_id=? AND is_test=1 ORDER BY rowid DESC LIMIT 5",
    )
    .bind(c.id)
    .all();
  const list = c.list_id
    ? await db
        .prepare("SELECT id,name,rounds,archived_at FROM team_lists WHERE id=?")
        .bind(c.list_id)
        .first()
    : null;
  return {
    id: c.id,
    name: c.name,
    subject: c.subject,
    html: c.html,
    state: c.state,
    version: c.version,
    list_id: c.list_id,
    list,
    audience_round: c.audience_round,
    excluded: parseExcluded(c),
    case_link: c.case_link,
    last_error: c.last_error,
    launched_at: c.launched_at,
    launched_by: c.launched_by,
    archived_at: c.archived_at,
    tests: tests.results,
    counts: c.import_id ? await counts(db, c) : null,
    settings: await settings(db, env),
  };
}

async function campaigns(ctx) {
  const { db, env, user, request, url, method, parts } = ctx;
  const [id, action] = parts;
  const now = Date.now();
  if (!id && method === "GET") {
    const { results } = await db
      .prepare(
        `SELECT c.id,c.name,c.state,c.updated_at,c.archived_at,c.audience_round,l.name AS list_name,
          (SELECT COUNT(*) FROM recipients r WHERE r.campaign_id=c.id AND r.import_id=c.import_id AND r.is_test=0) AS total,
          (SELECT COUNT(*) FROM recipients r WHERE r.campaign_id=c.id AND r.import_id=c.import_id AND r.is_test=0 AND r.status='sent') AS sent
        FROM campaigns c LEFT JOIN team_lists l ON l.id=c.list_id
        WHERE c.archived_at IS ${url.searchParams.get("trash") === "1" ? "NOT " : ""}NULL ORDER BY c.updated_at DESC LIMIT 100`,
      )
      .all();
    return json(results);
  }
  if (!id && method === "POST") {
    const b = await body(request);
    const newId = crypto.randomUUID();
    const name = inline(b.name).slice(0, 120) || "New email";
    let listId = null;
    if (b.list_id) listId = (await getList(db, clean(b.list_id))).id;
    await db.batch([
      db
        .prepare(
          "INSERT INTO campaigns(id,name,list_id,created_at,updated_at) VALUES(?,?,?,?,?)",
        )
        .bind(newId, name, listId, now, now),
      activity(db, user, {
        campaign: newId,
        list: listId,
        action: "create_email",
        summary: `Created email "${name}"`,
      }),
    ]);
    return json(await detail(db, await campaign(db, newId), env));
  }
  const c = await campaign(db, id);
  if (!action && method === "GET") return json(await detail(db, c, env));
  if (action === "audience" && method === "GET") return json(await audience(db, c));
  if (action === "stats" && method === "GET") {
    const recent = await db
      .prepare(
        "SELECT a.started_at,a.finished_at,a.status,a.error,r.team,r.email,r.is_test FROM attempts a JOIN recipients r ON r.id=a.recipient_id WHERE r.campaign_id=? ORDER BY a.started_at DESC LIMIT 8",
      )
      .bind(id)
      .all();
    return json({
      state: c.state,
      last_error: c.last_error,
      counts: await counts(db, c),
      recent: recent.results,
      settings: await settings(db, env, url.searchParams.get("full") === "1"),
      now: Date.now(),
    });
  }
  if (action === "recipients" && method === "GET") {
    const status = url.searchParams.get("status") || "";
    const q = `%${inline(url.searchParams.get("q")).toLowerCase()}%`;
    const all = url.searchParams.get("all") === "1";
    const page = Math.max(0, Number(url.searchParams.get("page")) || 0);
    const where =
      "campaign_id=? AND import_id=? AND is_test=0 AND (?='' OR status=?) AND (lower(team) LIKE ? OR lower(name) LIKE ? OR lower(email) LIKE ?)";
    const args = [id, c.import_id || "", status, status, q, q, q];
    const total = await db
      .prepare(`SELECT COUNT(*) AS n FROM recipients WHERE ${where}`)
      .bind(...args)
      .first();
    const { results } = await db
      .prepare(
        `SELECT id,team,name,email,status,attempts,error,sent_at FROM recipients WHERE ${where} ORDER BY team COLLATE NOCASE ${all ? "" : "LIMIT 50 OFFSET ?"}`,
      )
      .bind(...args, ...(all ? [] : [page * 50]))
      .all();
    return json({ total: total.n, page, items: results });
  }
  if (method !== "POST") fail(405, "Method not allowed");
  const b = await body(request);
  const log = (name, summary, extra = {}) =>
    activity(db, user, { campaign: id, list: c.list_id, action: name, summary, ...extra });

  if (action === "archive") {
    if (
      c.state === "running" ||
      (
        await db
          .prepare(
            "SELECT COUNT(*) n FROM recipients WHERE campaign_id=? AND status='sending'",
          )
          .bind(id)
          .first()
      ).n
    )
      fail(409, "Stop sending and wait for the current email to finish before deleting.");
    const archived = await db
      .prepare(
        "UPDATE campaigns SET archived_at=?,archived_state=state,state='archived',updated_at=? WHERE id=? AND archived_at IS NULL AND state!='running' AND NOT EXISTS(SELECT 1 FROM recipients WHERE campaign_id=? AND status='sending')",
      )
      .bind(now, now, id, id)
      .run();
    if (!archived.meta.changes)
      fail(409, "This email changed or is sending. Refresh before deleting.");
    await db.batch([
      db
        .prepare(
          "UPDATE recipients SET status='cancelled' WHERE campaign_id=? AND is_test=1 AND status='queued'",
        )
        .bind(id),
      log("archive_email", `Moved email "${c.name}" to Trash`),
    ]);
    return json({ ok: true });
  }
  if (action === "restore") {
    await db.batch([
      db
        .prepare(
          "UPDATE campaigns SET state=COALESCE(archived_state,'draft'),archived_at=NULL,archived_state=NULL,updated_at=? WHERE id=? AND archived_at IS NOT NULL",
        )
        .bind(now, id),
      log("restore_email", `Restored email "${c.name}"`),
    ]);
    return json(await detail(db, await campaign(db, id), env));
  }
  if (c.archived_at) fail(409, "Restore this email from Trash before changing it.");
  if (action === "rename") {
    const name = inline(b.name).slice(0, 120);
    if (!name) fail(400, "Enter a name");
    await db.batch([
      db
        .prepare("UPDATE campaigns SET name=?,updated_at=? WHERE id=?")
        .bind(name, now, id),
      log("rename_email", `Renamed email "${c.name}" to "${name}"`),
    ]);
    return json(await detail(db, await campaign(db, id), env));
  }
  if (action === "copy") {
    const copyId = crypto.randomUUID();
    const name = `${c.name.slice(0, 110)} (copy)`;
    await db.batch([
      db
        .prepare(
          "INSERT INTO campaigns(id,name,subject,html,list_id,audience_round,excluded,case_link,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          copyId,
          name,
          c.subject,
          c.html,
          c.list_id,
          c.audience_round,
          c.excluded,
          c.case_link,
          now,
          now,
        ),
      log("copy_email", `Copied email "${c.name}" as "${name}"`, { campaign: copyId }),
    ]);
    return json(await detail(db, await campaign(db, copyId), env));
  }
  if (action === "save") {
    if (c.state !== "draft")
      fail(409, "This email has been sent. Use Copy to make a new version.");
    if (Number(b.version) !== c.version)
      fail(409, "Someone else changed this email. Reload to see their changes.");
    // Autosave may send only the fields that changed.
    const subject = clean(b.subject ?? c.subject);
    if (subject.length > 200 || /[\r\n]/.test(subject))
      fail(400, "Subject must be one line under 200 characters");
    if (String(b.html || "").length > 200000)
      fail(400, "Email body must be under 200 KB");
    let listId = c.list_id;
    let round = c.audience_round;
    if (b.list_id !== undefined) {
      listId = b.list_id ? (await getList(db, clean(b.list_id))).id : null;
      if (listId !== c.list_id) round = 1;
    }
    if (b.audience_round !== undefined && listId) {
      const list = await getList(db, listId);
      round = Math.round(Number(b.audience_round));
      if (!(round >= 1 && round <= list.rounds))
        fail(400, `Choose a round between 1 and ${list.rounds}`);
    }
    const excluded =
      listId !== c.list_id
        ? []
        : Array.isArray(b.excluded)
          ? [...new Set(b.excluded.map(clean).filter(Boolean))].slice(0, MAX_TEAMS)
          : parseExcluded(c);
    const caseLink = clean(b.case_link ?? c.case_link);
    if (caseLink && (!/^https:\/\/[^\s"<>]+$/.test(caseLink) || caseLink.length > 500))
      fail(400, "The case link must be a full https:// address");
    const result = await db
      .prepare(
        "UPDATE campaigns SET name=?,subject=?,html=?,list_id=?,audience_round=?,excluded=?,case_link=?,version=version+1,updated_at=? WHERE id=? AND version=? AND state='draft'",
      )
      .bind(
        inline(b.name ?? c.name).slice(0, 120) || "Untitled email",
        subject,
        safeHtml(b.html ?? c.html),
        listId,
        round,
        JSON.stringify(excluded),
        caseLink,
        now,
        id,
        c.version,
      )
      .run();
    if (!result.meta.changes)
      fail(409, "Someone else changed this email. Reload to see their changes.");
    // A waiting test was for the old wording, so it would never be sent. Cancel it.
    await db
      .prepare(
        "UPDATE recipients SET status='cancelled',error='Replaced by later edits. Send a new test.' WHERE campaign_id=? AND is_test=1 AND status='queued'",
      )
      .bind(id)
      .run();
    return json(await detail(db, await campaign(db, id), env));
  }
  if (action === "test") {
    if (c.state !== "draft") fail(409, "Test emails are for drafts");
    validate(c);
    const email = clean(b.email).toLowerCase();
    if (!validEmail(email)) fail(400, "Enter a valid test address");
    const team = await db
      .prepare(
        "SELECT id,team,leader_name FROM teams WHERE id=? AND list_id=? AND deleted_at IS NULL",
      )
      .bind(clean(b.teamId), c.list_id || "")
      .first();
    if (!team) fail(400, "Choose a team to preview");
    // A waiting test is replaced by the new one. Only an email mid-send blocks.
    if (
      (
        await db
          .prepare(
            "SELECT COUNT(*) n FROM recipients WHERE campaign_id=? AND is_test=1 AND status='sending'",
          )
          .bind(id)
          .first()
      ).n
    )
      fail(409, "A test is being sent right now. Try again in a minute.");
    await db.batch([
      db
        .prepare(
          "UPDATE recipients SET status='cancelled' WHERE campaign_id=? AND is_test=1 AND status='queued'",
        )
        .bind(id),
      db
        .prepare(
          "INSERT INTO recipients(id,campaign_id,import_id,team,name,email,members,is_test,team_id) VALUES(?,?,?,?,?,?,?,1,?)",
        )
        .bind(
          crypto.randomUUID(),
          id,
          String(c.version),
          team.team,
          team.leader_name,
          email,
          "[]",
          team.id,
        ),
      log("queue_test", `Queued a test of "${c.name}" to ${email}`),
    ]);
    return json(await detail(db, await campaign(db, id), env));
  }
  if (action === "start") {
    const s = await settings(db, env);
    if (!s.ready) fail(409, "The sender is not set up. Contact the administrator.");
    if (c.state === "paused") {
      validate(c);
      await db.batch([
        db
          .prepare(
            "UPDATE campaigns SET state='running',last_error=NULL,updated_at=? WHERE id=? AND state='paused'",
          )
          .bind(now, id),
        log("resume_email", `Resumed sending "${c.name}"`),
      ]);
      return json(await detail(db, await campaign(db, id), env));
    }
    if (c.state !== "draft") fail(409, "This email is already sending or finished");
    validate(c);
    if (b.confirm !== true) fail(400, "Confirm the number of teams before sending");
    if (!c.list_id) fail(400, "Choose a team list first");
    const { list, teams } = await audience(db, c, true);
    if (list.archived_at) fail(409, "This team list is in Trash. Restore it first.");
    const chosen = teams.filter((t) => !t.excluded && !t.issue);
    if (!chosen.length) fail(400, "No teams would receive this email");
    if (Number(b.expected) !== chosen.length)
      fail(409, `The team list changed. ${chosen.length} teams would receive it now. Review and confirm again.`);
    // Snapshot the recipients, so later team edits never change a sent email.
    const importId = crypto.randomUUID();
    const inserts = chosen.map((t) =>
      db
        .prepare(
          "INSERT INTO recipients(id,campaign_id,import_id,team,name,email,members,team_id) VALUES(?,?,?,?,?,?,?,?)",
        )
        .bind(
          crypto.randomUUID(),
          id,
          importId,
          t.team,
          t.leader_name,
          t.leader_email,
          JSON.stringify(t.members || []),
          t.id,
        ),
    );
    for (let i = 0; i < inserts.length; i += 400)
      await db.batch(inserts.slice(i, i + 400));
    const [result] = await db.batch([
      db
        .prepare(
          "UPDATE campaigns SET import_id=?,state='running',last_error=NULL,launched_at=?,launched_by=?,updated_at=? WHERE id=? AND state='draft' AND version=?",
        )
        .bind(importId, now, user, now, id, c.version),
      // Drop rows from older drafts, or this launch's rows if another session won.
      db
        .prepare(
          "DELETE FROM recipients WHERE campaign_id=? AND is_test=0 AND import_id IS NOT (SELECT import_id FROM campaigns WHERE id=?) AND NOT EXISTS(SELECT 1 FROM attempts a WHERE a.recipient_id=recipients.id)",
        )
        .bind(id, id),
      db
        .prepare(
          "UPDATE recipients SET status='cancelled' WHERE campaign_id=? AND is_test=1 AND status='queued'",
        )
        .bind(id),
    ]);
    if (!result.meta.changes)
      fail(409, "This email changed in another session. Reload before sending.");
    await log(
      "start_email",
      `Started sending "${c.name}" to ${chosen.length} team leaders in "${list.name}" (Round ${c.audience_round} and up)`,
    ).run();
    return json(await detail(db, await campaign(db, id), env));
  }
  if (action === "pause") {
    await db.batch([
      db
        .prepare("UPDATE campaigns SET state='paused',updated_at=? WHERE id=? AND state='running'")
        .bind(now, id),
      log("stop_email", `Stopped sending "${c.name}"`),
    ]);
    return json(await detail(db, await campaign(db, id), env));
  }
  if (action === "retry") {
    if (c.state === "running") fail(409, "Stop sending before retrying");
    if (!["failed", "uncertain", "sent"].includes(b.status))
      fail(400, "Choose which emails to retry");
    if (b.status !== "failed" && !b.confirm)
      fail(400, "Confirm that the leader may receive another copy");
    // Resending everyone who already got the email is never one click away.
    if (b.status === "sent" && !clean(b.recipientId))
      fail(400, "Resend one team at a time");
    await db.batch([
      db
        .prepare(
          "UPDATE recipients SET status='queued',claim=NULL,error=NULL WHERE campaign_id=? AND import_id=? AND is_test=0 AND status=? AND (?='' OR id=?)",
        )
        .bind(id, c.import_id, b.status, clean(b.recipientId), clean(b.recipientId)),
      db
        .prepare("UPDATE campaigns SET state='paused' WHERE id=? AND state='done'")
        .bind(id),
      log(
        `retry_${b.status}`,
        b.recipientId
          ? `Queued "${c.name}" again for one team (${b.status})`
          : `Queued all ${b.status} emails of "${c.name}" again`,
      ),
    ]);
    return json(await detail(db, await campaign(db, id), env));
  }
  if (action === "resolve") {
    if (c.state === "running" || !b.confirm)
      fail(409, "Stop sending and confirm you checked delivery first");
    await db.batch([
      db
        .prepare(
          "UPDATE recipients SET status='sent',error=NULL,sent_at=? WHERE id=? AND campaign_id=? AND import_id=? AND is_test=0 AND status='uncertain'",
        )
        .bind(now, clean(b.recipientId), id, c.import_id),
      log("confirm_delivery", `Confirmed delivery of "${c.name}" for one team without resending`),
    ]);
    return json(await detail(db, await campaign(db, id), env));
  }
  fail(404, "Unknown action");
}

async function route(request, env) {
  const db = env.CAMPAIGN_DB;
  if (!db) fail(503, "Campaign database setup is pending");
  const url = new URL(request.url),
    path = url.pathname.replace(/^\/api\/campaigns\/?/, "").replace(/\/$/, ""),
    method = request.method;
  if (!["GET", "POST"].includes(method)) fail(405, "Method not allowed");
  if (
    method !== "GET" &&
    request.headers.get("origin") &&
    request.headers.get("origin") !== url.origin
  )
    fail(403, "Cross-origin request blocked");
  if (path.startsWith("runner/")) return runner(request, env, path.slice(7));
  if (path === "login" && method === "POST") {
    const b = await body(request),
      username = clean(b.username).toLowerCase();
    const now = Date.now();
    const ip = request.headers.get("cf-connecting-ip") || "local";
    // Per account 8 tries; per network 30, so one typo-prone helper on the
    // shared campus Wi-Fi cannot lock everyone else out.
    const failures = await db
      .prepare(
        "SELECT SUM(key=?) AS user, SUM(key=?) AS ip FROM admin_failures WHERE (key=? OR key=?) AND at>?",
      )
      .bind(username, ip, username, ip, now - 900000)
      .first();
    if ((failures?.user || 0) >= 8 || (failures?.ip || 0) >= 30)
      fail(429, "Too many attempts. Try again in 15 minutes.");
    const user = await db
      .prepare("SELECT * FROM admins WHERE username=?")
      .bind(username)
      .first();
    const valid = await verifyPassword(
      String(b.password || "").slice(0, 256),
      user?.password_hash ||
        "pbkdf2_sha256$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    );
    if (!user || !valid) {
      await db.batch([
        db.prepare("INSERT INTO admin_failures VALUES(?,?)").bind(username, now),
        db.prepare("INSERT INTO admin_failures VALUES(?,?)").bind(ip, now),
      ]);
      fail(401, "Incorrect username or password");
    }
    const token = randomHex(32);
    await db.batch([
      db
        .prepare("INSERT INTO admin_sessions VALUES(?,?,?)")
        .bind(await sha256Hex(token), username, now + 8 * 3600000),
      db.prepare("DELETE FROM admin_sessions WHERE expires_at<?").bind(now),
      db.prepare("DELETE FROM admin_failures WHERE at<?").bind(now - 86400000),
    ]);
    return json(
      { username, name: user.display_name || username, role: user.role || "admin" },
      200,
      {
        "set-cookie": `campaign_session=${token}; Path=/api/campaigns; HttpOnly; SameSite=Strict; Max-Age=28800${url.protocol === "https:" ? "; Secure" : ""}`,
      },
    );
  }
  const token = (request.headers.get("cookie") || "").match(
    /(?:^|;\s*)campaign_session=([a-f0-9]{64})(?:;|$)/,
  )?.[1];
  const session =
    token &&
    (await db
      .prepare(
        "SELECT s.username, COALESCE(a.role,'admin') AS role, COALESCE(a.display_name,s.username) AS name FROM admin_sessions s JOIN admins a ON a.username=s.username WHERE s.id=? AND s.expires_at>?",
      )
      .bind(await sha256Hex(token), Date.now())
      .first());
  if (!session) fail(401, "Please sign in");
  const { username: user, role } = session;
  if (path === "session" && method === "GET")
    return json({ username: user, name: session.name, role });
  if (path === "logout" && method === "POST") {
    await db
      .prepare("DELETE FROM admin_sessions WHERE id=?")
      .bind(await sha256Hex(token))
      .run();
    return json({ ok: true }, 200, {
      "set-cookie":
        "campaign_session=; Path=/api/campaigns; HttpOnly; SameSite=Strict; Max-Age=0",
    });
  }
  const parts = path.split("/");
  const ctx = { db, env, user, role, request, url, method, parts };
  if (["lists", "teams", "activity"].includes(parts[0])) return handleTeams(ctx);
  // Helpers manage team lists only. Emails and sending are for main admins.
  if (role !== "admin") fail(403, "Only main admins can manage emails");
  if (parts[0] === "emails") return campaigns({ ...ctx, parts: parts.slice(1) });
  fail(404, "Unknown request");
}

async function runner(request, env, action) {
  if (request.method !== "POST") fail(405, "Method not allowed");
  const db = env.CAMPAIGN_DB,
    authorization = request.headers.get("authorization") || "";
  if (
    !env.CAMPAIGN_RUNNER_TOKEN ||
    (await sha256Hex(authorization)) !==
      (await sha256Hex(`Bearer ${env.CAMPAIGN_RUNNER_TOKEN}`))
  )
    fail(401, "Unauthorized sender");
  const b = await body(request),
    now = Date.now();
  await db.prepare("UPDATE sender SET heartbeat=? WHERE id=1").bind(now).run();
  if (action === "report") {
    const p = await db
      .prepare("SELECT * FROM recipients WHERE claim=? AND status='sending'")
      .bind(clean(b.claim))
      .first();
    if (!p) return json({ ok: true });
    const status = b.ok ? "sent" : b.uncertain ? "uncertain" : "failed";
    await db.batch([
      db
        .prepare(
          "UPDATE recipients SET status=?,error=?,sent_at=?,message_id=? WHERE id=? AND claim=? AND status='sending'",
        )
        .bind(
          status,
          clean(b.error).slice(0, 300) || null,
          b.ok ? now : null,
          clean(b.messageId).slice(0, 200) || null,
          p.id,
          b.claim,
        ),
      db
        .prepare(
          "UPDATE attempts SET status=?,finished_at=?,message_id=?,error=? WHERE id=? AND status='sending'",
        )
        .bind(
          status,
          now,
          clean(b.messageId).slice(0, 200) || null,
          clean(b.error).slice(0, 300) || null,
          b.claim,
        ),
    ]);
    if (b.ok && p.is_test)
      await db
        .prepare(
          "UPDATE campaigns SET tested_version=? WHERE id=? AND version=?",
        )
        .bind(Number(p.import_id), p.campaign_id, Number(p.import_id))
        .run();
    if (b.pause)
      await db
        .prepare(
          "UPDATE campaigns SET state=CASE WHEN state='running' THEN 'paused' ELSE state END,last_error=? WHERE id=?",
        )
        .bind(clean(b.error).slice(0, 300), p.campaign_id)
        .run();
    return json({ ok: true });
  }
  if (action !== "claim") fail(404, "Unknown sender action");
  const claim = clean(b.claim);
  if (!/^[a-f0-9-]{36}$/.test(claim)) fail(400, "Invalid claim");
  const prior = await db
    .prepare("SELECT * FROM recipients WHERE claim=?")
    .bind(claim)
    .first();
  if (prior) {
    if (prior.status !== "sending") return json({ wait: 5 });
    return json(await job(db, env, prior));
  }
  await db
    .prepare(
      "UPDATE recipients SET status='uncertain',error='Sender interrupted. Check delivery before retrying.' WHERE status='sending' AND claimed_at<?",
    )
    .bind(now - 600000)
    .run();
  await db
    .prepare(
      "UPDATE attempts SET status='uncertain',finished_at=?,error='Sender interrupted. Check delivery before retrying.' WHERE status='sending' AND started_at<?",
    )
    .bind(now, now - 600000)
    .run();
  await db
    .prepare(
      "UPDATE campaigns SET state='paused',last_error='Delivery uncertain. Review results before resuming.' WHERE state='running' AND EXISTS(SELECT 1 FROM recipients r WHERE r.campaign_id=campaigns.id AND r.import_id=campaigns.import_id AND r.status='uncertain')",
    )
    .run();
  await db
    .prepare(
      "UPDATE campaigns SET state='done' WHERE state='running' AND NOT EXISTS(SELECT 1 FROM recipients r WHERE r.campaign_id=campaigns.id AND r.import_id=campaigns.import_id AND r.enabled=1 AND r.is_test=0 AND r.status IN ('queued','sending'))",
    )
    .run();
  const s = config(env);
  if (!s.ready) return json({ stop: true, reason: "Sender not configured" });
  if (
    await db
      .prepare("SELECT 1 AS busy FROM recipients WHERE status='sending' LIMIT 1")
      .first()
  )
    return json({ wait: 5 });
  const lock = await db
    .prepare(
      "UPDATE sender SET next_at=? WHERE id=1 AND next_at<=? RETURNING id",
    )
    .bind(now + Math.ceil(60000 / s.perMinute), now)
    .first();
  if (!lock) {
    const current = await db
      .prepare("SELECT next_at FROM sender WHERE id=1")
      .first();
    return json({
      wait: Math.max(0.05, (current.next_at - Date.now()) / 1000),
    });
  }
  const results = await db.batch([
    db
      .prepare(
        `UPDATE recipients SET status='sending',claim=?,claimed_at=?,attempts=attempts+1 WHERE id=(SELECT r.id FROM recipients r JOIN campaigns c ON c.id=r.campaign_id WHERE r.status='queued' AND r.enabled=1 AND (?='' OR (r.id=? AND r.is_test=1)) AND ((r.is_test=1 AND c.state='draft' AND r.import_id=CAST(c.version AS TEXT)) OR (r.is_test=0 AND c.state='running' AND r.import_id=c.import_id)) ORDER BY r.is_test DESC,c.created_at,r.team COLLATE NOCASE,r.id LIMIT 1) AND status='queued' AND NOT EXISTS(SELECT 1 FROM recipients WHERE status='sending') AND (SELECT COUNT(*) FROM attempts WHERE started_at>?)<? RETURNING *`,
      )
      .bind(
        claim,
        now,
        clean(b.testId),
        clean(b.testId),
        now - 86400000,
        s.dailyLimit,
      ),
    db
      .prepare(
        "INSERT INTO attempts(id,recipient_id,started_at) SELECT ?,id,? FROM recipients WHERE claim=? AND status='sending'",
      )
      .bind(claim, now, claim),
  ]);
  const p = results[0].results[0];
  if (!p) {
    // Nothing claimed: free the rate slot, then say whether the queue is empty
    // or the 24-hour allowance is used up. Only this path counts attempts.
    await db.prepare("UPDATE sender SET next_at=? WHERE id=1").bind(now).run();
    const usage = await settings(db, env);
    if (usage.used >= usage.dailyLimit)
      return json({
        stop: true,
        reason: "Rolling daily allowance reached",
        resumeAt: usage.resumeAt,
      });
    return json({ stop: true, idle: true, reason: "No queued campaign" });
  }
  return json(await job(db, env, p));
}
async function job(db, env, p) {
  const c = await campaign(db, p.campaign_id);
  const rendered = render(c, p);
  return {
    claim: p.claim,
    provider: env.CAMPAIGN_PROVIDER || "hostinger",
    to: { name: p.name, email: p.email },
    html: emailDocument(rendered.html),
    text: rendered.text,
    subject: (p.is_test ? "[TEST] " : "") + rendered.subject,
  };
}
export async function handleCampaignApi(request, env) {
  try {
    return await route(request, env);
  } catch (error) {
    if (error instanceof CampaignError)
      return json({ error: error.message, ...(error.data || {}) }, error.status);
    console.error("Campaign API failure", error.name, error.message);
    return json(
      {
        error:
          "Campaign service unavailable. Reload or contact the administrator.",
      },
      503,
    );
  }
}
