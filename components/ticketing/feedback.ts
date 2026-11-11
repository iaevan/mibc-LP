// iPhones have no vibration API for the web, so a short tone confirms each scan.
// Audio must be unlocked by a tap, which happens on the Open camera button.
let audio: AudioContext | null = null;

export function unlockAudio() {
  try {
    const Context = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    audio ??= new Context();
    if (audio.state === 'suspended') void audio.resume();
  } catch {
    audio = null;
  }
}

function tone(frequency: number, start: number, duration: number, type: OscillatorType = 'sine', volume = 0.18) {
  if (!audio) return;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  const at = audio.currentTime + start;
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(volume, at + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start(at);
  oscillator.stop(at + duration + 0.02);
}

export function signal(kind: 'checked_in' | 'already' | 'not_found') {
  try {
    if (audio?.state === 'suspended') void audio.resume();
    if (kind === 'checked_in') { tone(988, 0, 0.11); tone(1319, 0.1, 0.16); }
    else if (kind === 'already') { tone(660, 0, 0.12); tone(660, 0.17, 0.12); }
    else tone(196, 0, 0.32, 'square', 0.12);
    navigator.vibrate?.(kind === 'checked_in' ? 60 : [80, 60, 80]);
  } catch {
    // Feedback is optional.
  }
}

type WakeLockSentinelLike = { release: () => Promise<void> };
let wakeLock: WakeLockSentinelLike | null = null;

export async function keepScreenOn() {
  try {
    const lock = (navigator as unknown as { wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> } }).wakeLock;
    if (lock && document.visibilityState === 'visible') wakeLock = await lock.request('screen');
  } catch {
    wakeLock = null;
  }
}

export function releaseScreen() {
  void wakeLock?.release().catch(() => undefined);
  wakeLock = null;
}
