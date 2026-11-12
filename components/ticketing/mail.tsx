'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, formatTime } from './api';
import styles from './ticketing.module.css';

type MailStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'no_email';
type Person = {
  id: number;
  name: string;
  email: string | null;
  test: boolean;
  status: MailStatus;
  attempts: number;
  error: string | null;
  startedAt: number | null;
  sentAt: number | null;
  ticketReady: boolean;
};
type Campaign = {
  state: 'idle' | 'running' | 'paused' | 'done';
  scope: 'test' | 'all';
  failuresInRow: number;
  lastError: string | null;
  lastTickAt: number | null;
  updatedAt: number;
  updatedBy: string | null;
};
type MailData = { campaign: Campaign; people: Person[]; runnerReady: boolean; from: string | null; serverTime: number; deleted?: number };
type Filter = 'all' | 'test' | 'failed' | 'waiting';
type Toast = { key: number; kind: 'sent' | 'failed'; text: string };

const POLL_MS = 5000;
const SEND_EVERY_MS = 60_000;
// The GitHub sender checks in at least once a minute while it is working.
const SENDER_QUIET_MS = 150_000;

const STATE_TEXT: Record<Campaign['state'], string> = {
  idle: 'Not started',
  running: 'Sending',
  paused: 'Paused',
  done: 'Finished',
};

const STATUS_TEXT: Record<MailStatus, string> = {
  pending: 'Queued',
  sending: 'Sending',
  sent: 'Sent',
  failed: 'Failed',
  no_email: 'No email',
};

function ago(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`;
}

function clock(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function duration(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function MailPanel({ active, onUnauthorized }: { active: boolean; onUnauthorized: () => void }) {
  const [data, setData] = useState<MailData | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [freshIds, setFreshIds] = useState<Set<number>>(new Set());
  const previous = useRef<Map<number, MailStatus> | null>(null);
  const toastKey = useRef(0);
  // Server and phone clocks differ; work in server time for countdowns.
  const clockOffset = useRef(0);

  const absorb = useCallback((next: MailData) => {
    clockOffset.current = next.serverTime - Date.now();
    const before = previous.current;
    if (before) {
      const changed: Toast[] = [];
      const fresh = new Set<number>();
      for (const person of next.people) {
        const was = before.get(person.id);
        if (was && was !== person.status && (person.status === 'sent' || person.status === 'failed')) {
          fresh.add(person.id);
          toastKey.current += 1;
          changed.push({ key: toastKey.current, kind: person.status, text: person.status === 'sent' ? `Sent to ${person.name}` : `Could not send to ${person.name}` });
        }
      }
      if (changed.length) {
        setToasts(list => [...list, ...changed].slice(-3));
        setFreshIds(fresh);
        for (const toast of changed) setTimeout(() => setToasts(list => list.filter(item => item.key !== toast.key)), 4500);
      }
    }
    previous.current = new Map(next.people.map(person => [person.id, person.status]));
    setData(next);
  }, []);

  const load = useCallback(async () => {
    try {
      absorb(await api<MailData>('mail/status'));
      setError('');
    } catch (problem) {
      if (problem instanceof ApiError && problem.status === 401) onUnauthorized();
      else setError(problem instanceof Error ? problem.message : 'Could not load mail status');
    }
  }, [absorb, onUnauthorized]);

  useEffect(() => {
    if (!active) return;
    void load();
    const poll = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [active, load]);

  async function act(path: string, body: unknown = {}, done?: (result: MailData) => string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api<MailData>(path, { method: 'POST', body });
      absorb(result);
      if (done) setNotice(done(result));
    } catch (problem) {
      if (problem instanceof ApiError && problem.status === 401) onUnauthorized();
      else setError(problem instanceof Error ? problem.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const summary = useMemo(() => {
    const people = data?.people ?? [];
    const withEmail = people.filter(person => person.email);
    const count = (list: Person[], status: MailStatus) => list.filter(person => person.status === status).length;
    const tests = withEmail.filter(person => person.test);
    return {
      total: withEmail.length,
      sent: count(withEmail, 'sent'),
      failed: count(withEmail, 'failed'),
      queued: count(withEmail, 'pending'),
      waiting: count(withEmail, 'pending') + count(withEmail, 'sending'),
      noTicket: withEmail.filter(person => !person.ticketReady && person.status === 'pending').length,
      testTotal: tests.length,
      testSent: count(tests, 'sent'),
      testWaiting: count(tests, 'pending') + count(tests, 'sending'),
    };
  }, [data]);

  const visible = useMemo(() => {
    const people = data?.people ?? [];
    if (filter === 'test') return people.filter(person => person.test);
    if (filter === 'failed') return people.filter(person => person.status === 'failed' || person.status === 'no_email');
    if (filter === 'waiting') return people.filter(person => person.status === 'pending' || person.status === 'sending');
    return people;
  }, [data, filter]);

  if (!data) {
    return (
      <div className={styles.dashboard}>
        {error ? <p className={styles.errorText} role="alert">{error}</p> : <p className={styles.hint}>Loading mail status…</p>}
      </div>
    );
  }

  const { campaign, people } = data;
  const serverNow = now + clockOffset.current;
  const running = campaign.state === 'running';
  const percent = summary.total ? Math.round((summary.sent / summary.total) * 100) : 0;
  const failedPercent = summary.total ? (summary.failed / summary.total) * 100 : 0;

  // People in the order the sender takes them: test users first, then by row.
  const inScope = (person: Person) => campaign.scope === 'all' || person.test;
  const sending = people.find(person => person.status === 'sending');
  const upNext = people.filter(person => person.email && person.status === 'pending' && (!running || inScope(person))).slice(0, 4);
  const queueLeft = people.filter(person => person.email && (person.status === 'pending' || person.status === 'sending') && inScope(person)).length;
  const activity = people
    .filter(person => person.status === 'sent' || person.status === 'failed')
    .map(person => ({ person, at: person.status === 'sent' ? person.sentAt ?? 0 : person.startedAt ?? 0 }))
    .sort((a, b) => b.at - a.at)
    .slice(0, 8);
  const lastSentAt = people.reduce((latest, person) => Math.max(latest, person.sentAt ?? 0), 0);

  const senderAge = campaign.lastTickAt ? serverNow - campaign.lastTickAt : null;
  const senderOnline = senderAge != null && senderAge < SENDER_QUIET_MS;
  const nextIn = lastSentAt ? lastSentAt + SEND_EVERY_MS - serverNow : 0;
  const finishAt = running && queueLeft ? now + queueLeft * SEND_EVERY_MS : null;

  let liveTitle: string;
  let liveText: string;
  let liveMode: 'sending' | 'waiting' | 'starting' | 'stopped' | 'done';
  if (running && sending) {
    liveMode = 'sending';
    liveTitle = `Sending to ${sending.name}`;
    liveText = sending.email ?? '';
  } else if (running && queueLeft === 0) {
    // Nothing left to send; the queue closes on the sender's next report.
    liveMode = 'done';
    liveTitle = 'All queued emails sent';
    liveText = summary.failed ? `${summary.failed} could not be sent. See Problems below.` : 'Every email in the queue went out.';
  } else if (running && senderOnline && nextIn > 0) {
    liveMode = 'waiting';
    liveTitle = `Next email in ${clock(nextIn)}`;
    liveText = upNext[0] ? `Up next: ${upNext[0].name}` : 'Wrapping up';
  } else if (running) {
    liveMode = 'starting';
    liveTitle = senderOnline ? 'Sending the next email' : 'Waiting for the sender to start';
    liveText = senderOnline ? 'Any second now.' : 'If nothing happens within 2 minutes, open GitHub, Actions, Mail sender, and press Run workflow.';
  } else if (campaign.state === 'done') {
    liveMode = 'done';
    liveTitle = campaign.scope === 'test' ? 'Test emails finished' : 'All emails sent';
    liveText = summary.failed ? `${summary.failed} could not be sent. See Problems below.` : 'Every email in the queue went out.';
  } else {
    liveMode = 'stopped';
    liveTitle = campaign.state === 'paused' ? 'Sending is paused' : 'Ready to send';
    liveText = campaign.state === 'paused' ? 'Nothing will go out until you resume.' : `${summary.queued} emails are queued.`;
  }

  return (
    <div className={styles.dashboard}>
      <div className={styles.toastStack} aria-live="polite">
        {toasts.map(toast => (
          <div key={toast.key} className={styles.toast} data-kind={toast.kind}>
            <span aria-hidden="true">{toast.kind === 'sent' ? '✓' : '!'}</span>{toast.text}
          </div>
        ))}
      </div>

      <div className={styles.eventName}>
        <span className={styles.kicker}>Ticket emails</span>
        <h1>Mail queue</h1>
        <p className={styles.hint}>From {data.from ?? 'the club mailbox'}. One email per minute, test users first.</p>
      </div>

      {!data.runnerReady && (
        <p className={styles.mailAlert} role="alert">The email sender is not connected yet. Set the MAIL_RUNNER_TOKEN secret on the Worker and on GitHub, then reload.</p>
      )}
      {summary.noTicket > 0 && (
        <p className={styles.mailAlert} role="alert">{summary.noTicket} people have no ticket image yet. Run <code>npm run tickets -- render --remote</code> and <code>npm run tickets -- upload --remote</code>.</p>
      )}
      {campaign.lastError && (
        <div className={styles.mailProblem} role="alert">
          <b>{campaign.state === 'paused' ? 'Sending stopped because of an error' : 'The last email had a problem'}</b>
          <span>{campaign.lastError.replace(/^Paused: /, '')}</span>
          {campaign.state === 'paused' && <span>Fix the cause, then tap Resume. The person it stopped on is still queued.</span>}
        </div>
      )}

      <section className={styles.liveCard} data-mode={liveMode} aria-live="polite">
        <div className={styles.liveTop}>
          <span className={styles.mailState} data-state={campaign.state}>
            {running && <span className={styles.pulseDot} aria-hidden="true" />}
            {STATE_TEXT[campaign.state]}
          </span>
          {campaign.state !== 'idle' && <span className={styles.liveScope}>{campaign.scope === 'test' ? 'Test emails only' : 'Everyone'}</span>}
          <b className={styles.liveCount}>{summary.sent}<small>/{summary.total} sent</small></b>
        </div>

        <div className={styles.liveBody}>
          <div className={styles.liveIcon} data-mode={liveMode} aria-hidden="true">
            {liveMode === 'waiting' ? (
              <svg viewBox="0 0 48 48" width="48" height="48">
                <circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" strokeOpacity=".2" strokeWidth="4" />
                <circle
                  cx="24" cy="24" r="20" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round"
                  strokeDasharray={`${(1 - Math.min(1, nextIn / SEND_EVERY_MS)) * 125.7} 125.7`}
                  transform="rotate(-90 24 24)"
                  style={{ transition: 'stroke-dasharray 1s linear' }}
                />
              </svg>
            ) : liveMode === 'done' ? (
              <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>
            )}
          </div>
          <div className={styles.liveText}>
            <strong>{liveTitle}</strong>
            {liveText && <span>{liveText}</span>}
          </div>
        </div>

        <div className={styles.liveMeter} data-running={running} role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Emails sent">
          <span className={styles.liveMeterSent} style={{ width: `${percent}%` }} />
          <span className={styles.liveMeterFailed} style={{ width: `${failedPercent}%` }} />
        </div>

        <dl className={styles.liveFacts}>
          <div><dt>Progress</dt><dd>{percent}%</dd></div>
          <div><dt>Time left</dt><dd>{finishAt ? `${duration(queueLeft)}, about ${formatTime(finishAt)}` : '-'}</dd></div>
          <div>
            <dt>Sender</dt>
            <dd className={styles.senderState} data-online={senderOnline}>
              <span aria-hidden="true" />
              {senderAge == null ? 'Not seen yet' : senderOnline ? `Online, checked in ${ago(senderAge)}` : `Last seen ${ago(senderAge)}`}
            </dd>
          </div>
        </dl>
        {running && !senderOnline && serverNow - campaign.updatedAt > 2 * 60_000 && (
          <p className={styles.liveWarn}>The sender is not running. GitHub's 10 minute schedule is often late, so start it by hand: open the repository on GitHub, then Actions, Mail sender, Run workflow. One run sends the whole list.</p>
        )}
      </section>

      <div className={styles.stats}>
        <Stat value={summary.sent} label="Sent" tone="ok" />
        <Stat value={summary.waiting} label="Queued" tone="info" />
        <Stat value={summary.failed} label="Failed" tone={summary.failed ? 'bad' : undefined} />
        <Stat value={`${summary.testSent}/${summary.testTotal}`} label="Test sent" />
      </div>

      <div className={styles.mailActions}>
        {running ? (
          <button type="button" className={styles.secondary} disabled={busy} onClick={() => act('mail/pause', {}, () => 'Paused. The email being sent right now still finishes.')}>Pause sending</button>
        ) : (
          <>
            <button type="button" className={styles.secondary} disabled={busy || !summary.testWaiting} onClick={() => act('mail/start', { scope: 'test' }, () => 'Test emails are queued. The sender picks them up within about 10 minutes.')}>
              Send test emails ({summary.testWaiting})
            </button>
            <button type="button" className={styles.primary} disabled={busy || !summary.waiting} onClick={() => act('mail/start', { scope: 'all' }, () => 'Sending started. The sender picks it up within about 10 minutes, test users first.')}>
              {campaign.state === 'paused' && campaign.scope === 'all' ? 'Resume sending' : 'Send to everyone'} ({summary.waiting})
            </button>
          </>
        )}
        {summary.failed > 0 && (
          <button type="button" className={styles.secondary} disabled={busy} onClick={() => act('mail/retry-failed', {}, () => 'Failed emails are back in the queue.')}>Retry failed ({summary.failed})</button>
        )}
        {summary.testTotal > 0 && summary.testWaiting < summary.testTotal && !running && (
          <button type="button" className={styles.secondary} disabled={busy} onClick={() => act('mail/requeue-tests', {}, () => 'Test emails are back in the queue.')}>Queue test emails again</button>
        )}
      </div>

      {notice && <p className={styles.success} role="status">{notice}</p>}
      {error && <p className={styles.errorText} role="alert">{error}</p>}

      {(upNext.length > 0 || activity.length > 0) && (
        <div className={styles.feedGrid}>
          {upNext.length > 0 && (
            <section className={styles.card}>
              <h2>Up next</h2>
              <ol className={styles.queueList}>
                {sending && (
                  <li data-now="true">
                    <span className={styles.queueBadge}><span className={styles.pulseDot} aria-hidden="true" /></span>
                    <span className={styles.personText}><b>{sending.name}</b><small>Sending now</small></span>
                  </li>
                )}
                {upNext.map((person, index) => (
                  <li key={person.id}>
                    <span className={styles.queueBadge}>{index + 1}</span>
                    <span className={styles.personText}>
                      <b>{person.name}{person.test && <span className={styles.testTag}>Test</span>}</b>
                      <small>{running && senderOnline ? `About ${formatTime(now + Math.max(0, nextIn) + (index + (sending ? 1 : 0)) * SEND_EVERY_MS)}` : 'Queued'}</small>
                    </span>
                  </li>
                ))}
              </ol>
              {queueLeft > upNext.length + (sending ? 1 : 0) && <p className={styles.hint}>and {queueLeft - upNext.length - (sending ? 1 : 0)} more queued</p>}
            </section>
          )}
          {activity.length > 0 && (
            <section className={styles.card}>
              <h2>Recent activity</h2>
              <ul className={styles.feed}>
                {activity.map(({ person, at }) => (
                  <li key={`${person.id}-${person.status}`} data-kind={person.status} data-fresh={freshIds.has(person.id) || undefined}>
                    <span className={styles.feedIcon} aria-hidden="true">{person.status === 'sent' ? '✓' : '!'}</span>
                    <span className={styles.personText}>
                      <b>{person.name}</b>
                      <small>{person.status === 'sent' ? `Sent ${at ? formatTime(at) : ''}` : person.error ?? 'Failed'}</small>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      <div className={styles.segmented} role="group" aria-label="Filter emails" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {(['all', 'test', 'waiting', 'failed'] as Filter[]).map(value => (
          <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>
            {value === 'all' ? 'All' : value === 'test' ? 'Test' : value === 'waiting' ? 'Queued' : `Problems${summary.failed ? ` (${summary.failed})` : ''}`}
          </button>
        ))}
      </div>

      <ul className={styles.people}>
        {visible.map(person => (
          <li key={person.id}>
            <div className={styles.mailRow} data-fresh={freshIds.has(person.id) || undefined}>
              <span className={styles.personText}>
                <b>{person.name}{person.test && <span className={styles.testTag}>Test</span>}</b>
                <small>{person.email ?? 'No email address'}</small>
                {person.error && person.status !== 'sent' && <small className={styles.mailError}>{person.error}</small>}
              </span>
              <span className={styles.pill} data-mail={person.status}>
                {person.status === 'sending' && <span className={styles.pulseDot} aria-hidden="true" />}
                {person.status === 'sent' && person.sentAt ? `✓ ${formatTime(person.sentAt)}` : STATUS_TEXT[person.status]}
              </span>
            </div>
          </li>
        ))}
        {!visible.length && <li className={styles.empty}>{filter === 'failed' ? 'No problems. Every email so far went through.' : 'Nothing here.'}</li>}
      </ul>

      <section className={styles.card}>
        <h2>Test data</h2>
        <p className={styles.hint}>
          Removes all {summary.testTotal} test users, their tickets, check-ins and email records. Real attendees are not touched.
        </p>
        {confirmDelete ? (
          <div className={styles.row}>
            <button
              type="button"
              className={styles.danger}
              disabled={busy}
              onClick={() => { setConfirmDelete(false); void act('mail/delete-tests', {}, result => `Deleted ${result.deleted ?? 0} test users.`); }}
            >
              Yes, delete test data
            </button>
            <button type="button" className={styles.secondary} onClick={() => setConfirmDelete(false)}>Cancel</button>
          </div>
        ) : (
          <button type="button" className={styles.danger} disabled={busy || !summary.testTotal || Boolean(sending?.test)} onClick={() => setConfirmDelete(true)}>
            Delete all test data
          </button>
        )}
      </section>
    </div>
  );
}

function Stat({ value, label, tone }: { value: number | string; label: string; tone?: 'ok' | 'info' | 'bad' }) {
  return (
    <div className={styles.stat} data-tone={tone}>
      {/* Keyed by value so each change replays the pop animation. */}
      <b key={String(value)} className={styles.statPop}>{value}</b>
      <span>{label}</span>
    </div>
  );
}
