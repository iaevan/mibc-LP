export type Attendee = {
  id: number;
  token: string;
  name: string;
  studentId: string | null;
  email: string | null;
  source: string;
  createdAt: number;
  checkedInAt: number | null;
  checkedInBy: string | null;
  mailStatus?: 'pending' | 'sending' | 'sent' | 'failed' | null;
  mailSentAt?: number | null;
  ticketReady?: boolean;
};

export type EventInfo = { id: number; name: string; updatedAt: number };

export type Bootstrap = { username: string; event: EventInfo; attendees: Attendee[]; serverTime: number };

export type CheckInResult = { result: 'checked_in' | 'already' | 'not_found'; attendee: Attendee | null };

export type ImportResult = { added: Attendee[]; duplicates: number; invalid: { line: number; reason: string }[] };

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export const TOKEN_PATTERN = /^[2-9A-HJ-NP-Z]{12}$/;

export function normalizeToken(text: string) {
  const token = text.trim().toUpperCase();
  return TOKEN_PATTERN.test(token) ? token : null;
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/tm/${path}`, {
      method: init.method ?? 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError('No connection. Check the internet and try again.', 0);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(data.error || `Request failed (${response.status})`, response.status);
  return data as T;
}

export function formatTime(value: number | null) {
  if (!value) return '';
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function formatDateTime(value: number | null) {
  if (!value) return '';
  return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
