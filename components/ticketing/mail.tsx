'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
type MailData = { campaign: Campaign; people: Person[]; smtpReady: boolean; from: string | null; serverTime: number; deleted?: number };
type Filter = 'all' | 'test' | 'failed' | 'waiting';

const POLL_MS = 5000;

const STATE_TEXT: Record<Campaign['state'], string> = {
  idle: 'Not started',
  running: 'Sending',
  paused: 'Paused',
  done: 'Finished',
};

const STATUS_TEXT: Record<MailStatus, string> = {
  pending: 'Waiting',
  sending: 'Sending',
  sent: 'Sent',
  failed: 'Failed',
  no_email: 'No email',
};

export function MailPanel({ active, onUnauthorized }: { active: boolean; onUnauthorized: () => void }) {
  const [data, setData] = useState<MailData | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      setData(await api<MailData>('mail/status'));
      setError('');
    } catch (problem) {
      if (problem instanceof ApiError && problem.status === 401) onUnauthorized();
      else setError(problem instanceof Error ? problem.message : 'Could not load mail status');
    }
  }, [onUnauthorized]);

  useEffect(() => {
    if (!active) return;
    void load();
    const timer = setInterval(() => {
      setNow(Date.now());
      if (document.visibilityState === 'visible') void load();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [active, load]);

  async function act(path: string, body: unknown = {}, done?: (result: MailData) => string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api<MailData>(path, { method: 'POST', body });
      setData(result);
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
      waiting: count(withEmail, 'pending') + count(withEmail, 'sending'),
      noEmail: people.length - withEmail.length,
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

  const { campaign } = data;
  const percent = summary.total ? Math.round((summary.sent / summary.total) * 100) : 0;
  const running = campaign.state === 'running';
  // The cron sends one email a minute, test users first.
  const queueLeft = campaign.scope === 'test' ? summary.testWaiting : summary.waiting;
  const finishAt = running && queueLeft ? now + queueLeft * 60_000 : null;
  const lastTickAgo = campaign.lastTickAt ? Math.round((now - campaign.lastTickAt) / 1000) : null;
  const sending = data.people.find(person => person.status === 'sending');
  const lastSent = data.people.filter(person => person.sentAt).sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0))[0];

  return (
    <div className={styles.dashboard}>
      <div className={styles.eventName}>
        <span className={styles.kicker}>Ticket emails</span>
        <h1>Mail queue</h1>
        <p className={styles.hint}>From {data.from ?? 'the club mailbox'}. One email per minute, test users first.</p>
      </div>

      {!data.smtpReady && (
        <p className={styles.mailAlert} role="alert">The mailbox password is not set on the Worker. Run <code>npx wrangler secret put SMTP_PASSWORD</code> once, then reload.</p>
      )}
      {summary.noTicket > 0 && (
        <p className={styles.mailAlert} role="alert">{summary.noTicket} people have no ticket image yet. Run <code>npm run tickets -- render --remote</code> and <code>npm run tickets -- upload --remote</code>.</p>
      )}
      {campaign.lastError && <p className={styles.mailAlert} role="alert">{campaign.lastError}</p>}

      <div className={styles.stats}>
        <div className={styles.statWide}>
          <div className={styles.statHead}>
            <span>
              <span className={styles.mailState} data-state={campaign.state}>{STATE_TEXT[campaign.state]}</span>
              {campaign.state !== 'idle' && <> {campaign.scope === 'test' ? 'test emails only' : 'everyone'}</>}
            </span>
            <b>{summary.sent}/{summary.total}</b>
          </div>
          <div className={styles.meter} role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Emails sent">
            <span style={{ width: `${percent}%` }} />
          </div>
          <p className={styles.mailMeta}>
            {sending ? <>Sending to <b>{sending.name}</b> now. </> : null}
            {finishAt ? <>About {queueLeft} min left, done around {formatTime(finishAt)}. </> : null}
            {lastSent ? <>Last sent to {lastSent.name} at {formatTime(lastSent.sentAt)}. </> : null}
            {running && lastTickAgo != null && lastTickAgo > 150 ? <>The sender has not run for {Math.round(lastTickAgo / 60)} min. Check the Worker cron.</> : null}
          </p>
        </div>
        <div className={styles.stat}><b>{summary.sent}</b><span>Sent</span></div>
        <div className={styles.stat}><b>{summary.waiting}</b><span>Waiting</span></div>
        <div className={styles.stat}><b>{summary.failed}</b><span>Failed</span></div>
        <div className={styles.stat}><b>{summary.testSent}/{summary.testTotal}</b><span>Test sent</span></div>
      </div>

      <div className={styles.mailActions}>
        {running ? (
          <button type="button" className={styles.secondary} disabled={busy} onClick={() => act('mail/pause')}>Pause sending</button>
        ) : (
          <>
            <button type="button" className={styles.secondary} disabled={busy || !summary.testWaiting} onClick={() => act('mail/start', { scope: 'test' }, () => 'Test emails are queued. The first one goes out within a minute.')}>
              Send test emails ({summary.testWaiting})
            </button>
            <button type="button" className={styles.primary} disabled={busy || !summary.waiting} onClick={() => act('mail/start', { scope: 'all' }, () => 'Sending started. Test users go first, then everyone else.')}>
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

      <div className={styles.segmented} role="group" aria-label="Filter emails" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {(['all', 'test', 'waiting', 'failed'] as Filter[]).map(value => (
          <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>
            {value === 'all' ? 'All' : value === 'test' ? 'Test' : value === 'waiting' ? 'Waiting' : 'Problems'}
          </button>
        ))}
      </div>

      <ul className={styles.people}>
        {visible.map(person => (
          <li key={person.id}>
            <div className={styles.mailRow}>
              <span className={styles.personText}>
                <b>{person.name}{person.test && <span className={styles.testTag}>Test</span>}</b>
                <small>{person.email ?? 'No email address'}</small>
                {person.error && person.status !== 'sent' && <small className={styles.mailError}>{person.error}</small>}
              </span>
              <span className={styles.pill} data-mail={person.status}>
                {person.status === 'sent' && person.sentAt ? formatTime(person.sentAt) : STATUS_TEXT[person.status]}
              </span>
            </div>
          </li>
        ))}
        {!visible.length && <li className={styles.empty}>Nothing here.</li>}
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
