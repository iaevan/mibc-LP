// Shared team lists: sheet import, per-team edits, rounds and the activity log.
import { parseCsv } from "./shared.mjs";
import {
  activity,
  body,
  clean,
  fail,
  inline,
  json,
  validEmail,
} from "./util.mjs";

export const MAX_TEAMS = 10000;
export const MAX_ROUNDS = 10;
const MEMBER_FIELDS = ["name", "email", "institute", "studentId", "phone"];
const FIELD_LABELS = {
  name: "name",
  email: "email",
  institute: "institute",
  studentId: "student ID",
  phone: "phone",
};

const key = (value) => inline(value).toLowerCase();
const byTeamName = (a, b) =>
  a.team.localeCompare(b.team, "en", { numeric: true, sensitivity: "base" });

// Google Sheets drops the leading zero of Bangladeshi mobile numbers.
export function fixPhone(value) {
  const text = inline(value);
  const digits = text.replace(/[\s-]/g, "");
  return /^1[3-9]\d{8}$/.test(digits) ? `0${digits}` : text;
}

function member(input = {}) {
  return Object.fromEntries(
    MEMBER_FIELDS.map((field) => {
      const value = inline(input[field]).slice(0, 255);
      return [
        field,
        field === "email"
          ? value.toLowerCase()
          : field === "phone"
            ? fixPhone(value)
            : value,
      ];
    }),
  );
}

// Member 1 is always the leader, so the leader fields and member 1 stay in sync.
export function normalizeTeam(input = {}) {
  const members = (Array.isArray(input.members) ? input.members : [])
    .slice(0, 10)
    .map(member);
  const leader = members[0] || member();
  const leaderName = inline(input.leader_name ?? leader.name).slice(0, 160);
  const leaderEmail = clean(input.leader_email ?? leader.email)
    .toLowerCase()
    .slice(0, 254);
  members[0] = { ...leader, name: leaderName, email: leaderEmail };
  return {
    team: inline(input.team).slice(0, 160),
    leader_name: leaderName,
    leader_email: leaderEmail,
    members,
  };
}

// Accepts the Google Forms export: Team Name, then repeated Name, Institute,
// Student ID, Email and Phone columns. The first group is the leader.
export function parseTeamSheet(csv) {
  let rows;
  try {
    rows = parseCsv(csv);
  } catch {
    fail(400, "The CSV has an unclosed quote. Download it again from Google Sheets.");
  }
  const [header, ...data] = rows;
  if (!header) fail(400, "The CSV is empty");
  const labels = header.map((x) => x.toLowerCase().replace(/[^a-z]/g, ""));
  const teamColumn = labels.findIndex(
    (x) => x.startsWith("teamname") || x === "team",
  );
  const starts = labels.flatMap((x, i) =>
    /^(name|fullname|participantname|leadername|leaderfullname|leader|membername|teamleadername|teamleader)$/.test(
      x,
    )
      ? [i]
      : [],
  );
  if (teamColumn < 0 || !starts.length)
    fail(
      400,
      "The sheet needs a Team Name column and Name, Institute, Student ID, Email and Phone columns for each member.",
    );
  if (data.length > MAX_TEAMS) fail(400, "Upload at most 10,000 teams at once");
  const teams = [];
  for (const row of data) {
    const members = starts
      .map((start, n) => {
        const end = starts[n + 1] ?? header.length;
        const field = (...fragments) => {
          const j = labels.findIndex(
            (label, i) =>
              i > start &&
              i < end &&
              fragments.some((fragment) => label.includes(fragment)),
          );
          return j < 0 ? "" : row[j];
        };
        return member({
          name: row[start],
          email: field("email", "mail"),
          institute: field("institute", "university", "institution"),
          studentId: field("studentid", "idno", "studentno"),
          phone: field("phone", "mobile", "contact", "whatsapp"),
        });
      })
      .filter((m, index) => index === 0 || Object.values(m).some(Boolean));
    const team = normalizeTeam({ team: row[teamColumn], members });
    if (!team.team && !Object.values(team.members[0]).some(Boolean)) continue;
    teams.push(team);
  }
  if (!teams.length) fail(400, "The sheet has headings but no teams");
  return teams.sort(byTeamName);
}

// Problems are worked out from the whole list, because duplicates involve two teams.
export function withIssues(rows) {
  const live = rows.filter((t) => !t.deleted_at);
  const emails = new Map();
  const names = new Map();
  for (const t of live) {
    if (t.leader_email)
      emails.set(t.leader_email, (emails.get(t.leader_email) || 0) + 1);
    if (t.team) names.set(key(t.team), (names.get(key(t.team)) || 0) + 1);
  }
  return rows.map((t) => {
    const confirmed = !!t.shared_confirmed;
    const issue = t.deleted_at
      ? ""
      : !t.team
        ? "Missing team name"
        : !t.leader_name
          ? "Missing leader name"
          : !validEmail(t.leader_email)
            ? "Leader email is missing or invalid"
            : emails.get(t.leader_email) > 1 && !confirmed
              ? "Same leader email as another team"
              : names.get(key(t.team)) > 1 && !confirmed
                ? "Same team name as another team"
                : "";
    return { ...t, issue };
  });
}

const TEAM_COLUMNS =
  "id,list_id,team,leader_name,leader_email,members,round,shared_confirmed,version,updated_at,updated_by,deleted_at";
const toTeam = (row) => ({
  ...row,
  members: JSON.parse(row.members || "[]"),
});
export async function listTeams(db, listId) {
  const { results } = await db
    .prepare(`SELECT ${TEAM_COLUMNS} FROM teams WHERE list_id=?`)
    .bind(listId)
    .all();
  return withIssues(results.map(toTeam)).sort(byTeamName);
}
export async function getList(db, id) {
  const list = await db
    .prepare("SELECT * FROM team_lists WHERE id=?")
    .bind(id)
    .first();
  if (!list) fail(404, "Team list not found");
  return list;
}
async function getTeam(db, id) {
  const row = await db
    .prepare(`SELECT ${TEAM_COLUMNS} FROM teams WHERE id=?`)
    .bind(id)
    .first();
  if (!row) fail(404, "Team not found");
  return toTeam(row);
}
async function displayName(db, username) {
  const row = await db
    .prepare("SELECT display_name FROM admins WHERE username=?")
    .bind(username)
    .first();
  return row?.display_name || username;
}

function insertTeams(db, listId, teams, username, now) {
  return teams.map((t) =>
    db
      .prepare(
        "INSERT INTO teams(id,list_id,team,leader_name,leader_email,members,round,created_at,updated_at,updated_by) VALUES(?,?,?,?,?,?,1,?,?,?)",
      )
      .bind(
        crypto.randomUUID(),
        listId,
        t.team,
        t.leader_name,
        t.leader_email,
        JSON.stringify(t.members),
        now,
        now,
        username,
      ),
  );
}
async function runInChunks(db, statements, size = 400) {
  for (let i = 0; i < statements.length; i += size)
    await db.batch(statements.slice(i, i + size));
}
const touchList = (db, id, now) =>
  db.prepare("UPDATE team_lists SET updated_at=? WHERE id=?").bind(now, id);

// A readable summary of a team edit, for the activity log.
function describeEdit(before, after) {
  const changes = [];
  const detail = {};
  for (const [field, label] of [
    ["team", "team name"],
    ["leader_name", "leader name"],
    ["leader_email", "leader email"],
    ["round", "round"],
  ]) {
    if (String(before[field]) !== String(after[field])) {
      changes.push(`${label} "${before[field]}" to "${after[field]}"`);
      detail[field] = [before[field], after[field]];
    }
  }
  const count = Math.max(before.members.length, after.members.length);
  for (let i = 1; i < count; i++) {
    const a = before.members[i];
    const b = after.members[i];
    if (!a) changes.push(`added member ${i + 1} "${b.name}"`);
    else if (!b) changes.push(`removed member ${i + 1} "${a.name}"`);
    else
      for (const field of MEMBER_FIELDS)
        if ((a[field] || "") !== (b[field] || ""))
          changes.push(
            `member ${i + 1} ${FIELD_LABELS[field]} "${a[field] || ""}" to "${b[field] || ""}"`,
          );
    if (!a || !b || JSON.stringify(a) !== JSON.stringify(b))
      detail[`member_${i + 1}`] = [a || null, b || null];
  }
  for (const field of ["institute", "studentId", "phone"])
    if ((before.members[0]?.[field] || "") !== (after.members[0]?.[field] || ""))
      changes.push(
        `leader ${FIELD_LABELS[field]} "${before.members[0]?.[field] || ""}" to "${after.members[0]?.[field] || ""}"`,
      );
  if (!!before.shared_confirmed !== !!after.shared_confirmed)
    changes.push(
      after.shared_confirmed
        ? "confirmed the duplicate is intended"
        : "cleared the duplicate confirmation",
    );
  return { changes, detail };
}

export async function handleTeams(ctx) {
  const { db, user, role, request, url, method, parts } = ctx;
  const [section, id, action] = parts;
  const now = Date.now();

  if (section === "lists" && !id && method === "GET") {
    const trash = url.searchParams.get("trash") === "1";
    const { results } = await db
      .prepare(
        `SELECT l.id,l.name,l.rounds,l.updated_at,l.archived_at,(SELECT COUNT(*) FROM teams t WHERE t.list_id=l.id AND t.deleted_at IS NULL) AS teams FROM team_lists l WHERE l.archived_at IS ${trash ? "NOT " : ""}NULL ORDER BY l.updated_at DESC LIMIT 200`,
      )
      .all();
    return json(results);
  }
  if (section === "lists" && !id && method === "POST") {
    const b = await body(request);
    const name = inline(b.name).slice(0, 120);
    if (!name) fail(400, "Enter a name for the team list");
    const rounds = Math.round(Number(b.rounds) || 1);
    if (rounds < 1 || rounds > MAX_ROUNDS)
      fail(400, `Choose between 1 and ${MAX_ROUNDS} rounds`);
    const teams = b.csv ? parseTeamSheet(b.csv) : [];
    const listId = crypto.randomUUID();
    await db.batch([
      db
        .prepare(
          "INSERT INTO team_lists(id,name,rounds,created_at,updated_at,created_by) VALUES(?,?,?,?,?,?)",
        )
        .bind(listId, name, rounds, now, now, user),
      activity(db, user, {
        list: listId,
        action: "create_list",
        summary: `Created team list "${name}" with ${teams.length} teams and ${rounds} rounds`,
      }),
    ]);
    await runInChunks(db, insertTeams(db, listId, teams, user, now));
    return json({ id: listId });
  }

  if (section === "lists" && id) {
    const list = await getList(db, id);
    if (!action && method === "GET")
      return json({ ...list, teams: await listTeams(db, id) });
    if (method !== "POST") fail(405, "Method not allowed");
    if (action === "restore") {
      if (role !== "admin") fail(403, "Only main admins can restore team lists");
      await db.batch([
        db
          .prepare("UPDATE team_lists SET archived_at=NULL,updated_at=? WHERE id=?")
          .bind(now, id),
        activity(db, user, {
          list: id,
          action: "restore_list",
          summary: `Restored team list "${list.name}"`,
        }),
      ]);
      return json({ ok: true });
    }
    if (list.archived_at) fail(409, "Restore this team list before changing it");
    const b = await body(request);
    if (action === "settings") {
      const name = inline(b.name).slice(0, 120) || list.name;
      const rounds = Math.round(Number(b.rounds) || list.rounds);
      if (rounds < 1 || rounds > MAX_ROUNDS)
        fail(400, `Choose between 1 and ${MAX_ROUNDS} rounds`);
      const highest = await db
        .prepare(
          "SELECT MAX(round) AS n FROM teams WHERE list_id=? AND deleted_at IS NULL",
        )
        .bind(id)
        .first();
      if ((highest?.n || 1) > rounds)
        fail(409, `Some teams are in Round ${highest.n}. Move them back first.`);
      const changes = [];
      if (name !== list.name) changes.push(`renamed it to "${name}"`);
      if (rounds !== list.rounds)
        changes.push(`changed rounds from ${list.rounds} to ${rounds}`);
      await db.batch([
        db
          .prepare("UPDATE team_lists SET name=?,rounds=?,updated_at=? WHERE id=?")
          .bind(name, rounds, now, id),
        ...(changes.length
          ? [
              activity(db, user, {
                list: id,
                action: "list_settings",
                summary: `Team list "${list.name}": ${changes.join(", ")}`,
              }),
            ]
          : []),
      ]);
      return json({ ok: true });
    }
    if (action === "archive") {
      if (role !== "admin") fail(403, "Only main admins can delete team lists");
      await db.batch([
        db
          .prepare("UPDATE team_lists SET archived_at=?,updated_at=? WHERE id=?")
          .bind(now, now, id),
        activity(db, user, {
          list: id,
          action: "archive_list",
          summary: `Moved team list "${list.name}" to Trash`,
        }),
      ]);
      return json({ ok: true });
    }
    // Adding teams from a sheet never replaces anything. Existing teams are skipped.
    if (action === "preview" || action === "add") {
      const current = (await listTeams(db, id)).filter((t) => !t.deleted_at);
      const emails = new Set(current.map((t) => t.leader_email).filter(Boolean));
      const names = new Set(current.map((t) => key(t.team)).filter(Boolean));
      const incoming =
        action === "preview"
          ? parseTeamSheet(b.csv)
          : (Array.isArray(b.teams) ? b.teams : []).map(normalizeTeam);
      if (incoming.length > MAX_TEAMS) fail(400, "Too many teams");
      const result = incoming.map((t) => {
        const exists =
          (t.leader_email && emails.has(t.leader_email)) ||
          (t.team && names.has(key(t.team)));
        if (!exists) {
          if (t.leader_email) emails.add(t.leader_email);
          if (t.team) names.add(key(t.team));
        }
        return { ...t, status: exists ? "existing" : "new" };
      });
      if (action === "preview") return json({ teams: result });
      const fresh = result.filter((t) => t.status === "new");
      await runInChunks(db, [
        ...insertTeams(db, id, fresh, user, now),
        touchList(db, id, now),
        activity(db, user, {
          list: id,
          action: "add_teams",
          summary: `Added ${fresh.length} teams to "${list.name}" from a sheet${result.length > fresh.length ? ` and skipped ${result.length - fresh.length} that already existed` : ""}`,
        }),
      ]);
      return json({ added: fresh.length, skipped: result.length - fresh.length });
    }
    if (action === "team") {
      const t = normalizeTeam(b);
      const teamId = crypto.randomUUID();
      await db.batch([
        db
          .prepare(
            "INSERT INTO teams(id,list_id,team,leader_name,leader_email,members,round,created_at,updated_at,updated_by) VALUES(?,?,?,?,?,?,1,?,?,?)",
          )
          .bind(
            teamId,
            id,
            t.team,
            t.leader_name,
            t.leader_email,
            JSON.stringify(t.members),
            now,
            now,
            user,
          ),
        touchList(db, id, now),
        activity(db, user, {
          list: id,
          team: teamId,
          action: "add_team",
          summary: `Added team "${t.team || "Unnamed team"}"`,
        }),
      ]);
      return json({ id: teamId, teams: await listTeams(db, id) });
    }
    // Match pasted results by team name or leader email, one per line.
    if (action === "match") {
      const teams = (await listTeams(db, id)).filter((t) => !t.deleted_at);
      const lines = String(b.text || "")
        .split(/\r?\n/)
        .map(inline)
        .filter(Boolean)
        .slice(0, MAX_TEAMS);
      const results = lines.map((line) => {
        const email = line.toLowerCase();
        const found = validEmail(email)
          ? teams.filter((t) => t.leader_email === email)
          : teams.filter((t) => key(t.team) === key(line));
        return {
          line,
          status: found.length === 1 ? "match" : found.length ? "ambiguous" : "missing",
          candidates: found.map((t) => ({
            id: t.id,
            team: t.team,
            leader_name: t.leader_name,
            leader_email: t.leader_email,
            round: t.round,
          })),
        };
      });
      return json({ results });
    }
    if (action === "round") {
      const round = Math.round(Number(b.round));
      if (!(round >= 1 && round <= list.rounds))
        fail(400, `Choose a round between 1 and ${list.rounds}`);
      const ids = [...new Set((Array.isArray(b.teamIds) ? b.teamIds : []).map(clean))]
        .filter(Boolean)
        .slice(0, MAX_TEAMS);
      if (!ids.length) fail(400, "Select at least one team");
      const teams = (await listTeams(db, id)).filter(
        (t) => !t.deleted_at && ids.includes(t.id),
      );
      const moving = teams.filter((t) => t.round !== round);
      const statements = [];
      for (let i = 0; i < moving.length; i += 90) {
        const chunk = moving.slice(i, i + 90);
        statements.push(
          db
            .prepare(
              `UPDATE teams SET round=?,version=version+1,updated_at=?,updated_by=? WHERE list_id=? AND id IN (${chunk.map(() => "?").join(",")})`,
            )
            .bind(round, now, user, id, ...chunk.map((t) => t.id)),
        );
      }
      if (moving.length)
        statements.push(
          touchList(db, id, now),
          activity(db, user, {
            list: id,
            action: "move_round",
            summary: `Moved ${moving.length} team${moving.length === 1 ? "" : "s"} to Round ${round}: ${moving
              .slice(0, 12)
              .map((t) => `"${t.team}"`)
              .join(", ")}${moving.length > 12 ? ` and ${moving.length - 12} more` : ""}`,
            detail: moving.map((t) => ({ id: t.id, team: t.team, from: t.round, to: round })),
          }),
        );
      await runInChunks(db, statements);
      return json({ moved: moving.length, teams: await listTeams(db, id) });
    }
    fail(404, "Unknown action");
  }

  if (section === "teams" && id && method === "POST") {
    const current = await getTeam(db, id);
    const list = await getList(db, current.list_id);
    if (list.archived_at) fail(409, "Restore this team list before changing it");
    const b = await body(request);
    if (action === "delete" || action === "restore") {
      const deleting = action === "delete";
      await db.batch([
        db
          .prepare(
            "UPDATE teams SET deleted_at=?,version=version+1,updated_at=?,updated_by=? WHERE id=?",
          )
          .bind(deleting ? now : null, now, user, id),
        touchList(db, list.id, now),
        activity(db, user, {
          list: list.id,
          team: id,
          action: deleting ? "delete_team" : "restore_team",
          summary: `${deleting ? "Deleted" : "Restored"} team "${current.team || "Unnamed team"}"`,
        }),
      ]);
      return json({ teams: await listTeams(db, list.id) });
    }
    if (action) fail(404, "Unknown action");
    if (current.deleted_at) fail(409, "Restore this team before editing it");
    if (Number(b.version) !== current.version)
      fail(
        409,
        `${await displayName(db, current.updated_by)} changed this team a moment ago. Reload this team to see their change.`,
        { team: withIssues([current])[0] },
      );
    const confirm = b.shared_confirmed ? 1 : 0;
    const next = {
      ...normalizeTeam(b),
      round: Math.round(Number(b.round ?? current.round)),
      shared_confirmed: confirm,
    };
    if (!(next.round >= 1 && next.round <= list.rounds))
      fail(400, `Choose a round between 1 and ${list.rounds}`);
    // Changing the leader email clears an earlier duplicate confirmation.
    if (
      next.leader_email !== current.leader_email &&
      current.shared_confirmed &&
      confirm
    )
      next.shared_confirmed = 0;
    const { changes, detail } = describeEdit(current, next);
    if (!changes.length) return json({ team: current, teams: null });
    const result = await db
      .prepare(
        "UPDATE teams SET team=?,leader_name=?,leader_email=?,members=?,round=?,shared_confirmed=?,version=version+1,updated_at=?,updated_by=? WHERE id=? AND version=?",
      )
      .bind(
        next.team,
        next.leader_name,
        next.leader_email,
        JSON.stringify(next.members),
        next.round,
        next.shared_confirmed,
        now,
        user,
        id,
        current.version,
      )
      .run();
    if (!result.meta.changes)
      fail(409, "Someone else changed this team a moment ago. Reload this team.");
    await db.batch([
      touchList(db, list.id, now),
      activity(db, user, {
        list: list.id,
        team: id,
        action: "edit_team",
        summary: `Edited "${next.team || current.team || "Unnamed team"}": ${changes.join("; ")}`,
        detail,
      }),
    ]);
    const teams = await listTeams(db, list.id);
    return json({ team: teams.find((t) => t.id === id), teams });
  }

  if (section === "activity" && method === "GET") {
    if (role !== "admin") fail(403, "Only main admins can see the activity log");
    const filters = [];
    const args = [];
    if (url.searchParams.get("list")) {
      filters.push("a.list_id=?");
      args.push(url.searchParams.get("list"));
    }
    if (url.searchParams.get("user")) {
      filters.push("a.username=?");
      args.push(url.searchParams.get("user"));
    }
    if (Number(url.searchParams.get("before"))) {
      filters.push("a.id<?");
      args.push(Number(url.searchParams.get("before")));
    }
    const { results } = await db
      .prepare(
        `SELECT a.id,a.at,a.username,a.list_id,a.team_id,a.campaign_id,a.action,a.summary,COALESCE(m.display_name,a.username) AS name,COALESCE(m.role,'admin') AS role FROM activity a LEFT JOIN admins m ON m.username=a.username ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""} ORDER BY a.id DESC LIMIT 100`,
      )
      .bind(...args)
      .all();
    const { results: people } = await db
      .prepare(
        "SELECT username,COALESCE(display_name,username) AS name,role FROM admins ORDER BY role,name",
      )
      .all();
    return json({ items: results, people });
  }
  fail(404, "Unknown request");
}
