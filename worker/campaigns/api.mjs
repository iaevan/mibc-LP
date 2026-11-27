import sanitizeHtml from "sanitize-html";
import { parseCsv, sha256Hex, randomHex, verifyPassword } from "./shared.mjs";

export class CampaignError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => {
  throw new CampaignError(status, message);
};
const validEmail = (value) => {
  if (typeof value !== "string" || value.length > 254) return false;
  const parts = value.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  return (
    local.length <= 64 &&
    /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local) &&
    !local.startsWith(".") &&
    !local.endsWith(".") &&
    !local.includes("..") &&
    domain.includes(".") &&
    domain
      .split(".")
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
  );
};
const clean = (value) => String(value ?? "").trim();
const inline = (value) =>
  clean(value)
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .replace(/\s+/g, " ");
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
export function render(campaign, person) {
  const replace = (text, html) =>
    text.replace(/{{\s*(team_name|recipient_name)\s*}}/g, (_, key) =>
      html
        ? escape(key === "team_name" ? person.team : person.name)
        : inline(key === "team_name" ? person.team : person.name),
    );
  return {
    subject: replace(campaign.subject, false),
    html: safeHtml(replace(campaign.html, true)),
  };
}
export function importTeams(csv) {
  let parsed;
  try {
    parsed = parseCsv(csv);
  } catch {
    fail(400, "CSV contains an unclosed quoted field");
  }
  const [header, ...rows] = parsed;
  if (!header) fail(400, "The CSV is empty");
  const labels = header.map((x) => x.toLowerCase().replace(/[^a-z]/g, ""));
  const teamColumn = labels.findIndex((x) => x.startsWith("teamname"));
  const names = labels.flatMap((x, i) =>
    /^(name|fullname|participantname)(\d+)?$/.test(x) ? [i] : [],
  );
  if (teamColumn < 0 || !names.length)
    fail(
      400,
      "CSV needs Team Name and repeated Name, Institute, Student ID, Email, Phone columns.",
    );
  if (rows.length > 10000)
    fail(400, "Import at most 10,000 teams per campaign");
  const seen = new Map();
  if (!rows.length) fail(400, "The CSV has headers but no teams");
  return rows.map((row, index) => {
    const members = names
      .map((start, n) => {
        const end = names[n + 1] ?? header.length;
        const field = (fragment) => {
          const j = labels.findIndex(
            (label, i) => i >= start && i < end && label.includes(fragment),
          );
          return j < 0 ? "" : clean(row[j]);
        };
        return {
          name: clean(row[start]),
          email: field("email").toLowerCase(),
          institute: field("institute"),
          studentId: field("studentid"),
          phone: field("phone"),
        };
      })
      .filter((m) => Object.values(m).some(Boolean));
    // Always select the first participant group, even if its email is missing.
    const start = names[0],
      end = names[1] ?? header.length;
    const emailColumn = labels.findIndex(
      (label, i) => i >= start && i < end && label.includes("email"),
    );
    const team = clean(row[teamColumn]),
      name = clean(row[start]),
      email = clean(row[emailColumn]).toLowerCase();
    const duplicate = email && seen.has(email);
    if (email) seen.set(email, index);
    return {
      id: crypto.randomUUID(),
      line: index + 2,
      team,
      name,
      email,
      members,
      enabled: true,
      issue: !team
        ? "Missing team name"
        : !name
          ? "Missing first participant name"
          : !validEmail(email)
            ? "Invalid first participant email"
            : duplicate
              ? "Shared recipient address. Confirm this team should receive its own email."
              : "",
    };
  });
}
function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
      ...extra,
    },
  });
}
async function body(request) {
  if (Number(request.headers.get("content-length")) > 4_000_000)
    fail(413, "Upload must be under 4 MB");
  const text = await request.text();
  if (text.length > 4_000_000) fail(413, "Upload must be under 4 MB");
  try {
    return JSON.parse(text);
  } catch {
    fail(400, "Invalid JSON");
  }
}
function audit(db, user, action, id = null) {
  return db
    .prepare(
      "INSERT INTO audit(username,action,campaign_id,at) VALUES(?,?,?,?)",
    )
    .bind(user, action, id, Date.now());
}
async function campaign(db, id) {
  const c = await db
    .prepare("SELECT * FROM campaigns WHERE id=?")
    .bind(id)
    .first();
  if (!c) fail(404, "Campaign not found");
  return c;
}
async function settings(db, env) {
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
  const used = await db
    .prepare("SELECT COUNT(*) AS n FROM attempts WHERE started_at>?")
    .bind(Date.now() - 86400000)
    .first();
  const sender = await db.prepare("SELECT * FROM sender WHERE id=1").first();
  return {
    provider,
    dailyLimit: cap,
    perMinute: rate,
    used: used.n,
    heartbeat: sender.heartbeat,
    ready: !!env.CAMPAIGN_RUNNER_TOKEN && cap > 0,
  };
}
async function detail(db, id, env) {
  const c = await campaign(db, id);
  const people = await db
    .prepare(
      "SELECT * FROM recipients WHERE campaign_id=? AND (import_id=? OR is_test=1) ORDER BY is_test DESC,team,id",
    )
    .bind(id, c.import_id || "")
    .all();
  const attempts = await db
    .prepare(
      "SELECT a.* FROM attempts a JOIN recipients r ON r.id=a.recipient_id WHERE r.campaign_id=? ORDER BY a.started_at DESC LIMIT 500",
    )
    .bind(id)
    .all();
  return {
    ...c,
    people: people.results.map((p) => ({
      ...p,
      members: JSON.parse(p.members),
    })),
    history: attempts.results,
    settings: await settings(db, env),
  };
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
    const failures = await db
      .prepare(
        "SELECT COUNT(*) n FROM admin_failures WHERE (key=? OR key=?) AND at>?",
      )
      .bind(username, ip, now - 900000)
      .first();
    if (failures.n >= 8)
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
        db
          .prepare("INSERT INTO admin_failures VALUES(?,?)")
          .bind(username, now),
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
    return json({ username }, 200, {
      "set-cookie": `campaign_session=${token}; Path=/api/campaigns; HttpOnly; SameSite=Strict; Max-Age=28800${url.protocol === "https:" ? "; Secure" : ""}`,
    });
  }
  const token = (request.headers.get("cookie") || "").match(
    /(?:^|;\s*)campaign_session=([a-f0-9]{64})(?:;|$)/,
  )?.[1];
  const session =
    token &&
    (await db
      .prepare(
        "SELECT username FROM admin_sessions WHERE id=? AND expires_at>?",
      )
      .bind(await sha256Hex(token), Date.now())
      .first());
  if (!session) fail(401, "Please sign in");
  const user = session.username;
  if (path === "session" && method === "GET")
    return json({ username: user, settings: await settings(db, env) });
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
  if (path === "parse" && method === "POST")
    return json({ teams: importTeams((await body(request)).csv) });
  if (path === "" && method === "GET")
    return json(
      (
        await db
          .prepare(
            `SELECT id,name,state,updated_at,archived_at FROM campaigns WHERE archived_at IS ${url.searchParams.get("trash") === "1" ? "NOT " : ""}NULL ORDER BY updated_at DESC LIMIT 100`,
          )
          .all()
      ).results,
    );
  if (path === "" && method === "POST") {
    const b = await body(request),
      id = crypto.randomUUID(),
      now = Date.now();
    await db.batch([
      db
        .prepare(
          "INSERT INTO campaigns(id,name,created_at,updated_at) VALUES(?,?,?,?)",
        )
        .bind(id, clean(b.name).slice(0, 120) || "New campaign", now, now),
      audit(db, user, "create", id),
    ]);
    return json(await detail(db, id, env));
  }
  const [id, action] = path.split("/");
  const c = await campaign(db, id);
  if (!action && method === "GET") return json(await detail(db, id, env));
  const b = method === "GET" ? {} : await body(request);
  if (action === "archive" && method === "POST") {
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
      fail(
        409,
        "Pause sending and wait for the current email to finish before deleting.",
      );
    const archived = await db
      .prepare(
        "UPDATE campaigns SET archived_at=?,archived_state=state,state='archived',updated_at=? WHERE id=? AND archived_at IS NULL AND state!='running' AND NOT EXISTS(SELECT 1 FROM recipients WHERE campaign_id=? AND status='sending')",
      )
      .bind(Date.now(), Date.now(), id, id)
      .run();
    if (!archived.meta.changes)
      fail(
        409,
        "Campaign changed or an email is in progress. Refresh before deleting.",
      );
    await db.batch([
      db
        .prepare(
          "UPDATE recipients SET status='cancelled' WHERE campaign_id=? AND is_test=1 AND status='queued'",
        )
        .bind(id),
      audit(db, user, "move_to_trash", id),
    ]);
    return json({ ok: true });
  }
  if (action === "restore" && method === "POST") {
    await db.batch([
      db
        .prepare(
          "UPDATE campaigns SET state=COALESCE(archived_state,'draft'),archived_at=NULL,archived_state=NULL,updated_at=? WHERE id=? AND archived_at IS NOT NULL",
        )
        .bind(Date.now(), id),
      audit(db, user, "restore", id),
    ]);
    return json(await detail(db, id, env));
  }
  if (c.archived_at)
    fail(409, "Restore this campaign from Trash before changing it.");
  if (action === "rename" && method === "POST") {
    const name = inline(b.name).slice(0, 120);
    if (!name) fail(400, "Enter a campaign name");
    await db.batch([
      db
        .prepare("UPDATE campaigns SET name=?,updated_at=? WHERE id=?")
        .bind(name, Date.now(), id),
      audit(db, user, "rename", id),
    ]);
    return json(await detail(db, id, env));
  }
  if (action === "copy" && method === "POST") {
    const copyId = crypto.randomUUID(),
      importId = crypto.randomUUID(),
      now = Date.now();
    // New recipient IDs and claims prevent carrying delivery state into a new draft.
    await db.batch([
      db
        .prepare(
          "INSERT INTO campaigns(id,name,subject,html,import_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
        )
        .bind(
          copyId,
          `${c.name.slice(0, 110)} (copy)`,
          c.subject,
          c.html,
          importId,
          now,
          now,
        ),
      db
        .prepare(
          "INSERT INTO recipients(id,campaign_id,import_id,team,name,email,members,issue,enabled,shared_confirmed) SELECT lower(hex(randomblob(16))),?,?,team,name,email,members,issue,enabled,shared_confirmed FROM recipients WHERE campaign_id=? AND import_id=? AND is_test=0",
        )
        .bind(copyId, importId, id, c.import_id || ""),
      audit(db, user, "copy", copyId),
    ]);
    return json(await detail(db, copyId, env));
  }
  if (["save", "import", "recipient"].includes(action)) {
    if (c.state !== "draft")
      fail(
        409,
        "Campaign is frozen after launch. Create a new campaign for edits.",
      );
    if (c.version !== b.version)
      fail(409, "This draft changed in another session. Reload before saving.");
  }
  if (action === "save" && method === "POST") {
    const subject = clean(b.subject);
    if (subject.length > 200 || /[\r\n]/.test(subject))
      fail(400, "Subject must be one line under 200 characters");
    if (String(b.html || "").length > 200000)
      fail(400, "Template must be under 200 KB");
    const result = await db
      .prepare(
        "UPDATE campaigns SET name=?,subject=?,html=?,version=version+1,updated_at=? WHERE id=? AND version=? AND state='draft'",
      )
      .bind(
        inline(b.name).slice(0, 120) || "Untitled campaign",
        subject,
        safeHtml(b.html),
        Date.now(),
        id,
        b.version,
      )
      .run();
    if (!result.meta.changes) fail(409, "Draft changed. Reload.");
  } else if (action === "import" && method === "POST") {
    if (!Array.isArray(b.teams) || b.teams.length > 10000)
      fail(400, "Invalid team list");
    const importId = crypto.randomUUID();
    const seen = new Set();
    const teams = b.teams.map((p) => {
      if (!p || !Array.isArray(p.members) || p.members.length > 10)
        fail(400, "Each team must have at most 10 members");
      const members = p.members.map((m) =>
        Object.fromEntries(
          ["name", "email", "institute", "studentId", "phone"].map((key) => [
            key,
            inline(m[key]).slice(0, 255),
          ]),
        ),
      );
      const email = clean(p.email).toLowerCase(),
        team = inline(p.team),
        name = inline(p.name),
        duplicate = seen.has(email);
      if (email) seen.add(email);
      const issue = !team
        ? "Missing team name"
        : !name
          ? "Missing first participant name"
          : !validEmail(email)
            ? "Invalid first participant email"
            : duplicate && !p.shared_confirmed
              ? "Shared recipient address. Confirm this team should receive its own email."
              : "";
      return { ...p, members, issue };
    });
    for (let offset = 0; offset < teams.length; offset += 500) {
      await db.batch(
        teams
          .slice(offset, offset + 500)
          .map((p) =>
            db
              .prepare(
                "INSERT INTO recipients(id,campaign_id,import_id,team,name,email,members,issue,enabled,shared_confirmed) VALUES(?,?,?,?,?,?,?,?,?,?)",
              )
              .bind(
                crypto.randomUUID(),
                id,
                importId,
                inline(p.team).slice(0, 160),
                inline(p.name).slice(0, 160),
                clean(p.email).toLowerCase().slice(0, 255),
                JSON.stringify(p.members),
                inline(p.issue).slice(0, 255),
                p.enabled === false || p.enabled === 0 ? 0 : 1,
                p.shared_confirmed ? 1 : 0,
              ),
          ),
      );
    }
    // Activate the new list and drop every other draft list in one transaction.
    // If another session won the race, the delete removes this upload instead.
    const [result] = await db.batch([
      db
        .prepare(
          "UPDATE campaigns SET import_id=?,version=version+1,updated_at=? WHERE id=? AND version=? AND state='draft'",
        )
        .bind(importId, Date.now(), id, b.version),
      db
        .prepare(
          "DELETE FROM recipients WHERE campaign_id=? AND is_test=0 AND import_id IS NOT (SELECT import_id FROM campaigns WHERE id=?) AND NOT EXISTS(SELECT 1 FROM attempts a WHERE a.recipient_id=recipients.id)",
        )
        .bind(id, id),
    ]);
    if (!result.meta.changes)
      fail(409, "Draft changed. Reload and import again.");
  } else if (action === "test" && method === "POST") {
    if (c.state !== "draft") fail(409, "Tests are available before launch");
    validate(c);
    const email = clean(b.email).toLowerCase();
    if (!validEmail(email)) fail(400, "Enter a valid test address");
    await db
      .prepare(
        "UPDATE recipients SET status='cancelled' WHERE campaign_id=? AND is_test=1 AND status='queued' AND import_id!=?",
      )
      .bind(id, String(c.version))
      .run();
    const person = await db
      .prepare(
        "SELECT * FROM recipients WHERE id=? AND campaign_id=? AND import_id=?",
      )
      .bind(b.recipientId, id, c.import_id)
      .first();
    if (!person) fail(400, "Select a preview team");
    if (
      (
        await db
          .prepare(
            "SELECT COUNT(*) n FROM recipients WHERE campaign_id=? AND is_test=1 AND status IN ('queued','sending')",
          )
          .bind(id)
          .first()
      ).n
    )
      fail(409, "A test is already waiting or sending");
    await db.batch([
      db
        .prepare(
          "INSERT INTO recipients(id,campaign_id,import_id,team,name,email,members,is_test) VALUES(?,?,?,?,?,?,?,1)",
        )
        .bind(
          crypto.randomUUID(),
          id,
          String(c.version),
          person.team,
          person.name,
          email,
          "[]",
        ),
      audit(db, user, "queue_test", id),
    ]);
  } else if (action === "start" && method === "POST") {
    validate(c);
    const s = await settings(db, env);
    if (!s.ready)
      fail(409, "Sender credentials or provider limits are not configured");
    if (c.tested_version !== c.version)
      fail(409, "Send a successful test of the current draft first");
    if (c.state === "draft") {
      if (b.reviewed !== true)
        fail(
          400,
          "Confirm that you reviewed the test email and recipient list before launch.",
        );
      if (c.tested_version !== c.version)
        fail(409, "Send a successful test of the current draft first");
      const list = (
        await db
          .prepare(
            "SELECT * FROM recipients WHERE campaign_id=? AND import_id=? AND enabled=1",
          )
          .bind(id, c.import_id)
          .all()
      ).results;
      if (!list.length) fail(400, "No teams selected");
      if (
        list.some((p) => p.issue || !p.team || !p.name || !validEmail(p.email))
      )
        fail(400, "Correct or exclude flagged teams first");
    }
    if (!["draft", "paused"].includes(c.state))
      fail(409, "Campaign is already running or complete");
    await db.batch([
      db
        .prepare(
          "UPDATE campaigns SET state='running',last_error=NULL,updated_at=? WHERE id=? AND state=? AND version=?",
        )
        .bind(Date.now(), id, c.state, c.version),
      audit(db, user, "start", id),
    ]);
  } else if (action === "pause" && method === "POST") {
    await db.batch([
      db
        .prepare(
          "UPDATE campaigns SET state='paused' WHERE id=? AND state='running'",
        )
        .bind(id),
      audit(db, user, "pause", id),
    ]);
  } else if (action === "retry" && method === "POST") {
    if (c.state === "running") fail(409, "Pause before retrying recipients");
    if (!["failed", "uncertain", "sent"].includes(b.status))
      fail(400, "Select a result status");
    if (b.status !== "failed" && !b.confirm)
      fail(400, "Confirm the possibility of sending another copy");
    await db.batch([
      db
        .prepare(
          "UPDATE recipients SET status='queued',claim=NULL,error=NULL WHERE campaign_id=? AND import_id=? AND is_test=0 AND status=? AND (?='' OR id=?)",
        )
        .bind(
          id,
          c.import_id,
          b.status,
          clean(b.recipientId),
          clean(b.recipientId),
        ),
      db
        .prepare(
          "UPDATE campaigns SET state='paused' WHERE id=? AND state='done'",
        )
        .bind(id),
      audit(db, user, `retry_${b.status}`, id),
    ]);
  } else if (action === "resolve" && method === "POST") {
    if (c.state === "running" || !b.confirm)
      fail(
        409,
        "Pause and confirm delivery was checked before resolving an uncertain email",
      );
    await db.batch([
      db
        .prepare(
          "UPDATE recipients SET status='sent',error=NULL,sent_at=? WHERE id=? AND campaign_id=? AND import_id=? AND is_test=0 AND status='uncertain'",
        )
        .bind(Date.now(), clean(b.recipientId), id, c.import_id),
      audit(db, user, "manually_confirm_delivery", id),
    ]);
  } else fail(404, "Unknown action");
  return json(await detail(db, id, env));
}
function validate(c) {
  if (
    !c.subject ||
    !c.html ||
    !sanitizeHtml(c.html, { allowedTags: [], allowedAttributes: {} }).trim()
  )
    fail(400, "Subject and email body are required");
  const rest = (c.subject + c.html).replace(
    /{{\s*(team_name|recipient_name)\s*}}/g,
    "",
  );
  if (rest.includes("{{") || rest.includes("}}"))
    fail(400, "Use only {{team_name}} and {{recipient_name}} placeholders");
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
  const s = await settings(db, env);
  if (!s.ready) return json({ stop: true, reason: "Sender not configured" });
  if (s.used >= s.dailyLimit)
    return json({ stop: true, reason: "Rolling daily allowance reached" });
  if (
    (
      await db
        .prepare("SELECT COUNT(*) n FROM recipients WHERE status='sending'")
        .first()
    ).n
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
        `UPDATE recipients SET status='sending',claim=?,claimed_at=?,attempts=attempts+1 WHERE id=(SELECT r.id FROM recipients r JOIN campaigns c ON c.id=r.campaign_id WHERE r.status='queued' AND r.enabled=1 AND (?='' OR (r.id=? AND r.is_test=1)) AND ((r.is_test=1 AND c.state='draft' AND r.import_id=CAST(c.version AS TEXT)) OR (r.is_test=0 AND c.state='running' AND r.import_id=c.import_id)) ORDER BY r.is_test DESC,c.created_at,r.id LIMIT 1) AND status='queued' AND NOT EXISTS(SELECT 1 FROM recipients WHERE status='sending') AND (SELECT COUNT(*) FROM attempts WHERE started_at>?)<? RETURNING *`,
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
  if (!p) return json({ stop: true, reason: "No queued campaign" });
  return json(await job(db, env, p));
}
async function job(db, env, p) {
  const c = await campaign(db, p.campaign_id);
  return {
    claim: p.claim,
    provider: env.CAMPAIGN_PROVIDER || "hostinger",
    to: { name: p.name, email: p.email },
    ...render(c, p),
    subject: (p.is_test ? "[TEST] " : "") + render(c, p).subject,
  };
}
export async function handleCampaignApi(request, env) {
  try {
    return await route(request, env);
  } catch (error) {
    if (error instanceof CampaignError)
      return json({ error: error.message }, error.status);
    console.error("Campaign API failure", error.name);
    return json(
      {
        error:
          "Campaign service unavailable. Reload or contact the administrator.",
      },
      503,
    );
  }
}
