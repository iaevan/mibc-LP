'use client';

import jsQR from 'jsqr';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { keepScreenOn, releaseScreen, unlockAudio } from './feedback';
import styles from './ticketing.module.css';

type Detector = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> };

const SCAN_INTERVAL = 60; // ms between decode attempts, about 16 per second.

async function nativeDetector(): Promise<Detector | null> {
  const Native = (window as unknown as {
    BarcodeDetector?: { new(options: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> };
  }).BarcodeDetector;
  if (!Native) return null;
  try {
    const formats = await Native.getSupportedFormats?.();
    if (formats && !formats.includes('qr_code')) return null;
    return new Native({ formats: ['qr_code'] });
  } catch {
    return null;
  }
}

function cameraError(error: unknown) {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera access was blocked. On iPhone open Settings > Safari > Camera, choose Allow, then reload this page.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found on this device.';
  if (name === 'NotReadableError') return 'The camera is busy in another app. Close it and try again.';
  return 'The camera could not start. Reload the page and try again.';
}

export function Scanner({ active, onDecode, children }: { active: boolean; onDecode: (text: string) => void; children?: ReactNode }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const activeRef = useRef(active);
  const onDecodeRef = useRef(onDecode);
  const wantedRef = useRef(false);
  const [state, setState] = useState<'idle' | 'starting' | 'running' | 'error'>('idle');
  const [error, setError] = useState('');

  useEffect(() => { onDecodeRef.current = onDecode; }, [onDecode]);
  useEffect(() => { activeRef.current = active; }, [active]);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    releaseScreen();
  }, []);

  const loop = useCallback(async (video: HTMLVideoElement, stream: MediaStream) => {
    const detector = await nativeDetector();
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    let busy = false;
    let last = 0;
    let useNative = Boolean(detector);

    const decode = async () => {
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height) return null;
      if (useNative && detector) {
        try {
          const codes = await detector.detect(video);
          return codes[0]?.rawValue ?? null;
        } catch {
          useNative = false;
        }
      }
      if (!context) return null;
      // Decode only the centre square, where the guide frame is. Fewer pixels is faster.
      const side = Math.round(Math.min(width, height) * 0.82);
      const target = Math.min(side, 640);
      if (canvas.width !== target) { canvas.width = target; canvas.height = target; }
      context.drawImage(video, (width - side) / 2, (height - side) / 2, side, side, 0, 0, target, target);
      const image = context.getImageData(0, 0, target, target);
      return jsQR(image.data, target, target, { inversionAttempts: 'dontInvert' })?.data ?? null;
    };

    const schedule = () => {
      if (streamRef.current !== stream) return;
      if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(step);
      else requestAnimationFrame(step);
    };

    function step() {
      if (streamRef.current !== stream) return;
      schedule();
      const now = performance.now();
      if (busy || !activeRef.current || now - last < SCAN_INTERVAL || video.readyState < 2) return;
      last = now;
      busy = true;
      decode()
        .then(text => { if (text && streamRef.current === stream) onDecodeRef.current(text); })
        .catch(() => undefined)
        .finally(() => { busy = false; });
    }

    schedule();
  }, []);

  const start = useCallback(async () => {
    unlockAudio();
    wantedRef.current = true;
    setError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setState('error');
      setError('This browser cannot open the camera. Use Safari or Chrome on a secure https link.');
      return;
    }
    setState('starting');
    stop();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      const video = videoRef.current;
      if (!video) { stream.getTracks().forEach(track => track.stop()); return; }
      streamRef.current = stream;
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      setState('running');
      void keepScreenOn();
      void loop(video, stream);
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (streamRef.current === stream && wantedRef.current && document.visibilityState === 'visible') void start();
      });
    } catch (problem) {
      stop();
      setState('error');
      setError(cameraError(problem));
    }
  }, [loop, stop]);

  // iOS stops the camera when the app is in the background. Bring it back on return.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !wantedRef.current) return;
      const track = streamRef.current?.getVideoTracks()[0];
      if (!track || track.readyState === 'ended') void start();
      else { void videoRef.current?.play().catch(() => undefined); void keepScreenOn(); }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [start]);

  useEffect(() => () => { wantedRef.current = false; stop(); }, [stop]);

  return (
    <div className={styles.scanner} data-state={state}>
      <video ref={videoRef} className={styles.video} playsInline muted autoPlay aria-label="Camera preview" />
      {state === 'running' && <div className={styles.frame} aria-hidden="true"><span /><span /><span /><span /></div>}
      {state !== 'running' && (
        <div className={styles.cameraPrompt}>
          <div className={styles.cameraIcon} aria-hidden="true">
            <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" /><rect x="7" y="7" width="4" height="4" /><rect x="13" y="13" width="4" height="4" /><path d="M13 7h4v2M7 15v2h2" /></svg>
          </div>
          <h2>Scan tickets</h2>
          <p>Point the camera at a ticket QR code. Each person is checked in once, and repeat scans are flagged.</p>
          <button type="button" className={styles.primary} onClick={start} disabled={state === 'starting'}>
            {state === 'starting' ? 'Opening camera…' : 'Open camera'}
          </button>
          {error && <p className={styles.errorText} role="alert">{error}</p>}
        </div>
      )}
      {children}
    </div>
  );
}
