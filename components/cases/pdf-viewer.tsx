'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import styles from './cases.module.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
// pdf.js is served from /pdfjs (copied from the pdfjs-dist package) and loaded only on this page.
type PdfDoc = { numPages: number; getPage(n: number): Promise<any>; destroy(): Promise<void> };
type PageSize = { width: number; height: number };

// Files in this folder are cached for a year. Upgrade pdf.js into a new version
// folder and update this path and the preload link in worker/cases.mjs.
const PDFJS_BASE = '/pdfjs/6.5.438/';
const PDFJS_SRC = `${PDFJS_BASE}pdf.min.mjs`;
let pdfjsPromise: Promise<{ lib: any; worker: any }> | null = null;

// Loads pdf.js and starts its worker thread. Call it as early as possible so this
// happens while the PDF is still downloading.
export function warmPdfjs() {
  pdfjsPromise ??= import(/* webpackIgnore: true */ /* turbopackIgnore: true */ PDFJS_SRC).then(lib => {
    lib.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}pdf.worker.min.mjs`;
    return { lib, worker: new lib.PDFWorker({ name: 'case-viewer' }) };
  }).catch(error => { pdfjsPromise = null; throw error; });
  return pdfjsPromise;
}

type Download = { promise: Promise<ArrayBuffer>; listeners: Set<(fraction: number) => void>; fraction: number };
const downloads = new Map<string, Download>();

// Fetches the whole PDF once. The page's <link rel="preload"> has usually started
// this request already, and fetch() picks up that response instead of a new one.
export function prefetchPdf(url: string): Download {
  const existing = downloads.get(url);
  if (existing) return existing;
  const entry: Download = { promise: Promise.resolve(new ArrayBuffer(0)), listeners: new Set(), fraction: 0 };
  entry.promise = (async () => {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(response.status === 404 ? 'Missing PDF' : `Download failed (${response.status})`);
    const total = Number(response.headers.get('content-length')) || 0;
    if (!response.body || !total) return response.arrayBuffer();
    const reader = response.body.getReader();
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.length > bytes.length) return new Blob([bytes.subarray(0, offset), value]).arrayBuffer(); // Size was wrong; stop counting.
      bytes.set(value, offset);
      offset += value.length;
      entry.fraction = offset / total;
      entry.listeners.forEach(listener => listener(entry.fraction));
    }
    return bytes.buffer.slice(0, offset);
  })();
  entry.promise.catch(() => downloads.delete(url));
  downloads.set(url, entry);
  return entry;
}

const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const MAX_FIT_WIDTH = 960; // Pages stop growing past this width at 100%.
const GAP = 14;

export function PdfViewer({ url, title, toolbarEnd, intro }: { url: string; title: string; toolbarEnd?: ReactNode; intro?: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [sizes, setSizes] = useState<PageSize[]>([]);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [fullscreen, setFullscreen] = useState(false);
  const [canFullscreen, setCanFullscreen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let loaded: PdfDoc | null = null;
    setDoc(null); setSizes([]); setError(''); setProgress(0);
    const download = prefetchPdf(url);
    const onProgress = (fraction: number) => setProgress(fraction);
    download.listeners.add(onProgress);
    setProgress(download.fraction);
    (async () => {
      try {
        // The PDF, pdf.js and its worker all load at the same time.
        const [{ lib, worker }, data] = await Promise.all([warmPdfjs(), download.promise]);
        downloads.delete(url); // pdf.js takes over the bytes, so they cannot be reused.
        if (cancelled) return;
        const task = lib.getDocument({
          data,
          worker,
          standardFontDataUrl: `${PDFJS_BASE}standard_fonts/`,
          wasmUrl: `${PDFJS_BASE}wasm/`,
          isEvalSupported: false,
        });
        loaded = await task.promise as PdfDoc;
        if (cancelled) return;
        // Show the document as soon as page 1 is known. Other pages take page 1's
        // size until their own is read, which happens in the background.
        const first = (await loaded.getPage(1)).getViewport({ scale: 1 });
        if (cancelled) return;
        const guess = { width: first.width, height: first.height };
        setSizes(Array.from({ length: loaded.numPages }, () => guess));
        setDoc(loaded);
        const found: PageSize[] = [guess];
        for (let number = 2; number <= loaded.numPages; number += 1) {
          const view = (await loaded.getPage(number)).getViewport({ scale: 1 });
          if (cancelled) return;
          found.push({ width: view.width, height: view.height });
        }
        if (found.some(size => size.width !== guess.width || size.height !== guess.height)) setSizes(found);
      } catch (problem) {
        if (!cancelled) setError(problem instanceof Error && /Missing PDF|Unexpected server response \(404\)/.test(problem.message)
          ? 'This case file could not be found.' : 'The case could not be opened here. Try the download button, or refresh the page.');
      }
    })();
    return () => {
      cancelled = true;
      download.listeners.delete(onProgress);
      // Destroying the document would also stop the shared worker, so only release its pages.
      if (loaded) void (loaded as any).cleanup?.();
    };
  }, [url]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setCanFullscreen(Boolean(document.fullscreenEnabled));
    const change = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', change);
    return () => document.removeEventListener('fullscreenchange', change);
  }, []);

  const widest = sizes.reduce((max, size) => Math.max(max, size.width), 0) || 612;
  const fitWidth = Math.max(200, Math.min(width - (width < 640 ? 16 : 48), MAX_FIT_WIDTH));
  const scale = (fitWidth / widest) * zoom;

  const scrollToPage = useCallback((target: number) => {
    const element = scrollRef.current?.querySelector<HTMLElement>(`[data-page="${target}"]`);
    if (!element || !scrollRef.current) return;
    scrollRef.current.scrollTo({ top: element.offsetTop - 12 });
    setPage(target);
  }, []);

  // Keep the same spot in view when the zoom changes.
  const changeZoom = useCallback((next: number) => {
    const element = scrollRef.current;
    if (!element) return setZoom(next);
    const ratio = (element.scrollTop + element.clientHeight / 2) / Math.max(1, element.scrollHeight);
    setZoom(next);
    requestAnimationFrame(() => {
      element.scrollTop = ratio * element.scrollHeight - element.clientHeight / 2;
      element.scrollLeft = (element.scrollWidth - element.clientWidth) / 2;
    });
  }, []);
  const zoomIn = useCallback(() => changeZoom(ZOOM_STEPS.find(step => step > zoom + 0.001) ?? zoom), [changeZoom, zoom]);
  const zoomOut = useCallback(() => changeZoom([...ZOOM_STEPS].reverse().find(step => step < zoom - 0.001) ?? zoom), [changeZoom, zoom]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !sizes.length) return;
    const onScroll = () => {
      const line = element.scrollTop + element.clientHeight * 0.35;
      let current = 1;
      for (const node of element.querySelectorAll<HTMLElement>('[data-page]')) {
        if (node.offsetTop <= line) current = Number(node.dataset.page);
        else break;
      }
      setPage(current);
    };
    onScroll();
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => element.removeEventListener('scroll', onScroll);
  }, [sizes.length, scale]);

  useEffect(() => { setPageInput(String(page)); }, [page]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if ((event.ctrlKey || event.metaKey) && (event.key === '=' || event.key === '+')) { event.preventDefault(); zoomIn(); }
      else if ((event.ctrlKey || event.metaKey) && event.key === '-') { event.preventDefault(); zoomOut(); }
      else if ((event.ctrlKey || event.metaKey) && event.key === '0') { event.preventDefault(); changeZoom(1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomIn, zoomOut, changeZoom]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen().catch(() => undefined);
  };

  const total = sizes.length;
  const goTo = (value: string) => {
    const target = Math.round(Number(value));
    if (target >= 1 && target <= total) scrollToPage(target);
    else setPageInput(String(page));
  };

  return (
    <div ref={rootRef} className={styles.viewerRoot}>
      <div className={styles.toolbar} role="toolbar" aria-label={`${title} viewer controls`}>
        <div className={styles.toolGroup}>
          <button type="button" className={styles.iconButton} onClick={() => scrollToPage(Math.max(1, page - 1))} disabled={!total || page <= 1} aria-label="Previous page">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
          </button>
          <label className={styles.pageField}>
            <span className={styles.srOnly}>Page</span>
            <input
              inputMode="numeric"
              value={pageInput}
              disabled={!total}
              onChange={event => setPageInput(event.target.value.replace(/\D/g, '').slice(0, 4))}
              onBlur={event => goTo(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') goTo(event.currentTarget.value); }}
              aria-label={`Page number, ${total} pages`}
            />
            <span aria-hidden="true">/ {total || '–'}</span>
          </label>
          <button type="button" className={styles.iconButton} onClick={() => scrollToPage(Math.min(total, page + 1))} disabled={!total || page >= total} aria-label="Next page">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
          </button>
        </div>
        <div className={styles.toolGroup}>
          <button type="button" className={styles.iconButton} onClick={zoomOut} disabled={zoom <= ZOOM_STEPS[0]} aria-label="Zoom out">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg>
          </button>
          <button type="button" className={styles.zoomLabel} onClick={() => changeZoom(1)} aria-label={`Zoom ${Math.round(zoom * 100)} percent. Reset to fit width`} title="Fit to width">
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" className={styles.iconButton} onClick={zoomIn} disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]} aria-label="Zoom in">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          </button>
          {canFullscreen && (
            <button type="button" className={`${styles.iconButton} ${styles.hideSmall}`} onClick={toggleFullscreen} aria-label={fullscreen ? 'Exit full screen' : 'Full screen'} aria-pressed={fullscreen}>
              {fullscreen
                ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></svg>
                : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>}
            </button>
          )}
        </div>
        {toolbarEnd && <div className={`${styles.toolGroup} ${styles.toolEnd}`}>{toolbarEnd}</div>}
      </div>

      <div ref={scrollRef} className={styles.pages} data-scroll-root="" tabIndex={0} aria-label={`${title}, ${total} pages`}>
        {intro}
        {error ? (
          <div className={styles.viewerMessage} role="alert">{error}</div>
        ) : !doc ? (
          <div className={styles.viewerMessage} role="status">
            <span>Loading case{progress > 0 ? ` ${Math.round(progress * 100)}%` : '…'}</span>
            <span className={styles.loadBar}><span style={{ width: `${Math.max(4, progress * 100)}%` }} /></span>
          </div>
        ) : (
          sizes.map((size, index) => (
            <PdfPage key={index} doc={doc} number={index + 1} size={size} scale={scale} />
          ))
        )}
      </div>
    </div>
  );
}

function PdfPage({ doc, number, size, scale }: { doc: PdfDoc; number: number; size: PageSize; scale: number }) {
  const holder = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);
  const [rendered, setRendered] = useState(false);
  const drawnOnce = useRef(false);
  const cssWidth = Math.floor(size.width * scale);
  const cssHeight = Math.floor(size.height * scale);

  useEffect(() => {
    const element = holder.current;
    if (!element) return;
    // Several records can arrive at once for one element; the last is the current state.
    const observer = new IntersectionObserver(entries => setNear(entries[entries.length - 1].isIntersecting), {
      root: element.closest('[data-scroll-root]'),
      rootMargin: '1200px 600px',
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!near) { setRendered(false); return; }
    let task: { promise: Promise<void>; cancel(): void } | null = null;
    let cancelled = false;
    // The first draw starts at once. After that, wait a moment so quick zoom clicks render once, at the final size.
    const timer = setTimeout(async () => {
      try {
        const pdfPage = await doc.getPage(number);
        if (cancelled || !canvasRef.current) return;
        const ratio = Math.min(window.devicePixelRatio || 1, 2.5);
        const viewport = pdfPage.getViewport({ scale: scale * ratio });
        const canvas = canvasRef.current;
        // Very large canvases fail on phones, so cap the pixel count.
        const limit = 16_000_000;
        const shrink = Math.min(1, Math.sqrt(limit / (viewport.width * viewport.height)));
        const finalViewport = shrink < 1 ? pdfPage.getViewport({ scale: scale * ratio * shrink }) : viewport;
        const offscreen = document.createElement('canvas');
        offscreen.width = Math.floor(finalViewport.width);
        offscreen.height = Math.floor(finalViewport.height);
        task = pdfPage.render({ canvas: offscreen, viewport: finalViewport });
        await task!.promise;
        if (cancelled) return;
        canvas.width = offscreen.width;
        canvas.height = offscreen.height;
        canvas.getContext('2d')?.drawImage(offscreen, 0, 0);
        setRendered(true);
        drawnOnce.current = true;
      } catch { /* A cancelled render throws; the next effect run draws again. */ }
    }, drawnOnce.current ? 60 : 0);
    return () => { cancelled = true; clearTimeout(timer); task?.cancel(); };
  }, [doc, near, number, scale]);

  useEffect(() => {
    if (near || !canvasRef.current) return;
    // Free memory for pages far from view.
    canvasRef.current.width = 0;
    canvasRef.current.height = 0;
  }, [near]);

  return (
    <div ref={holder} className={styles.page} data-page={number} style={{ width: cssWidth, height: cssHeight, marginBottom: GAP }} aria-label={`Page ${number}`} role="img">
      <canvas ref={canvasRef} style={{ width: cssWidth, height: cssHeight }} />
      {!rendered && <span className={styles.pageNumber}>{number}</span>}
    </div>
  );
}
