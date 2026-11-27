'use client';

import { useEffect, useState } from 'react';
import { ApiError, caseFileUrl, formatBytes, publicCase, type PublicCase } from './api';
import { PdfViewer, prefetchPdf, warmPdfjs } from './pdf-viewer';
import styles from './cases.module.css';

type InlineCase = { case?: PublicCase; error?: string };
let inlineCache: InlineCase | null | undefined;
function readInlineCase(): InlineCase | null {
  if (inlineCache !== undefined) return inlineCache;
  try { inlineCache = JSON.parse(document.getElementById('case-data')?.textContent || 'null'); } catch { inlineCache = null; }
  return inlineCache ?? null;
}

// Runs as soon as this code loads, before React draws anything, so the PDF and
// the pdf.js code are already on their way.
if (typeof window !== 'undefined' && window.location.pathname.startsWith('/case/')) {
  const inline = readInlineCase();
  if (inline?.case) prefetchPdf(caseFileUrl(inline.case));
  void warmPdfjs().catch(() => undefined);
}

function slugFromPath() {
  const match = window.location.pathname.match(/^\/case\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

export function CaseViewer() {
  const [item, setItem] = useState<PublicCase | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const show = (found: PublicCase) => setItem(found);
    // The server puts the case details in the page, so no extra request is needed.
    const inline = readInlineCase();
    if (inline?.case) { show(inline.case); return; }
    if (inline?.error) { setError(inline.error); return; }
    const slug = slugFromPath();
    if (!slug) { setError('Open the case link the organizers shared with you.'); return; }
    publicCase(slug)
      .then(found => { prefetchPdf(caseFileUrl(found)); show(found); })
      .catch(problem => setError(problem instanceof ApiError ? problem.message : 'The case could not be loaded.'));
  }, []);

  // The server already wrote the case title into the page, but Next.js puts the
  // static "Case" title back after it starts, so keep the case title in place.
  useEffect(() => {
    if (!item) return;
    const wanted = `${item.title} | NSU MIBC`;
    const keep = () => { if (document.title !== wanted) document.title = wanted; };
    keep();
    const observer = new MutationObserver(keep);
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, [item]);

  if (error) {
    return (
      <div className={styles.caseApp}>
        <CaseHeader title="Case" />
        <div className={styles.emptyState}>
          <h1>Case not available</h1>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!item) {
    return (
      <div className={styles.caseApp}>
        <CaseHeader title="Loading case…" />
        <div className={styles.emptyState} role="status"><p>Loading…</p></div>
      </div>
    );
  }

  const fileUrl = caseFileUrl(item);
  const download = item.allowDownload ? (
    <a className={styles.downloadButton} href={caseFileUrl(item, true)} download={item.fileName}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
      <span>Download</span>
    </a>
  ) : null;

  return (
    <div className={styles.caseApp}>
      <CaseHeader title={item.title} action={download} />
      <PdfViewer
        url={fileUrl}
        title={item.title}
        toolbarEnd={item.allowDownload ? (
          <a className={`${styles.iconButton} ${styles.hideSmall}`} href={fileUrl} target="_blank" rel="noopener" aria-label="Open PDF in a new tab" title="Open in a new tab">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
          </a>
        ) : undefined}
        intro={(
          <section className={styles.intro} aria-label="About this case">
            <span className={styles.kicker}>Case document</span>
            <h1>{item.title}</h1>
            {item.description && <p className={styles.introText}>{item.description}</p>}
            <p className={styles.introMeta}>
              PDF · {formatBytes(item.size)}
              {item.allowDownload ? '' : ' · View only'}
            </p>
          </section>
        )}
      />
    </div>
  );
}

function CaseHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <header className={styles.caseHeader}>
      <a href="/" className={styles.brand} aria-label="NSU MIBC home">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/mibc-logo.webp" alt="" width={48} height={35} />
      </a>
      <div className={styles.headerTitle}>
        <span className={styles.kicker}>NSU MIBC</span>
        <strong title={title}>{title}</strong>
      </div>
      {action}
    </header>
  );
}
