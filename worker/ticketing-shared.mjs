// Shared by the Worker and the local ticket scripts. Uses only Web Crypto, so it
// runs unchanged in Cloudflare Workers and in Node 20 or later.

// QR alphanumeric mode only stores 0-9, A-Z and a few symbols. Twelve characters
// from this 32 letter alphabet (no 0, 1, I or O) give 60 random bits and still
// fit a version 1 QR code at high error correction, which phones decode fastest.
export const TOKEN_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const TOKEN_LENGTH = 12;
export const TOKEN_PATTERN = /^[2-9A-HJ-NP-Z]{12}$/;

export function createToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_LENGTH));
  let token = '';
  for (const byte of bytes) token += TOKEN_ALPHABET[byte & 31];
  return token;
}

export function normalizeToken(value) {
  const token = String(value ?? '').trim().toUpperCase();
  return TOKEN_PATTERN.test(token) ? token : null;
}

const PBKDF2_ITERATIONS = 100000; // The maximum Cloudflare Workers allow.

function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, iterations, salt, expected] = String(stored).split('$');
  if (scheme !== 'pbkdf2_sha256' || !salt || !expected) return false;
  const actual = await derive(password, fromBase64Url(salt), Number(iterations));
  const wanted = fromBase64Url(expected);
  if (actual.length !== wanted.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) difference |= actual[index] ^ wanted[index];
  return difference === 0;
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function randomHex(byteLength = 32) {
  return [...crypto.getRandomValues(new Uint8Array(byteLength))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

// Small RFC 4180 parser: quoted fields, escaped quotes, commas and newlines.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const input = String(text).replace(/^﻿/, '');
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[index + 1] === '\n') index += 1;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += char;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(cells => cells.some(cell => cell.trim() !== ''));
}

export function cleanAttendee(input) {
  const name = String(input?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const studentId = String(input?.studentId ?? '').replace(/\s+/g, '').slice(0, 40) || null;
  const email = String(input?.email ?? '').trim().toLowerCase().slice(0, 160) || null;
  if (!name) return { error: 'Name is required' };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: `Email looks wrong for ${name}` };
  return { attendee: { name, studentId, email } };
}

// Finds Name, ID and Email columns by header, in any order. Serial number
// columns and anything else are ignored, so exported sheets work as they are.
export function attendeesFromCsv(text) {
  const [header, ...body] = parseCsv(text);
  if (!header) return { attendees: [], invalid: [], error: 'The file is empty' };
  const labels = header.map(cell => cell.trim().toLowerCase().replace(/[^a-z]/g, ''));
  const nameColumn = labels.findIndex(label => ['name', 'fullname', 'studentname', 'attendeename'].includes(label));
  const idColumn = labels.findIndex(label => ['id', 'studentid', 'nsuid', 'idno', 'idnumber'].includes(label));
  const emailColumn = labels.findIndex(label => label.includes('mail'));
  if (nameColumn < 0) return { attendees: [], invalid: [], error: 'Add a Name column header to the CSV' };
  const attendees = [];
  const invalid = [];
  body.forEach((cells, index) => {
    const result = cleanAttendee({
      name: cells[nameColumn],
      studentId: idColumn >= 0 ? cells[idColumn] : '',
      email: emailColumn >= 0 ? cells[emailColumn] : '',
    });
    if (result.error) invalid.push({ line: index + 2, reason: result.error });
    else attendees.push(result.attendee);
  });
  return { attendees, invalid };
}
