'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, formatTime, normalizeToken, type Attendee, type Bootstrap, type CheckInResult, type EventInfo } from './api';
import { Dashboard } from './dashboard';
import { signal } from './feedback';
import { Scanner } from './scanner';
import styles from './ticketing.module.css';

type Status = CheckInResult['result'] | 'checking' | 'invalid';
type Overlay = { key: number; token: string; status: Status; attendee: Attendee | null; previous: number | null; by: string | null };
type Pending = { token: string; scannedAt: number };

const OVERLAY_MS = 5000;
const REPEAT_MS = 2500; // How long a code must be out of view before it counts again.
const REFRESH_MS = 20000;
const QUEUE_KEY = 'mibc-tm-queue';

function loadQueue(): Pending[] {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; }
}
function saveQueue(queue: Pending[]) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue)); } catch { /* storage is optional */ }
}

export function TicketApp() {
  const [phase, setPhase] = useState<'loading' | 'login' | 'ready'>('loading');
  const [username, setUsername] = useState('');
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [tab, setTab] = useState<'scan' | 'event'>('scan');
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [offline, setOffline] = useState(false);

  const byToken = useRef(new Map<string, Attendee>());
  const queue = useRef<Pending[]>([]);
  const flushing = useRef(false);
  const lastSeen = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  const overlayTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const overlayKey = useRef(0);

  useEffect(() => {
    byToken.current = new Map(attendees.map(attendee => [attendee.token, attendee]));
  }, [attendees]);

  const upsert = useCallback((attendee: Attendee) => {
    byToken.current.set(attendee.token, attendee);
    setAttendees(list => {
      const index = list.findIndex(item => item.id === attendee.id);
      if (index < 0) return [...list, attendee];
      const next = list.slice();
      next[index] = attendee;
      return next;
    });
  }, []);

  const remove = useCallback((id: number) => {
    setAttendees(list => list.filter(item => item.id !== id));
  }, []);

  const signedOut = useCallback(() => {
    setPhase('login');
    setAttendees([]);
    setOverlay(null);
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await api<Bootstrap>('bootstrap');
      const waiting = new Map(queue.current.map(item => [item.token, item.scannedAt]));
      // Keep check-ins that are still waiting to reach the server.
      setAttendees(data.attendees.map(attendee => (!attendee.checkedInAt && waiting.has(attendee.token)
        ? { ...attendee, checkedInAt: waiting.get(attendee.token)!, checkedInBy: data.username } : attendee)));
      setEvent(data.event);
      setUsername(data.username);
      setOffline(false);
      setPhase('ready');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) signedOut();
      else if (error instanceof ApiError && error.status === 0) setOffline(true);
      else setPhase(current => (current === 'loading' ? 'login' : current));
    }
  }, [signedOut]);

  const showOverlay = useCallback((next: Omit<Overlay, 'key'>) => {
    overlayKey.current += 1;
    setOverlay({ ...next, key: overlayKey.current });
    clearTimeout(overlayTimer.current);
    overlayTimer.current = setTimeout(() => setOverlay(null), OVERLAY_MS);
  }, []);

  const applyResult = useCallback((token: string, response: CheckInResult) => {
    if (response.attendee) upsert(response.attendee);
    else {
      const known = byToken.current.get(token);
      if (known) remove(known.id);
    }
    // If another scanner got there first, correct the card that is showing.
    setOverlay(current => {
      if (!current || current.token !== token) return current;
      if (current.status === 'checking') signal(response.result);
      if (current.status === 'checking' || (current.status === 'checked_in' && response.result !== 'checked_in')) {
        return {
          ...current,
          status: response.result,
          attendee: response.attendee,
          previous: response.result === 'already' ? response.attendee?.checkedInAt ?? null : current.previous,
          by: response.result === 'already' ? response.attendee?.checkedInBy ?? null : current.by,
        };
      }
      return current;
    });
  }, [remove, upsert]);

  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      while (queue.current.length) {
        const item = queue.current[0];
        try {
          const response = await api<CheckInResult>('checkin', { method: 'POST', body: item });
          applyResult(item.token, response);
          setOffline(false);
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) { signedOut(); break; }
          if (error instanceof ApiError && error.status === 0) { setOffline(true); break; }
          if (error instanceof ApiError && error.status >= 500) break; // Retry on the next sync.
          // Drop requests the server rejected as invalid so the queue never jams.
        }
        queue.current.shift();
        saveQueue(queue.current);
        setPendingCount(queue.current.length);
      }
    } finally {
      flushing.current = false;
    }
  }, [applyResult, signedOut]);

  useEffect(() => {
    queue.current = loadQueue();
    setPendingCount(queue.current.length);
    void load();
  }, [load]);

  useEffect(() => {
    if (phase !== 'ready') return;
    void flush();
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void flush();
      if (!flushing.current) void load();
    }, REFRESH_MS);
    const online = () => { void flush(); void load(); };
    window.addEventListener('online', online);
    return () => { clearInterval(timer); window.removeEventListener('online', online); };
  }, [phase, flush, load]);

  const onDecode = useCallback((text: string) => {
    const now = Date.now();
    // A code held in view is read many times a second. Count it once, and again
    // only after it has been out of view for a moment.
    const repeat = text === lastSeen.current.text && now - lastSeen.current.at < REPEAT_MS;
    lastSeen.current = { text, at: now };
    if (repeat) return;

    const token = normalizeToken(text);
    if (!token) {
      signal('not_found');
      showOverlay({ token: text, status: 'invalid', attendee: null, previous: null, by: null });
      return;
    }

    const known = byToken.current.get(token);
    if (known) {
      const already = Boolean(known.checkedInAt);
      signal(already ? 'already' : 'checked_in');
      showOverlay({ token, status: already ? 'already' : 'checked_in', attendee: known, previous: known.checkedInAt, by: known.checkedInBy });
      if (!already) upsert({ ...known, checkedInAt: now, checkedInBy: username });
    } else {
      showOverlay({ token, status: 'checking', attendee: null, previous: null, by: null });
    }
    queue.current.push({ token, scannedAt: now });
    saveQueue(queue.current);
    setPendingCount(queue.current.length);
    void flush();
  }, [flush, showOverlay, upsert, username]);

  const logout = useCallback(async () => {
    await api('logout', { method: 'POST', body: {} }).catch(() => undefined);
    signedOut();
  }, [signedOut]);

  const present = useMemo(() => attendees.filter(attendee => attendee.checkedInAt).length, [attendees]);

  if (phase === 'loading') return <div className={styles.app}><div className={styles.splash}>Loading…</div></div>;
  if (phase === 'login') return <Login onDone={() => { setPhase('loading'); void load(); }} />;

  return (
    <div className={styles.app}>
      <header className={styles.topbar}>
        <div className={styles.topTitle}>
          <span className={styles.kicker}>Ticket desk</span>
          <strong>{event?.name}</strong>
        </div>
        <div className={styles.topCount} aria-label={`${present} of ${attendees.length} checked in`}>
          <b>{present}</b><span>/{attendees.length}</span>
        </div>
      </header>

      {(offline || pendingCount > 0) && (
        <div className={styles.syncBar} role="status">
          {offline ? 'Offline. Scans are saved on this phone and will sync.' : 'Syncing'}{pendingCount > 0 ? ` (${pendingCount} waiting)` : ''}
        </div>
      )}

      <main className={styles.main}>
        <section className={styles.panel} hidden={tab !== 'scan'}>
          <Scanner active={tab === 'scan'} onDecode={onDecode}>
            {overlay && <ScanCard overlay={overlay} onClose={() => setOverlay(null)} />}
          </Scanner>
        </section>
        {tab === 'event' && event && (
          <section className={`${styles.panel} ${styles.scroll}`}>
            <Dashboard
              event={event}
              attendees={attendees}
              username={username}
              onEvent={setEvent}
              onUpsert={upsert}
              onRemove={remove}
              onReload={load}
              onLogout={logout}
            />
          </section>
        )}
      </main>

      <nav className={styles.tabs} aria-label="Ticket desk sections">
        <button type="button" aria-current={tab === 'scan' ? 'page' : undefined} onClick={() => setTab('scan')}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10" /></svg>
          Scan
        </button>
        <button type="button" aria-current={tab === 'event' ? 'page' : undefined} onClick={() => setTab('event')}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>
          Event
        </button>
      </nav>
    </div>
  );
}

const STATUS_TEXT: Record<Status, string> = {
  checked_in: 'Checked in',
  already: 'Already checked in',
  not_found: 'Not on the list',
  invalid: 'Not an MIBC ticket',
  checking: 'Checking…',
};

function ScanCard({ overlay, onClose }: { overlay: Overlay; onClose: () => void }) {
  const { attendee, status } = overlay;
  return (
    <div key={overlay.key} className={styles.scanCard} data-status={status} role="alert" onClick={onClose}>
      <div className={styles.scanStatus}>
        <span className={styles.statusIcon} aria-hidden="true">{status === 'checked_in' ? '✓' : status === 'already' ? '!' : status === 'checking' ? '…' : '×'}</span>
        {STATUS_TEXT[status]}
      </div>
      {attendee ? (
        <>
          <p className={styles.scanName}>{attendee.name}</p>
          <dl className={styles.scanMeta}>
            {attendee.studentId && <div><dt>ID</dt><dd>{attendee.studentId}</dd></div>}
            {attendee.email && <div><dt>Email</dt><dd>{attendee.email}</dd></div>}
          </dl>
          {status === 'already' && overlay.previous && (
            <p className={styles.scanNote}>First scanned at {formatTime(overlay.previous)}{overlay.by ? ` by ${overlay.by}` : ''}</p>
          )}
        </>
      ) : (
        <p className={styles.scanNote}>
          {status === 'checking' ? 'Looking up this ticket.' : status === 'invalid' ? 'This QR code is not a ticket for this event.' : 'This ticket is not registered. Check the person in the Event tab.'}
        </p>
      )}
      <span className={styles.countdown} aria-hidden="true" />
    </div>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const form = new FormData(formEvent.currentTarget);
    setBusy(true);
    setError('');
    try {
      await api('login', { method: 'POST', body: { username: form.get('username'), password: form.get('password') } });
      onDone();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not log in');
      setBusy(false);
    }
  }

  return (
    <div className={`${styles.app} ${styles.loginScreen}`}>
      <form className={styles.loginCard} onSubmit={submit}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/mibc-logo.webp" alt="MIBC" width={96} height={69} className={styles.loginLogo} />
        <h1>Ticket desk</h1>
        <p>Organizer sign in for event check-in.</p>
        <label>
          <span>Organizer ID</span>
          <input name="username" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required />
        </label>
        <label>
          <span>Password</span>
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        {error && <p className={styles.errorText} role="alert">{error}</p>}
        <button type="submit" className={styles.primary} disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
