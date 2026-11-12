#!/usr/bin/env node
// Ticket tools for organizers. Everything this writes goes to tickets/, which
// is gitignored because it holds attendee details, QR codes and the template.
//
//   npm run tickets -- import <file.csv> [--test] [--remote]
//   npm run tickets -- render [--remote] [--template tickets/template.webp]
//   npm run tickets -- upload [--remote]
//   npm run tickets -- upload-template [--remote]
//   npm run tickets -- organizer <id> [--password <password>] [--remote]
//
// Without --remote the commands use the local development database.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { encode } from 'uqr';
import { attendeesFromCsv, createToken, hashPassword } from '../worker/ticketing-shared.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ticketsDir = path.join(root, 'tickets');
const DATABASE = 'mibc-tickets';
const EVENT_ID = 1;

const args = process.argv.slice(2);
const command = args[0];
const remote = args.includes('--remote');
const option = name => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const positional = args.slice(1).filter((arg, index, list) => !arg.startsWith('--') && !list[index - 1]?.startsWith('--'));

function wrangler(extra) {
  return execFileSync('npx', ['wrangler', 'd1', 'execute', DATABASE, remote ? '--remote' : '--local', '--yes', ...extra], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
  });
}

function query(sql) {
  const output = wrangler(['--json', '--command', sql]);
  const parsed = JSON.parse(output.slice(output.indexOf('[')));
  return parsed[0]?.results ?? [];
}

const sqlText = value => (value == null || value === '' ? 'NULL' : `'${String(value).replace(/'/g, "''")}'`);

async function runSql(statements) {
  await mkdir(ticketsDir, { recursive: true });
  const file = path.join(ticketsDir, '.pending.sql');
  await writeFile(file, statements.join('\n'));
  try { wrangler(['--file', file]); } finally { await rm(file, { force: true }); }
}

async function importCsv() {
  const file = positional[0];
  if (!file) throw new Error('Give the CSV path: npm run tickets -- import <file.csv>');
  const { attendees, invalid, error } = attendeesFromCsv(await readFile(file, 'utf8'));
  if (error) throw new Error(error);
  const before = query(`SELECT COUNT(*) AS count FROM attendees WHERE event_id = ${EVENT_ID}`)[0]?.count ?? 0;
  const now = Date.now();
  // Test users get their ticket email first and can be deleted together from the Mail tab.
  const source = args.includes('--test') ? 'test' : 'csv';
  const statements = [];
  for (let start = 0; start < attendees.length; start += 200) {
    const values = attendees.slice(start, start + 200).map(attendee => `(${EVENT_ID}, '${createToken()}', ${sqlText(attendee.name)}, ${sqlText(attendee.studentId)}, ${sqlText(attendee.email)}, '${source}', ${now})`);
    statements.push(`INSERT OR IGNORE INTO attendees (event_id, token, name, student_id, email, source, created_at) VALUES\n${values.join(',\n')};`);
  }
  if (statements.length) await runSql(statements);
  const after = query(`SELECT COUNT(*) AS count FROM attendees WHERE event_id = ${EVENT_ID}`)[0]?.count ?? 0;
  console.log(`${remote ? 'Remote' : 'Local'} database: added ${after - before}, skipped ${attendees.length - (after - before)} already registered.`);
  invalid.forEach(item => console.warn(`Skipped line ${item.line}: ${item.reason}`));
}

async function findTemplate() {
  const given = option('--template');
  if (given) return path.resolve(given);
  for (const name of ['template.png', 'template.jpg', 'template.jpeg', 'template.webp']) {
    const candidate = path.join(ticketsDir, name);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('Put the banner template at tickets/template.png (or .jpg/.webp), or pass --template <file>.');
}

// Finds the white square frame on the right side of the banner by its long
// straight white edges, so nearby headline text does not confuse it.
async function findQrBox(template) {
  const { data, info } = await template.clone().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const white = (x, y) => {
    const offset = (y * info.width + x) * info.channels;
    return data[offset] > 215 && data[offset + 1] > 215 && data[offset + 2] > 215;
  };
  const startX = Math.floor(info.width * 0.5);
  const columns = [];
  for (let x = startX; x < info.width; x += 1) {
    let count = 0;
    for (let y = 0; y < info.height; y += 1) if (white(x, y)) count += 1;
    if (count > info.height * 0.3) columns.push(x);
  }
  if (columns.length < 2) throw new Error('Could not find the white QR square on the right side of the template.');
  const left = columns[0];
  const right = columns[columns.length - 1];
  const rows = [];
  for (let y = 0; y < info.height; y += 1) {
    let count = 0;
    for (let x = left; x <= right; x += 1) if (white(x, y)) count += 1;
    if (count > (right - left) * 0.8) rows.push(y);
  }
  if (rows.length < 2) throw new Error('Could not find the top and bottom of the white QR square.');
  const top = rows[0];
  const bottom = rows[rows.length - 1];
  const width = right - left + 1;
  const height = bottom - top + 1;
  if (Math.abs(width - height) > width * 0.1) throw new Error(`The QR area is not square (${width} x ${height}px).`);
  return { left, top, width, height, imageWidth: info.width, imageHeight: info.height };
}

function qrSvg(token, size) {
  const matrix = encode(token, { ecc: 'Q' }).data;
  const quiet = 2;
  const cells = matrix.length + quiet * 2;
  const rects = [];
  matrix.forEach((row, y) => row.forEach((dark, x) => { if (dark) rects.push(`<rect x="${x + quiet}" y="${y + quiet}" width="1" height="1"/>`); }));
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${cells} ${cells}" shape-rendering="crispEdges"><rect width="${cells}" height="${cells}" fill="#fff"/><g fill="#000">${rects.join('')}</g></svg>`);
}

const escapeMarkup = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function render() {
  const templatePath = await findTemplate();
  const template = sharp(templatePath);
  const box = await findQrBox(template);
  const attendees = query(`SELECT name, student_id, email, token FROM attendees WHERE event_id = ${EVENT_ID} ORDER BY name COLLATE NOCASE`);
  if (!attendees.length) throw new Error('No attendees found. Run the import command first.');

  const outDir = path.resolve(option('--out') ?? path.join(ticketsDir, 'output'));
  await mkdir(outDir, { recursive: true });
  for (const file of await readdir(outDir)) if (/\.(jpg|png)$/.test(file)) await rm(path.join(outDir, file));

  const base = await template.clone().removeAlpha().toBuffer();
  const centreX = box.left + box.width / 2;
  const nameWidth = Math.floor(Math.min(box.width * 1.85, (box.imageWidth - centreX) * 2 - 90));
  const nameHeight = Math.floor(Math.min(box.top - 24, box.height * 0.42));
  const border = Math.max(4, Math.round(box.width * 0.02));
  const qrSize = box.width - border * 2;
  const font = option('--font') ?? 'Arial Bold';
  const fontfile = ['/System/Library/Fonts/Supplemental/Arial Bold.ttf'].find(existsSync);
  // Pango sizes text from dpi: 12pt at this dpi gives capitals about 13% of the square's height.
  const nameDpi = Math.round(box.height * 0.82);
  const whiteBox = await sharp({ create: { width: box.width, height: box.height, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const index = [['Number', 'Name', 'ID', 'Email', 'Ticket code', 'File']];

  let number = 0;
  for (const attendee of attendees) {
    number += 1;
    const nameMarkup = `<span foreground="#ffffff" font_weight="bold">${escapeMarkup(attendee.name.toUpperCase())}</span>`;
    // Same text size for everyone; long names wrap, and shrink only if they would not fit.
    let name;
    for (let dpi = nameDpi; dpi >= nameDpi * 0.5; dpi -= 12) {
      name = await sharp({ text: { text: nameMarkup, font, fontfile, width: nameWidth, dpi, align: 'centre', rgba: true, wrap: 'word' } }).png().toBuffer();
      if ((await sharp(name).metadata()).height <= nameHeight) break;
    }
    const nameSize = await sharp(name).metadata();

    const composites = [
      { input: whiteBox, left: box.left, top: box.top },
      { input: qrSvg(attendee.token, qrSize), left: box.left + Math.round((box.width - qrSize) / 2), top: box.top + Math.round((box.height - qrSize) / 2) },
      { input: name, left: Math.round(centreX - nameSize.width / 2), top: Math.max(8, box.top - Math.round(box.height * 0.07) - nameSize.height) },
    ];
    if (attendee.student_id) {
      const idText = await sharp({ text: { text: `<span foreground="#f3d9de">ID ${escapeMarkup(attendee.student_id)}</span>`, font: font.replace(/ Bold$/, ''), fontfile, dpi: Math.round(box.height * 0.42), rgba: true } }).png().toBuffer();
      const idSize = await sharp(idText).metadata();
      composites.push({ input: idText, left: Math.round(centreX - idSize.width / 2), top: box.top + box.height + Math.round(box.height * 0.08) });
    }

    const fileName = `${String(number).padStart(3, '0')}-${attendee.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}.jpg`;
    await sharp(base).composite(composites).jpeg({ quality: 92, chromaSubsampling: '4:4:4', mozjpeg: true }).toFile(path.join(outDir, fileName));
    index.push([number, attendee.name, attendee.student_id ?? '', attendee.email ?? '', attendee.token, fileName]);
  }
  const csv = index.map(row => row.map(cell => (/[",\n]/.test(String(cell)) ? `"${String(cell).replace(/"/g, '""')}"` : cell)).join(',')).join('\n');
  await writeFile(path.join(outDir, 'tickets.csv'), csv);
  console.log(`Rendered ${attendees.length} tickets from the ${remote ? 'remote' : 'local'} database into ${path.relative(root, outDir)}/`);
  console.log(`QR square found at x ${box.left}, y ${box.top}, ${box.width} x ${box.height}px.`);
}

// Uploads the rendered banner tickets to the TICKET_IMAGES KV namespace, keyed
// by ticket code, so the Worker can attach them to the ticket emails.
async function upload() {
  const outDir = path.resolve(option('--out') ?? path.join(ticketsDir, 'output'));
  const indexFile = path.join(outDir, 'tickets.csv');
  if (!existsSync(indexFile)) throw new Error('Run the render command first.');
  const [, ...rows] = (await readFile(indexFile, 'utf8')).trim().split('\n').map(line => {
    const cells = [];
    let cell = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (quoted) {
        if (char === '"' && line[index + 1] === '"') { cell += '"'; index += 1; }
        else if (char === '"') quoted = false;
        else cell += char;
      } else if (char === '"') quoted = true;
      else if (char === ',') { cells.push(cell); cell = ''; }
      else cell += char;
    }
    cells.push(cell);
    return cells;
  });
  const known = new Set(query(`SELECT token FROM attendees WHERE event_id = ${EVENT_ID}`).map(row => row.token));
  const items = rows.map(cells => ({ token: cells[4], file: path.join(outDir, cells[5]) })).filter(item => known.has(item.token) && existsSync(item.file));
  if (!items.length) throw new Error('No rendered tickets match the database. Render again with the same --remote setting.');

  const batchFile = path.join(ticketsDir, '.kv-batch.json');
  try {
    for (let start = 0; start < items.length; start += 25) {
      const batch = items.slice(start, start + 25);
      const entries = await Promise.all(batch.map(async item => ({ key: item.token, value: (await readFile(item.file)).toString('base64'), base64: true })));
      await writeFile(batchFile, JSON.stringify(entries));
      execFileSync('npx', ['wrangler', 'kv', 'bulk', 'put', batchFile, '--binding', 'TICKET_IMAGES', remote ? '--remote' : '--local'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
      const tokens = batch.map(item => sqlText(item.token)).join(', ');
      await runSql([`UPDATE attendees SET ticket_ready_at = ${Date.now()} WHERE event_id = ${EVENT_ID} AND token IN (${tokens});`]);
      console.log(`Uploaded ${Math.min(start + 25, items.length)} of ${items.length}`);
    }
  } finally {
    await rm(batchFile, { force: true });
  }
  const missing = query(`SELECT name FROM attendees WHERE event_id = ${EVENT_ID} AND email IS NOT NULL AND ticket_ready_at IS NULL`);
  console.log(`${remote ? 'Remote' : 'Local'}: ${items.length} ticket images uploaded.${missing.length ? ` Still missing: ${missing.map(row => row.name).join(', ')}` : ''}`);
}

// Stores the banner template so the dashboard can rebuild a ticket after a
// name or student ID is corrected.
async function uploadTemplate() {
  const file = await findTemplate();
  execFileSync('npx', ['wrangler', 'kv', 'key', 'put', 'template', '--path', file, '--binding', 'TICKET_IMAGES', remote ? '--remote' : '--local'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  console.log(`${remote ? 'Remote' : 'Local'}: uploaded ${path.relative(root, file)} as the ticket template.`);
}

function readablePassword() {
  const words = [createToken(), createToken()].join('').toLowerCase();
  return `${words.slice(0, 4)}-${words.slice(4, 8)}-${words.slice(8, 12)}-${words.slice(12, 16)}`;
}

async function organizer() {
  const username = positional[0]?.trim().toLowerCase();
  if (!username || !/^[a-z0-9._-]{3,64}$/.test(username)) throw new Error('Give an organizer ID of 3 to 64 letters, numbers, dots, dashes or underscores.');
  const password = option('--password') ?? readablePassword();
  if (password.length < 8) throw new Error('Use a password of at least 8 characters.');
  const hash = await hashPassword(password);
  await runSql([`INSERT INTO organizers (username, password_hash, created_at) VALUES (${sqlText(username)}, ${sqlText(hash)}, ${Date.now()})
    ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash;`, `DELETE FROM sessions WHERE username = ${sqlText(username)};`]);
  await mkdir(ticketsDir, { recursive: true });
  const target = remote ? 'nsumibc.online' : 'local dev';
  await appendFile(path.join(ticketsDir, 'organizer-logins.txt'), `${new Date().toISOString()}  ${target}  ID: ${username}  Password: ${password}\n`);
  console.log(`Organizer "${username}" saved to the ${remote ? 'remote' : 'local'} database. Login details are in tickets/organizer-logins.txt`);
}

try {
  if (command === 'import') await importCsv();
  else if (command === 'render') await render();
  else if (command === 'upload') { await upload(); await uploadTemplate(); }
  else if (command === 'upload-template') await uploadTemplate();
  else if (command === 'organizer') await organizer();
  else {
    console.log('Usage:\n  npm run tickets -- import <file.csv> [--test] [--remote]\n  npm run tickets -- render [--remote] [--template <file>]\n  npm run tickets -- upload [--remote]\n  npm run tickets -- upload-template [--remote]\n  npm run tickets -- organizer <id> [--password <password>] [--remote]');
    process.exitCode = command ? 1 : 0;
  }
} catch (error) {
  console.error(error.stderr?.toString?.() || error.message);
  process.exitCode = 1;
}
