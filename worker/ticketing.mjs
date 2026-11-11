import {
  attendeesFromCsv, cleanAttendee, createToken, normalizeToken, randomHex, sha256Hex, verifyPassword,
} from './ticketing-shared.mjs';

export const API_PREFIX = '/api/tm/';
const EVENT_ID = 1;
const SESSION_COOKIE = 'tm_session';
const SESSION_HOURS = 24;
const MAX_FAILURES = 8;
const FAILURE_WINDOW = 15 * 60 * 1000;
const IMPORT_CHUNK = 500;
// Compared against when a username does not exist, so timing does not reveal it.
const DUMMY_HASH = 'pbkdf2_sha256$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const ATTENDEE_COLUMNS = 'id, token, name, student_id, email, source, created_at, checked_in_at, checked_in_by';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
      ...headers,
    },
  });
}

function toAttendee(row) {
  return {
    id: row.id,
    token: row.token,
    name: row.name,
    studentId: row.student_id,
    email: row.email,
    source: row.source,
    createdAt: row.created_at,
    checkedInAt: row.checked_in_at,
    checkedInBy: row.checked_in_by,
  };
}

function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return null;
}

function sessionCookie(request, value, maxAge) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${value}; Path=/api/tm; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

async function readJson(request) {
  if (!(request.headers.get('content-type') || '').includes('application/json')) {
    throw new HttpError(415, 'Send JSON');
  }
  try { return await request.json(); } catch { throw new HttpError(400, 'Invalid JSON'); }
}

async function currentUser(request, env) {
  const id = readCookie(request, SESSION_COOKIE);
  if (!id || !/^[0-9a-f]{64}$/.test(id)) return null;
  const row = await env.DB.prepare('SELECT username FROM sessions WHERE id = ? AND expires_at > ?')
    .bind(await sha256Hex(id), Date.now()).first();
  return row?.username ?? null;
}

async function getEvent(env) {
  const event = await env.DB.prepare('SELECT id, name, updated_at FROM events WHERE id = ?').bind(EVENT_ID).first();
  return event ? { id: event.id, name: event.name, updatedAt: event.updated_at } : { id: EVENT_ID, name: 'MIBC Event', updatedAt: 0 };
}

async function login(request, env, ctx) {
  const body = await readJson(request);
  const username = String(body.username ?? '').trim().toLowerCase().slice(0, 64);
  const password = String(body.password ?? '').slice(0, 256);
  if (!username || !password) throw new HttpError(400, 'Enter your ID and password');

  const now = Date.now();
  const failures = await env.DB.prepare('SELECT COUNT(*) AS count FROM login_failures WHERE username = ? AND failed_at > ?')
    .bind(username, now - FAILURE_WINDOW).first();
  if ((failures?.count ?? 0) >= MAX_FAILURES) throw new HttpError(429, 'Too many attempts. Wait 15 minutes and try again.');

  const organizer = await env.DB.prepare('SELECT password_hash FROM organizers WHERE username = ?').bind(username).first();
  const valid = await verifyPassword(password, organizer?.password_hash ?? DUMMY_HASH);
  if (!organizer || !valid) {
    ctx.waitUntil(env.DB.batch([
      env.DB.prepare('INSERT INTO login_failures (username, failed_at) VALUES (?, ?)').bind(username, now),
      env.DB.prepare('DELETE FROM login_failures WHERE failed_at < ?').bind(now - 24 * 3600 * 1000),
    ]));
    throw new HttpError(401, 'Wrong ID or password');
  }

  const sessionId = randomHex(32);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO sessions (id, username, expires_at) VALUES (?, ?, ?)')
      .bind(await sha256Hex(sessionId), username, now + SESSION_HOURS * 3600 * 1000),
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
    env.DB.prepare('DELETE FROM login_failures WHERE username = ?').bind(username),
  ]);
  return json({ username, event: await getEvent(env) }, 200, {
    'set-cookie': sessionCookie(request, sessionId, SESSION_HOURS * 3600),
  });
}

async function logout(request, env) {
  const id = readCookie(request, SESSION_COOKIE);
  if (id && /^[0-9a-f]{64}$/.test(id)) {
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256Hex(id)).run();
  }
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie(request, '', 0) });
}

async function bootstrap(env, username) {
  const [event, attendees] = await Promise.all([
    getEvent(env),
    env.DB.prepare(`SELECT ${ATTENDEE_COLUMNS} FROM attendees WHERE event_id = ? ORDER BY name COLLATE NOCASE`).bind(EVENT_ID).all(),
  ]);
  return json({ username, event, attendees: attendees.results.map(toAttendee), serverTime: Date.now() });
}

async function checkIn(request, env, ctx, username) {
  const body = await readJson(request);
  const token = normalizeToken(body.token);
  const now = Date.now();
  // Offline scans are queued on the phone; keep their real time if it is plausible.
  const claimed = Number(body.scannedAt);
  const at = Number.isFinite(claimed) && claimed <= now + 60_000 && claimed > now - 24 * 3600 * 1000 ? Math.round(claimed) : now;

  if (!token) {
    ctx.waitUntil(env.DB.prepare('INSERT INTO scans (event_id, token, result, scanned_by, scanned_at) VALUES (?, ?, ?, ?, ?)')
      .bind(EVENT_ID, String(body.token ?? '').slice(0, 64), 'invalid', username, at).run());
    return json({ result: 'not_found' });
  }

  const [update, select] = await env.DB.batch([
    env.DB.prepare('UPDATE attendees SET checked_in_at = ?, checked_in_by = ? WHERE token = ? AND event_id = ? AND checked_in_at IS NULL')
      .bind(at, username, token, EVENT_ID),
    env.DB.prepare(`SELECT ${ATTENDEE_COLUMNS} FROM attendees WHERE token = ? AND event_id = ?`).bind(token, EVENT_ID),
  ]);
  const row = select.results[0];
  const result = !row ? 'not_found' : update.meta.changes === 1 ? 'checked_in' : 'already';
  ctx.waitUntil(env.DB.prepare('INSERT INTO scans (event_id, attendee_id, token, result, scanned_by, scanned_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(EVENT_ID, row?.id ?? null, token, result, username, at).run());
  return json({ result, attendee: row ? toAttendee(row) : null });
}

async function updateEvent(request, env) {
  const body = await readJson(request);
  const name = String(body.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!name) throw new HttpError(400, 'Event name is required');
  await env.DB.prepare('UPDATE events SET name = ?, updated_at = ? WHERE id = ?').bind(name, Date.now(), EVENT_ID).run();
  return json({ event: await getEvent(env) });
}

async function insertAttendees(env, attendees, source) {
  const added = [];
  const now = Date.now();
  for (let start = 0; start < attendees.length; start += IMPORT_CHUNK) {
    const chunk = attendees.slice(start, start + IMPORT_CHUNK).map(attendee => ({ ...attendee, token: createToken() }));
    // One statement per chunk keeps large imports inside D1's per request query limit.
    const result = await env.DB.prepare(`INSERT OR IGNORE INTO attendees (event_id, token, name, student_id, email, source, created_at)
      SELECT ?, json_extract(value, '$.token'), json_extract(value, '$.name'), json_extract(value, '$.studentId'),
        json_extract(value, '$.email'), ?, ? FROM json_each(?) RETURNING ${ATTENDEE_COLUMNS}`)
      .bind(EVENT_ID, source, now, JSON.stringify(chunk)).all();
    added.push(...result.results.map(toAttendee));
  }
  return added;
}

async function addAttendee(request, env) {
  const body = await readJson(request);
  const { attendee, error } = cleanAttendee(body);
  if (error) throw new HttpError(400, error);
  const [added] = await insertAttendees(env, [attendee], 'manual');
  if (!added) throw new HttpError(409, `Student ID ${attendee.studentId} is already registered`);
  return json({ attendee: added }, 201);
}

async function importAttendees(request, env) {
  const body = await readJson(request);
  let attendees = [];
  let invalid = [];
  if (typeof body.csv === 'string') {
    const parsed = attendeesFromCsv(body.csv);
    if (parsed.error) throw new HttpError(400, parsed.error);
    ({ attendees, invalid } = parsed);
  } else if (Array.isArray(body.rows)) {
    body.rows.forEach((row, index) => {
      const { attendee, error } = cleanAttendee(row);
      if (error) invalid.push({ line: index + 1, reason: error });
      else attendees.push(attendee);
    });
  } else throw new HttpError(400, 'Send csv text or rows');
  if (attendees.length > 20000) throw new HttpError(413, 'Import at most 20,000 people at a time');

  // Drop repeated student IDs inside the same file before inserting.
  const seen = new Set();
  const unique = attendees.filter(attendee => {
    if (!attendee.studentId) return true;
    if (seen.has(attendee.studentId)) return false;
    seen.add(attendee.studentId);
    return true;
  });
  const added = await insertAttendees(env, unique, body.source === 'sheet' ? 'sheet' : 'csv');
  return json({ added, duplicates: attendees.length - added.length, invalid });
}

async function setAttendance(request, env, id, username) {
  const body = await readJson(request);
  const statement = body.present
    ? env.DB.prepare(`UPDATE attendees SET checked_in_at = COALESCE(checked_in_at, ?), checked_in_by = COALESCE(checked_in_by, ?)
        WHERE id = ? AND event_id = ? RETURNING ${ATTENDEE_COLUMNS}`).bind(Date.now(), username, id, EVENT_ID)
    : env.DB.prepare(`UPDATE attendees SET checked_in_at = NULL, checked_in_by = NULL
        WHERE id = ? AND event_id = ? RETURNING ${ATTENDEE_COLUMNS}`).bind(id, EVENT_ID);
  const row = await statement.first();
  if (!row) throw new HttpError(404, 'Attendee not found');
  return json({ attendee: toAttendee(row) });
}

async function deleteAttendee(env, id) {
  const result = await env.DB.prepare('DELETE FROM attendees WHERE id = ? AND event_id = ?').bind(id, EVENT_ID).run();
  if (!result.meta.changes) throw new HttpError(404, 'Attendee not found');
  return json({ ok: true });
}

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.slice(API_PREFIX.length).replace(/\/$/, '');
  const method = request.method;

  if (method !== 'GET' && method !== 'HEAD') {
    // SameSite cookies already block cross site posts; this also rejects other origins outright.
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) throw new HttpError(403, 'Cross origin request blocked');
  }

  if (path === 'login' && method === 'POST') return login(request, env, ctx);
  if (path === 'logout' && method === 'POST') return logout(request, env);

  const username = await currentUser(request, env);
  if (!username) throw new HttpError(401, 'Please log in');

  if (path === 'bootstrap' && method === 'GET') return bootstrap(env, username);
  if (path === 'checkin' && method === 'POST') return checkIn(request, env, ctx, username);
  if (path === 'event' && method === 'PATCH') return updateEvent(request, env);
  if (path === 'attendees' && method === 'POST') return addAttendee(request, env);
  if (path === 'attendees/import' && method === 'POST') return importAttendees(request, env);

  const match = path.match(/^attendees\/(\d+)(\/attendance)?$/);
  if (match && match[2] && method === 'POST') return setAttendance(request, env, Number(match[1]), username);
  if (match && !match[2] && method === 'DELETE') return deleteAttendee(env, Number(match[1]));

  throw new HttpError(404, 'Not found');
}

export async function handleTicketApi(request, env, ctx) {
  try {
    if (!env.DB) throw new HttpError(503, 'Ticket database is not connected');
    return await route(request, env, ctx);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    console.error('Ticket API error', error);
    return json({ error: 'Something went wrong. Try again.' }, 500);
  }
}

// The organizer page needs camera access, which the public site denies.
export async function serveTicketPage(request, env) {
  const response = await env.ASSETS.fetch(request);
  const headers = new Headers(response.headers);
  headers.set('permissions-policy', 'camera=(self), microphone=(), geolocation=()');
  headers.set('x-robots-tag', 'noindex, nofollow');
  headers.set('referrer-policy', 'no-referrer');
  headers.set('cache-control', 'no-cache');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
