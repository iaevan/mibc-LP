'use client';

import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { adminApi, ApiError, caseLink, formatBytes, formatDate, uploadForm, type CaseItem } from './api';
import styles from './cases.module.css';

type ListResponse = { username: string; cases: CaseItem[]; maxBytes: number };

export function CaseAdmin() {
  const [phase, setPhase] = useState<'loading' | 'login' | 'ready'>('loading');
  const [username, setUsername] = useState('');
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [maxBytes, setMaxBytes] = useState(25 * 1024 * 1024);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await adminApi<ListResponse>('cases');
      setCases(data.cases);
      setUsername(data.username);
      setMaxBytes(data.maxBytes);
      setPhase('ready');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setPhase('login');
      else { setNotice(error instanceof Error ? error.message : 'Could not load cases'); setPhase(current => (current === 'loading' ? 'login' : current)); }
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const upsert = useCallback((item: CaseItem) => {
    setCases(list => {
      const index = list.findIndex(entry => entry.id === item.id);
      if (index < 0) return [item, ...list];
      const next = list.slice();
      next[index] = item;
      return next;
    });
  }, []);

  const unauthorized = useCallback((error: unknown) => {
    if (error instanceof ApiError && error.status === 401) { setPhase('login'); return true; }
    return false;
  }, []);

  const logout = async () => {
    await adminApi('logout', { method: 'POST', body: {} }).catch(() => undefined);
    setCases([]);
    setPhase('login');
  };

  if (phase === 'loading') return <div className={styles.adminApp}><div className={styles.emptyState} role="status"><p>Loading…</p></div></div>;
  if (phase === 'login') return <Login onDone={() => { setPhase('loading'); void load(); }} />;

  const totalViews = cases.reduce((sum, item) => sum + item.views, 0);
  const totalDownloads = cases.reduce((sum, item) => sum + item.downloads, 0);

  return (
    <div className={styles.adminApp}>
      <header className={styles.adminHeader}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/mibc-logo.webp" alt="MIBC" width={48} height={35} />
        <div className={styles.headerTitle}>
          <span className={styles.kicker}>Case desk</span>
          <strong>Case files</strong>
        </div>
        <span className={styles.who}>{username}</span>
        <button type="button" className={styles.secondary} onClick={logout}>Sign out</button>
      </header>

      <main className={styles.adminMain}>
        <dl className={styles.stats}>
          <div><dt>Cases</dt><dd>{cases.length}</dd></div>
          <div><dt>Live</dt><dd>{cases.filter(item => item.published).length}</dd></div>
          <div><dt>Views</dt><dd>{totalViews}</dd></div>
          <div><dt>Downloads</dt><dd>{totalDownloads}</dd></div>
        </dl>

        {notice && <p className={styles.errorText} role="alert">{notice}</p>}

        <UploadCard maxBytes={maxBytes} onUploaded={upsert} onUnauthorized={unauthorized} />

        <section className={styles.listSection} aria-labelledby="case-list-title">
          <div className={styles.sectionHead}>
            <h2 id="case-list-title">Uploaded cases</h2>
            <button type="button" className={styles.linkButton} onClick={() => void load()}>Refresh</button>
          </div>
          {cases.length === 0 ? (
            <p className={styles.hint}>No cases yet. Upload a PDF above and you will get a link to share with participants.</p>
          ) : (
            <ul className={styles.caseList}>
              {cases.map(item => (
                <CaseRow
                  key={item.id}
                  item={item}
                  maxBytes={maxBytes}
                  onChange={upsert}
                  onRemove={id => setCases(list => list.filter(entry => entry.id !== id))}
                  onUnauthorized={unauthorized}
                />
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

function pickPdf(file: File | undefined, maxBytes: number) {
  if (!file) return { error: '' };
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) return { error: 'Choose a PDF file.' };
  if (file.size > maxBytes) return { error: `This PDF is ${formatBytes(file.size)}. The limit is ${formatBytes(maxBytes)}. Compress it and try again.` };
  return { file };
}

function UploadCard({ maxBytes, onUploaded, onUnauthorized }: { maxBytes: number; onUploaded: (item: CaseItem) => void; onUnauthorized: (error: unknown) => boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [allowDownload, setAllowDownload] = useState(true);
  const [published, setPublished] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState<CaseItem | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const choose = (picked: File | undefined) => {
    const result = pickPdf(picked, maxBytes);
    setError(result.error ?? '');
    if (!result.file) return;
    setFile(result.file);
    setDone(null);
    if (!title) setTitle(result.file.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim());
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    choose(event.dataTransfer.files?.[0]);
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file) { setError('Choose a PDF file.'); return; }
    if (!title.trim()) { setError('Give the case a title.'); return; }
    const form = new FormData();
    form.set('file', file, file.name);
    form.set('title', title.trim());
    form.set('description', description.trim());
    form.set('allowDownload', String(allowDownload));
    form.set('published', String(published));
    setError('');
    setProgress(0);
    try {
      const response = await uploadForm<{ case: CaseItem }>('cases', form, setProgress);
      onUploaded(response.case);
      setDone(response.case);
      setFile(null);
      setTitle('');
      setDescription('');
      if (input.current) input.current.value = '';
    } catch (problem) {
      if (!onUnauthorized(problem)) setError(problem instanceof Error ? problem.message : 'Upload failed');
    } finally {
      setProgress(null);
    }
  }

  return (
    <section className={styles.card} aria-labelledby="upload-title">
      <h2 id="upload-title">Upload a case</h2>
      <form className={styles.uploadForm} onSubmit={submit}>
        <label
          className={styles.dropzone}
          data-dragging={dragging || undefined}
          data-filled={file ? true : undefined}
          onDragOver={event => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <input ref={input} type="file" accept="application/pdf,.pdf" onChange={event => choose(event.target.files?.[0])} />
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M12 18v-6M9 15l3-3 3 3" /></svg>
          {file ? (
            <span><b>{file.name}</b><small>{formatBytes(file.size)} · Click to choose a different file</small></span>
          ) : (
            <span><b>Drop the case PDF here or click to choose</b><small>PDF up to {formatBytes(maxBytes)}</small></span>
          )}
        </label>

        <label className={styles.field}>
          <span>Title participants will see</span>
          <input value={title} onChange={event => setTitle(event.target.value)} maxLength={140} placeholder="MarXcellence 2026 Round 1 Case" required />
        </label>
        <label className={styles.field}>
          <span>Note for participants (optional)</span>
          <textarea value={description} onChange={event => setDescription(event.target.value)} maxLength={2000} rows={3} placeholder="Read the full case before the briefing. Submissions are due at 11:59 PM." />
        </label>

        <div className={styles.checks}>
          <label className={styles.check}>
            <input type="checkbox" checked={allowDownload} onChange={event => setAllowDownload(event.target.checked)} />
            <span>Participants can download the PDF</span>
          </label>
          <label className={styles.check}>
            <input type="checkbox" checked={published} onChange={event => setPublished(event.target.checked)} />
            <span>Link works right away</span>
          </label>
        </div>

        {error && <p className={styles.errorText} role="alert">{error}</p>}
        {progress !== null && (
          <div className={styles.progress} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
            <span style={{ width: `${Math.max(3, progress * 100)}%` }} />
            <small>{progress < 1 ? `Uploading ${Math.round(progress * 100)}%` : 'Saving…'}</small>
          </div>
        )}
        <button type="submit" className={styles.primary} disabled={progress !== null || !file}>
          {progress !== null ? 'Uploading…' : 'Upload and create link'}
        </button>
      </form>

      {done && (
        <div className={styles.doneBox} role="status">
          <p><b>{done.title}</b> is uploaded. Share this link with participants:</p>
          <ShareLink item={done} />
        </div>
      )}
    </section>
  );
}

function ShareLink({ item }: { item: CaseItem }) {
  const [copied, setCopied] = useState(false);
  const link = caseLink(item.slug);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      const field = document.createElement('textarea');
      field.value = link;
      document.body.appendChild(field);
      field.select();
      document.execCommand('copy');
      field.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator;
  return (
    <div className={styles.shareRow}>
      <input readOnly value={link} aria-label={`Share link for ${item.title}`} onFocus={event => event.currentTarget.select()} />
      <button type="button" className={styles.primary} onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
      {canShare && (
        <button type="button" className={styles.secondary} onClick={() => navigator.share({ title: item.title, url: link }).catch(() => undefined)}>Share</button>
      )}
    </div>
  );
}

function CaseRow({ item, maxBytes, onChange, onRemove, onUnauthorized }: {
  item: CaseItem;
  maxBytes: number;
  onChange: (item: CaseItem) => void;
  onRemove: (id: number) => void;
  onUnauthorized: (error: unknown) => boolean;
}) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description);
  const replaceInput = useRef<HTMLInputElement>(null);

  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    setError('');
    try { await action(); } catch (problem) {
      if (!onUnauthorized(problem)) setError(problem instanceof Error ? problem.message : 'Something went wrong');
    } finally { setBusy(''); }
  };

  const patch = (body: Partial<Pick<CaseItem, 'title' | 'description' | 'allowDownload' | 'published'>>, label: string) => run(label, async () => {
    const response = await adminApi<{ case: CaseItem }>(`cases/${item.id}`, { method: 'PATCH', body });
    onChange(response.case);
  });

  const replace = (file: File | undefined) => {
    const result = pickPdf(file, maxBytes);
    if (result.error) { setError(result.error); return; }
    if (!result.file) return;
    const chosen = result.file;
    void run('replace', async () => {
      const form = new FormData();
      form.set('file', chosen, chosen.name);
      const response = await uploadForm<{ case: CaseItem }>(`cases/${item.id}/file`, form, () => undefined);
      onChange(response.case);
    });
    if (replaceInput.current) replaceInput.current.value = '';
  };

  const remove = () => {
    if (!window.confirm(`Delete "${item.title}"? The link will stop working and the PDF is removed. This cannot be undone.`)) return;
    void run('delete', async () => {
      await adminApi(`cases/${item.id}`, { method: 'DELETE' });
      onRemove(item.id);
    });
  };

  const saveEdit = async (event: FormEvent) => {
    event.preventDefault();
    await patch({ title, description }, 'edit');
    setEditing(false);
  };

  return (
    <li className={styles.caseRow} data-hidden={!item.published || undefined}>
      <div className={styles.rowHead}>
        <div className={styles.rowTitle}>
          <h3>{item.title}</h3>
          <p className={styles.rowMeta}>{item.fileName} · {formatBytes(item.size)} · Updated {formatDate(item.updatedAt)}{item.createdBy ? ` · by ${item.createdBy}` : ''}</p>
        </div>
        <div className={styles.chips}>
          <span className={styles.chip} data-tone={item.published ? 'ok' : 'muted'}>{item.published ? 'Live' : 'Hidden'}</span>
          <span className={styles.chip} data-tone={item.allowDownload ? 'ok' : 'warn'}>{item.allowDownload ? 'Download on' : 'View only'}</span>
        </div>
      </div>

      {item.description && !editing && <p className={styles.rowText}>{item.description}</p>}

      {editing && (
        <form className={styles.editForm} onSubmit={saveEdit}>
          <label className={styles.field}><span>Title</span><input value={title} onChange={event => setTitle(event.target.value)} maxLength={140} required /></label>
          <label className={styles.field}><span>Note for participants</span><textarea value={description} onChange={event => setDescription(event.target.value)} maxLength={2000} rows={3} /></label>
          <div className={styles.actions}>
            <button type="submit" className={styles.primary} disabled={Boolean(busy)}>{busy === 'edit' ? 'Saving…' : 'Save'}</button>
            <button type="button" className={styles.secondary} onClick={() => { setEditing(false); setTitle(item.title); setDescription(item.description); }}>Cancel</button>
          </div>
        </form>
      )}

      <ShareLink item={item} />

      <div className={styles.rowFoot}>
        <span className={styles.rowStats}><b>{item.views}</b> views · <b>{item.downloads}</b> downloads</span>
        <div className={styles.actions}>
          <a className={styles.secondary} href={caseLink(item.slug)} target="_blank" rel="noopener">Open</a>
          <button type="button" className={styles.secondary} onClick={() => setEditing(value => !value)} disabled={Boolean(busy)}>Edit</button>
          <button type="button" className={styles.secondary} onClick={() => replaceInput.current?.click()} disabled={Boolean(busy)}>{busy === 'replace' ? 'Replacing…' : 'Replace PDF'}</button>
          <input ref={replaceInput} type="file" accept="application/pdf,.pdf" hidden onChange={event => replace(event.target.files?.[0])} />
          <button type="button" className={styles.secondary} onClick={() => patch({ allowDownload: !item.allowDownload }, 'download')} disabled={Boolean(busy)}>
            {item.allowDownload ? 'Turn off download' : 'Allow download'}
          </button>
          <button type="button" className={styles.secondary} onClick={() => patch({ published: !item.published }, 'publish')} disabled={Boolean(busy)}>
            {item.published ? 'Hide link' : 'Make live'}
          </button>
          <button type="button" className={styles.danger} onClick={remove} disabled={Boolean(busy)}>{busy === 'delete' ? 'Deleting…' : 'Delete'}</button>
        </div>
      </div>
      {error && <p className={styles.errorText} role="alert">{error}</p>}
    </li>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      await adminApi('login', { method: 'POST', body: { username: form.get('username'), password: form.get('password') } });
      onDone();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not sign in');
      setBusy(false);
    }
  }

  return (
    <div className={`${styles.adminApp} ${styles.loginScreen}`}>
      <form className={styles.loginCard} onSubmit={submit}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/mibc-logo.webp" alt="MIBC" width={84} height={61} />
        <h1>Case desk</h1>
        <p>Sign in with your ticket desk organizer ID to upload and share case files.</p>
        <label className={styles.field}>
          <span>Organizer ID</span>
          <input name="username" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required />
        </label>
        <label className={styles.field}>
          <span>Password</span>
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        {error && <p className={styles.errorText} role="alert">{error}</p>}
        <button type="submit" className={styles.primary} disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
