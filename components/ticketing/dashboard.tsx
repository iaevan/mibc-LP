'use client';

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { api, formatDateTime, formatTime, type Attendee, type EventInfo, type ImportResult } from './api';
import { downloadBanner, uploadBanner } from './banner';
import { downloadCanvas, drawQr, fileSafe, ticketCard } from './qr';
import styles from './ticketing.module.css';

type Filter = 'all' | 'present' | 'absent';
const PAGE = 150;

type Props = {
  event: EventInfo;
  attendees: Attendee[];
  username: string;
  onEvent: (event: EventInfo) => void;
  onUpsert: (attendee: Attendee) => void;
  onRemove: (id: number) => void;
  onReload: () => Promise<void>;
  onLogout: () => void;
};

function csvCell(value: string | number | null) {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function Dashboard({ event, attendees, username, onEvent, onUpsert, onRemove, onReload, onLogout }: Props) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<Attendee | null>(null);
  const [panel, setPanel] = useState<'none' | 'add' | 'import'>('none');

  const present = attendees.filter(attendee => attendee.checkedInAt).length;
  const total = attendees.length;
  const rate = total ? Math.round((present / total) * 100) : 0;

  const lastHour = useMemo(() => {
    const since = Date.now() - 3600_000;
    return attendees.filter(attendee => (attendee.checkedInAt ?? 0) > since).length;
  }, [attendees]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let list = attendees.filter(attendee => {
      if (filter === 'present' && !attendee.checkedInAt) return false;
      if (filter === 'absent' && attendee.checkedInAt) return false;
      if (!needle) return true;
      return [attendee.name, attendee.studentId, attendee.email].some(value => value?.toLowerCase().includes(needle));
    });
    if (filter === 'present') list = list.slice().sort((a, b) => (b.checkedInAt ?? 0) - (a.checkedInAt ?? 0));
    else list = list.slice().sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [attendees, filter, query]);

  useEffect(() => setLimit(PAGE), [query, filter]);

  // Keep the open detail sheet in step with scans from other phones.
  const current = selected ? attendees.find(attendee => attendee.id === selected.id) ?? null : null;

  function exportCsv() {
    const header = ['Name', 'ID', 'Email', 'Status', 'Checked in at', 'Checked in by', 'Added by'];
    const rows = attendees.slice().sort((a, b) => a.name.localeCompare(b.name)).map(attendee => [
      attendee.name, attendee.studentId, attendee.email, attendee.checkedInAt ? 'Present' : 'Absent',
      attendee.checkedInAt ? new Date(attendee.checkedInAt).toISOString() : '', attendee.checkedInBy, attendee.source,
    ]);
    const csv = [header, ...rows].map(row => row.map(csvCell).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${fileSafe(event.name)}-attendance.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  return (
    <div className={styles.dashboard}>
      <EventName event={event} onEvent={onEvent} />

      <div className={styles.stats}>
        <div className={styles.statWide}>
          <div className={styles.statHead}><span>Attendance</span><b>{rate}%</b></div>
          <div className={styles.meter} role="progressbar" aria-valuenow={rate} aria-valuemin={0} aria-valuemax={100} aria-label="Attendance">
            <span style={{ width: `${rate}%` }} />
          </div>
        </div>
        <div className={styles.stat}><b>{total}</b><span>Registered</span></div>
        <div className={styles.stat}><b>{present}</b><span>Attended</span></div>
        <div className={styles.stat}><b>{total - present}</b><span>Not yet</span></div>
        <div className={styles.stat}><b>{lastHour}</b><span>Last hour</span></div>
      </div>

      <div className={styles.actions}>
        <button type="button" className={styles.secondary} aria-expanded={panel === 'add'} onClick={() => setPanel(panel === 'add' ? 'none' : 'add')}>Add person</button>
        <button type="button" className={styles.secondary} aria-expanded={panel === 'import'} onClick={() => setPanel(panel === 'import' ? 'none' : 'import')}>Import CSV</button>
        <button type="button" className={styles.secondary} onClick={exportCsv} disabled={!total}>Export CSV</button>
      </div>

      {panel === 'add' && <AddPerson onAdded={attendee => { onUpsert(attendee); setSelected(attendee); setPanel('none'); }} />}
      {panel === 'import' && <ImportCsv onImported={() => onReload()} />}

      <div className={styles.listTools}>
        <input
          type="search"
          className={styles.search}
          placeholder="Search name, ID or email"
          value={query}
          onChange={change => setQuery(change.target.value)}
          aria-label="Search people"
        />
        <div className={styles.segmented} role="group" aria-label="Filter people">
          {(['all', 'present', 'absent'] as Filter[]).map(value => (
            <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>
              {value === 'all' ? 'All' : value === 'present' ? 'Attended' : 'Not yet'}
            </button>
          ))}
        </div>
      </div>

      <ul className={styles.people}>
        {visible.slice(0, limit).map(attendee => (
          <li key={attendee.id}>
            <button type="button" onClick={() => setSelected(attendee)}>
              <span className={styles.personText}>
                <b>{attendee.name}</b>
                <small>{[attendee.studentId, attendee.email].filter(Boolean).join(' · ')}</small>
              </span>
              <span className={styles.pill} data-present={attendee.checkedInAt ? 'yes' : 'no'}>
                {attendee.checkedInAt ? formatTime(attendee.checkedInAt) : 'Not yet'}
              </span>
            </button>
          </li>
        ))}
        {!visible.length && <li className={styles.empty}>{total ? 'No one matches this search.' : 'No one is registered yet. Import a CSV or add people.'}</li>}
      </ul>
      {visible.length > limit && (
        <button type="button" className={styles.secondary} onClick={() => setLimit(limit + PAGE)}>Show more ({visible.length - limit} left)</button>
      )}

      <footer className={styles.account}>
        <span>Signed in as <b>{username}</b></span>
        <button type="button" className={styles.linkButton} onClick={onLogout}>Sign out</button>
      </footer>

      {current && (
        <PersonSheet
          attendee={current}
          eventName={event.name}
          onClose={() => setSelected(null)}
          onUpsert={onUpsert}
          onRemove={id => { onRemove(id); setSelected(null); }}
        />
      )}
    </div>
  );
}

function EventName({ event, onEvent }: { event: EventInfo; onEvent: (event: EventInfo) => void }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const name = String(new FormData(formEvent.currentTarget).get('name') ?? '');
    setBusy(true);
    setError('');
    try {
      const result = await api<{ event: EventInfo }>('event', { method: 'PATCH', body: { name } });
      onEvent(result.event);
      setEditing(false);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div className={styles.eventName}>
        <span className={styles.kicker}>Event</span>
        <h1>{event.name}</h1>
        <button type="button" className={styles.linkButton} onClick={() => setEditing(true)}>Edit name</button>
      </div>
    );
  }
  return (
    <form className={styles.eventForm} onSubmit={save}>
      <label>
        <span>Event name</span>
        <input name="name" defaultValue={event.name} maxLength={120} required autoFocus />
      </label>
      {error && <p className={styles.errorText} role="alert">{error}</p>}
      <div className={styles.row}>
        <button type="submit" className={styles.primary} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" className={styles.secondary} onClick={() => setEditing(false)}>Cancel</button>
      </div>
    </form>
  );
}

function AddPerson({ onAdded }: { onAdded: (attendee: Attendee) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const form = new FormData(formEvent.currentTarget);
    setBusy(true);
    setError('');
    try {
      const result = await api<{ attendee: Attendee }>('attendees', {
        method: 'POST',
        body: { name: form.get('name'), studentId: form.get('studentId'), email: form.get('email') },
      });
      onAdded(result.attendee);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not add this person');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.card} onSubmit={submit}>
      <h2>Add a person</h2>
      <label><span>Full name</span><input name="name" required maxLength={120} autoComplete="off" /></label>
      <label><span>Student ID</span><input name="studentId" inputMode="numeric" maxLength={40} autoComplete="off" /></label>
      <label><span>Email</span><input name="email" type="email" maxLength={160} autoComplete="off" autoCapitalize="none" /></label>
      {error && <p className={styles.errorText} role="alert">{error}</p>}
      <button type="submit" className={styles.primary} disabled={busy}>{busy ? 'Adding…' : 'Add and show QR'}</button>
    </form>
  );
}

function ImportCsv({ onImported }: { onImported: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  async function choose(change: ChangeEvent<HTMLInputElement>) {
    const file = change.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setMessage('');
    setError('');
    try {
      if (file.size > 5_000_000) throw new Error('Use a CSV smaller than 5 MB');
      const result = await api<ImportResult>('attendees/import', { method: 'POST', body: { csv: await file.text() } });
      await onImported();
      const parts = [`Added ${result.added.length}`];
      if (result.duplicates) parts.push(`${result.duplicates} already registered`);
      if (result.invalid.length) parts.push(`${result.invalid.length} skipped (line ${result.invalid.slice(0, 5).map(item => item.line).join(', ')}${result.invalid.length > 5 ? ', …' : ''})`);
      setMessage(`${parts.join('. ')}.`);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Import failed');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className={styles.card}>
      <h2>Import a CSV</h2>
      <p className={styles.hint}>Needs a <b>Name</b> column. <b>ID</b> and <b>Email</b> columns are optional. People whose student ID is already on the list are skipped.</p>
      <label className={styles.fileButton}>
        <input ref={input} type="file" accept=".csv,text/csv" onChange={choose} disabled={busy} />
        <span>{busy ? 'Importing…' : 'Choose CSV file'}</span>
      </label>
      {message && <p className={styles.success} role="status">{message}</p>}
      {error && <p className={styles.errorText} role="alert">{error}</p>}
    </div>
  );
}

const MAIL_TEXT: Record<string, string> = {
  pending: 'Queued',
  sending: 'Sending now',
  sent: 'Sent',
  failed: 'Failed',
};

function queuedMessage(state: string) {
  return state === 'paused'
    ? 'Queued, but sending is paused. Resume it in the Mail tab.'
    : 'Queued. The sender picks it up within about 10 minutes, or start it from GitHub Actions.';
}

function PersonSheet({ attendee, eventName, onClose, onUpsert, onRemove }: {
  attendee: Attendee; eventName: string; onClose: () => void; onUpsert: (attendee: Attendee) => void; onRemove: (id: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (context) drawQr(context, attendee.token, 0, 0, 300);
  }, [attendee.token, editing]);

  useEffect(() => {
    const onKey = (keyEvent: KeyboardEvent) => { if (keyEvent.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function run(task: () => Promise<void>, fallback: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      // Notices set during the task stay visible if a later step fails.
      await task();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : fallback);
    } finally {
      setBusy(false);
    }
  }

  async function resend(person: Attendee) {
    const result = await api<{ queued: boolean; state: string }>('mail/resend', { method: 'POST', body: { id: person.id } });
    onUpsert({ ...person, mailStatus: 'pending', mailSentAt: null });
    return queuedMessage(result.state);
  }

  async function save(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const form = new FormData(formEvent.currentTarget);
    const sendAgain = form.get('sendAgain') === 'on';
    await run(async () => {
      const result = await api<{ attendee: Attendee; ticketChanged: boolean }>(`attendees/${attendee.id}`, {
        method: 'PATCH',
        body: { name: form.get('name'), studentId: form.get('studentId'), email: form.get('email') },
      });
      let person = result.attendee;
      onUpsert(person);
      setEditing(false);
      const steps = ['Details saved.'];
      if (result.ticketChanged) {
        person = await uploadBanner(person);
        onUpsert(person);
        steps.push('Ticket rebuilt with the new details.');
      }
      setNotice(steps.join(' '));
      if (sendAgain) {
        steps.push(await resend(person));
        setNotice(steps.join(' '));
      }
    }, 'Could not save');
  }

  async function setPresent(present: boolean) {
    await run(async () => {
      const result = await api<{ attendee: Attendee }>(`attendees/${attendee.id}/attendance`, { method: 'POST', body: { present } });
      onUpsert(result.attendee);
    }, 'Could not update');
  }

  async function removePerson() {
    if (!window.confirm(`Remove ${attendee.name} from the list? Their QR code will stop working.`)) return;
    await run(async () => {
      await api(`attendees/${attendee.id}`, { method: 'DELETE' });
      onRemove(attendee.id);
    }, 'Could not remove');
  }

  const mailText = !attendee.email ? 'No email address'
    : attendee.mailStatus === 'sent' && attendee.mailSentAt ? `Sent ${formatDateTime(attendee.mailSentAt)}`
      : MAIL_TEXT[attendee.mailStatus ?? ''] ?? 'Not sent yet';

  return (
    <div className={styles.sheetBackdrop} onClick={onClose}>
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-label={attendee.name} onClick={click => click.stopPropagation()}>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close">×</button>
        <h2>{attendee.name}</h2>
        {editing ? (
          <form className={styles.editForm} onSubmit={save}>
            <label><span>Full name</span><input name="name" defaultValue={attendee.name} required maxLength={120} autoComplete="off" /></label>
            <label><span>Student ID</span><input name="studentId" defaultValue={attendee.studentId ?? ''} inputMode="numeric" maxLength={40} autoComplete="off" /></label>
            <label><span>Email</span><input name="email" type="email" defaultValue={attendee.email ?? ''} maxLength={160} autoComplete="off" autoCapitalize="none" spellCheck={false} /></label>
            <label className={styles.checkRow}>
              <input type="checkbox" name="sendAgain" defaultChecked />
              <span>Email the ticket to these details</span>
            </label>
            <p className={styles.hint}>A new name or ID also rebuilds their banner ticket. Their QR code stays the same.</p>
            {error && <p className={styles.errorText} role="alert">{error}</p>}
            <div className={styles.row}>
              <button type="submit" className={styles.primary} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
              <button type="button" className={styles.secondary} disabled={busy} onClick={() => { setEditing(false); setError(''); }}>Cancel</button>
            </div>
          </form>
        ) : (
          <>
            <dl className={styles.details}>
              <div><dt>Student ID</dt><dd>{attendee.studentId || 'None'}</dd></div>
              <div><dt>Email</dt><dd>{attendee.email || 'None'}</dd></div>
              <div><dt>Ticket email</dt><dd>{mailText}</dd></div>
              <div><dt>Status</dt><dd>{attendee.checkedInAt ? `Attended, ${formatDateTime(attendee.checkedInAt)}${attendee.checkedInBy ? ` by ${attendee.checkedInBy}` : ''}` : 'Not checked in'}</dd></div>
              <div><dt>Ticket code</dt><dd className={styles.mono}>{attendee.token}</dd></div>
            </dl>
            <canvas ref={canvas} width={300} height={300} className={styles.qr} aria-label={`QR code for ${attendee.name}`} />
            {notice && <p className={styles.success} role="status">{notice}</p>}
            {error && <p className={styles.errorText} role="alert">{error}</p>}
            <div className={styles.sheetActions}>
              {attendee.checkedInAt
                ? <button type="button" className={styles.secondary} disabled={busy} onClick={() => setPresent(false)}>Undo check-in</button>
                : <button type="button" className={styles.primary} disabled={busy} onClick={() => setPresent(true)}>Mark as attended</button>}
              <button type="button" className={styles.secondary} disabled={busy} onClick={() => { setEditing(true); setNotice(''); setError(''); }}>Edit details</button>
              <button
                type="button"
                className={styles.secondary}
                disabled={busy || !attendee.email || attendee.mailStatus === 'pending' || attendee.mailStatus === 'sending'}
                onClick={() => run(async () => {
                  const person = attendee.ticketReady === false ? await uploadBanner(attendee) : attendee;
                  setNotice(await resend(person));
                }, 'Could not queue the email')}
              >
                {attendee.mailStatus === 'pending' ? 'Ticket email queued' : 'Resend ticket email'}
              </button>
              <button
                type="button"
                className={styles.secondary}
                disabled={busy}
                onClick={() => run(async () => {
                  try { await downloadBanner(attendee, `${fileSafe(attendee.name)}-ticket.jpg`); }
                  catch { downloadCanvas(ticketCard(attendee, eventName), `${fileSafe(attendee.name)}-qr.png`); }
                }, 'Could not download')}
              >
                Download ticket
              </button>
              <button type="button" className={styles.danger} disabled={busy} onClick={removePerson}>Remove</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
