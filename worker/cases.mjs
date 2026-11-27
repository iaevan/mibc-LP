// Case PDFs shared with competition participants.
// Organizers upload from /casemanagement using their ticket desk login. Each case
// gets an unguessable link at /case/<slug>/. Details live in D1 and the PDF bytes
// in the TICKET_IMAGES KV namespace under a "case-file:" prefix, so no new
// Cloudflare resources are needed.
import { createToken } from './ticketing-shared.mjs';

export const PUBLIC_CASE_API = '/api/cases/';
export const MAX_CASE_BYTES = 25 * 1024 * 1024; // KV values are capped at 25 MiB.
const SLUG_PATTERN = /^[2-9a-hj-np-z]{12}$/;
const fileKey = slug => `case-file:${slug}`;
const COLUMNS = 'id, slug, title, description, file_name, size, allow_download, published, views, downloads, created_at, updated_at, created_by';

export class CaseError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', ...headers },
  });
}

let schemaReady = false;
// The table is also in migrations/0004_cases.sql. Creating it here as well means
// the feature works the first time it is deployed, before anyone runs migrations.
async function ensureSchema(env) {
  if (schemaReady) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT,
      file_name TEXT NOT NULL,
      size INTEGER NOT NULL,
      allow_download INTEGER NOT NULL DEFAULT 1,
      published INTEGER NOT NULL DEFAULT 1,
      views INTEGER NOT NULL DEFAULT 0,
      downloads INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      created_by TEXT
    )`),
  ]);
  schemaReady = true;
}

function toCase(row) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description ?? '',
    fileName: row.file_name,
    size: row.size,
    allowDownload: Boolean(row.allow_download),
    published: Boolean(row.published),
    views: row.views,
    downloads: row.downloads,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
  };
}

function cleanText(value, max) {
  return String(value ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
}

function cleanFileName(value) {
  const name = String(value ?? '').split(/[\\/]/).pop().replace(/[^\w .()-]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const base = name || 'case';
  return /\.pdf$/i.test(base) ? base : `${base}.pdf`;
}

async function readPdf(file) {
  if (!file || typeof file === 'string') throw new CaseError(400, 'Choose a PDF file');
  if (file.size > MAX_CASE_BYTES) throw new CaseError(413, 'The PDF must be 25 MB or smaller');
  const bytes = await file.arrayBuffer();
  // A real PDF starts with its %PDF- header (a few tools put a few bytes before it).
  const head = new TextDecoder('latin1').decode(new Uint8Array(bytes, 0, Math.min(32, bytes.byteLength)));
  const start = head.indexOf('%PDF-');
  if (bytes.byteLength < 64 || start < 0 || start > 8) throw new CaseError(400, 'That file is not a PDF');
  return bytes;
}

async function readForm(request) {
  if (!(request.headers.get('content-type') || '').includes('multipart/form-data')) throw new CaseError(415, 'Send the case as a form upload');
  try { return await request.formData(); } catch { throw new CaseError(400, 'The upload could not be read. Try again.'); }
}

function flag(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  return value === true || value === 'true' || value === '1' || value === 'on' || value === 1;
}

async function findCase(env, id) {
  const row = await env.DB.prepare(`SELECT ${COLUMNS} FROM cases WHERE id = ?`).bind(id).first();
  if (!row) throw new CaseError(404, 'Case not found');
  return row;
}

// Organizer endpoints, reached through /api/tm/cases so the ticket desk session cookie applies.
export async function handleCaseAdminApi(request, env, path, username) {
  if (!env.TICKET_IMAGES) throw new CaseError(503, 'File storage is not connected');
  await ensureSchema(env);
  const method = request.method;

  if (path === 'cases' && method === 'GET') {
    const { results } = await env.DB.prepare(`SELECT ${COLUMNS} FROM cases ORDER BY created_at DESC`).all();
    return json({ username, cases: results.map(toCase), maxBytes: MAX_CASE_BYTES });
  }

  if (path === 'cases' && method === 'POST') {
    const form = await readForm(request);
    const title = cleanText(form.get('title'), 140);
    if (!title) throw new CaseError(400, 'Give the case a title');
    const file = form.get('file');
    const bytes = await readPdf(file);
    const slug = createToken().toLowerCase();
    const now = Date.now();
    await env.TICKET_IMAGES.put(fileKey(slug), bytes);
    const row = await env.DB.prepare(`INSERT INTO cases (slug, title, description, file_name, size, allow_download, published, created_at, updated_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING ${COLUMNS}`)
      .bind(slug, title, cleanText(form.get('description'), 2000) || null, cleanFileName(file.name), bytes.byteLength,
        flag(form.get('allowDownload'), true) ? 1 : 0, flag(form.get('published'), true) ? 1 : 0, now, now, username)
      .first();
    return json({ case: toCase(row) }, 201);
  }

  const match = path.match(/^cases\/(\d+)(\/file)?$/);
  if (!match) return null;
  const id = Number(match[1]);

  if (match[2] === '/file' && method === 'POST') {
    const current = await findCase(env, id);
    const form = await readForm(request);
    const file = form.get('file');
    const bytes = await readPdf(file);
    await env.TICKET_IMAGES.put(fileKey(current.slug), bytes);
    const row = await env.DB.prepare(`UPDATE cases SET file_name = ?, size = ?, updated_at = ? WHERE id = ? RETURNING ${COLUMNS}`)
      .bind(cleanFileName(file.name), bytes.byteLength, Date.now(), id).first();
    return json({ case: toCase(row) });
  }

  if (!match[2] && method === 'PATCH') {
    const current = await findCase(env, id);
    let body;
    try { body = await request.json(); } catch { throw new CaseError(400, 'Invalid JSON'); }
    const title = body.title === undefined ? current.title : cleanText(body.title, 140);
    if (!title) throw new CaseError(400, 'Give the case a title');
    const description = body.description === undefined ? current.description : cleanText(body.description, 2000) || null;
    const allow = body.allowDownload === undefined ? current.allow_download : body.allowDownload ? 1 : 0;
    const published = body.published === undefined ? current.published : body.published ? 1 : 0;
    const row = await env.DB.prepare(`UPDATE cases SET title = ?, description = ?, allow_download = ?, published = ?, updated_at = ? WHERE id = ? RETURNING ${COLUMNS}`)
      .bind(title, description, allow, published, Date.now(), id).first();
    return json({ case: toCase(row) });
  }

  if (!match[2] && method === 'DELETE') {
    const current = await findCase(env, id);
    await env.TICKET_IMAGES.delete(fileKey(current.slug));
    await env.DB.prepare('DELETE FROM cases WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }

  return null;
}

async function publicRoute(request, env, ctx) {
  const url = new URL(request.url);
  if (!['GET', 'HEAD'].includes(request.method)) throw new CaseError(405, 'Method not allowed');
  const match = url.pathname.slice(PUBLIC_CASE_API.length).replace(/\/$/, '').match(/^([^/]+)(\/file)?$/);
  const slug = match?.[1]?.toLowerCase();
  if (!slug || !SLUG_PATTERN.test(slug)) throw new CaseError(404, 'This case link is not valid');
  await ensureSchema(env);
  const row = await env.DB.prepare(`SELECT ${COLUMNS} FROM cases WHERE slug = ? AND published = 1`).bind(slug).first();
  if (!row) throw new CaseError(404, 'This case is not available. Check the link with the organizers.');

  if (!match[2]) {
    ctx.waitUntil(countView(env, row.id));
    return json({ case: publicFields(row) });
  }

  const download = url.searchParams.has('download');
  if (download && !row.allow_download) throw new CaseError(403, 'Downloads are turned off for this case');
  const body = request.method === 'HEAD' ? null : await caseBytes(env, ctx, url, row);
  if (download) ctx.waitUntil(env.DB.prepare('UPDATE cases SET downloads = downloads + 1 WHERE id = ?').bind(row.id).run());
  const name = row.file_name.replace(/"/g, '');
  // The viewer asks for ?v=<updated time>. That exact version never changes, so
  // browsers keep it; a replaced PDF gets a new version and a new URL.
  const current = url.searchParams.get('v') === String(row.updated_at);
  return new Response(body, {
    headers: {
      'content-type': 'application/pdf',
      'content-length': String(row.size),
      'content-disposition': `${download ? 'attachment' : 'inline'}; filename="${name}"`,
      'cache-control': current && !download ? 'private, max-age=31536000, immutable' : 'private, no-cache',
      'x-robots-tag': 'noindex, nofollow',
      'x-content-type-options': 'nosniff',
    },
  });
}

function publicFields(row) {
  const item = toCase(row);
  return { slug: item.slug, title: item.title, description: item.description, fileName: item.fileName, size: item.size, allowDownload: item.allowDownload, updatedAt: item.updatedAt };
}

function countView(env, id) {
  return env.DB.prepare('UPDATE cases SET views = views + 1 WHERE id = ?').bind(id).run();
}

// PDF bytes come from Cloudflare's edge cache when this data center has served
// them before, which is much faster than reading KV. The cache key includes the
// version, so replacing a PDF never serves the old file. Visibility is still
// checked in D1 before every response.
async function caseBytes(env, ctx, url, row) {
  const cache = typeof caches === 'undefined' ? null : caches.default;
  const key = new Request(`${url.origin}/__case-file-cache/${row.slug}/${row.updated_at}`);
  const hit = cache ? await cache.match(key).catch(() => null) : null;
  if (hit) return hit.body;
  const bytes = await env.TICKET_IMAGES.get(fileKey(row.slug), { type: 'arrayBuffer', cacheTtl: 300 });
  if (!bytes) throw new CaseError(404, 'The case file is missing. Tell the organizers.');
  if (cache) {
    ctx.waitUntil(cache.put(key, new Response(bytes, {
      headers: { 'content-type': 'application/pdf', 'cache-control': 'public, max-age=2592000' },
    })).catch(() => undefined));
  }
  return bytes;
}

function escapeAttribute(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// Puts the case details into the page and asks the browser to fetch the PDF and
// the PDF.js code straight away, in parallel, instead of one after another.
async function caseHead(request, env, ctx) {
  const slug = new URL(request.url).pathname.match(/^\/case\/([^/]+)/)?.[1]?.toLowerCase();
  if (!slug || !SLUG_PATTERN.test(slug) || !env.DB) return { data: { error: 'This case link is not valid' }, tags: '' };
  try {
    await ensureSchema(env);
    const row = await env.DB.prepare(`SELECT ${COLUMNS} FROM cases WHERE slug = ? AND published = 1`).bind(slug).first();
    if (!row) return { data: { error: 'This case is not available. Check the link with the organizers.' }, tags: '' };
    ctx.waitUntil(countView(env, row.id));
    const file = `/api/cases/${row.slug}/file?v=${row.updated_at}`;
    return {
      data: { case: publicFields(row) },
      tags: `<link rel="preload" href="${escapeAttribute(file)}" as="fetch" crossorigin="anonymous" fetchpriority="high">`
        // Keep this path in step with PDFJS_BASE in components/cases/pdf-viewer.tsx.
        + '<link rel="modulepreload" href="/pdfjs/6.5.438/pdf.min.mjs">',
    };
  } catch (error) {
    console.error('Case page lookup failed', error);
    return null; // The page falls back to asking the API.
  }
}

export async function serveCasePage(request, env, pathname, ctx) {
  const target = new URL(pathname, request.url);
  const response = await env.ASSETS.fetch(new Request(target, { method: 'GET', headers: request.headers }));
  const headers = new Headers(response.headers);
  headers.set('x-robots-tag', 'noindex, nofollow');
  headers.set('referrer-policy', 'no-referrer');
  headers.set('cache-control', 'no-cache');
  headers.delete('etag');
  headers.delete('content-length');
  const head = pathname === '/case/' && response.ok && ctx ? await caseHead(request, env, ctx) : null;
  if (!head) return new Response(response.body, { status: response.status, headers });
  const json = JSON.stringify(head.data).replace(/</g, '\\u003c');
  const title = head.data.case ? `${head.data.case.title} | NSU MIBC` : null;
  return new HTMLRewriter()
    .on('head', { element(element) { element.prepend(`${head.tags}<script id="case-data" type="application/json">${json}</script>`, { html: true }); } })
    .on('title', { element(element) { if (title) element.setInnerContent(title); } })
    .transform(new Response(response.body, { status: response.status, headers }));
}

export async function handlePublicCaseApi(request, env, ctx) {
  try {
    if (!env.DB || !env.TICKET_IMAGES) throw new CaseError(503, 'Case storage is not connected');
    return await publicRoute(request, env, ctx);
  } catch (error) {
    if (error instanceof CaseError) return json({ error: error.message }, error.status);
    console.error('Case API error', error);
    return json({ error: 'Something went wrong. Try again.' }, 500);
  }
}
