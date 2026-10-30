import posthog from 'posthog-js';
import { FORM_URL } from './lib/content';

// These are public ingestion settings, not a personal or management API key.
// Defaults keep GitHub/Cloudflare static builds connected to the same project.
const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN || 'phc_DbtF2v2rM5f4jj4quFvWzDebRTytBxvbhKNsLvgc2Zim';
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';

if (['nsumibc.online', 'www.nsumibc.online'].includes(window.location.hostname)) {
  posthog.init(token, {
    api_host: host,
    defaults: '2026-08-30',
    person_profiles: 'identified_only',
    autocapture: false,
    disable_session_recording: true,
    disable_surveys: true,
    respect_dnt: true,
    persistence: 'localStorage',
  });

  document.addEventListener('click', event => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const link = target.closest('a');
    if (!link || link.href !== FORM_URL) return;
    const placement = link.closest('header') ? 'header'
      : link.closest('.signal-hero') ? 'hero' : 'closing';
    // Send immediately without delaying or preventing the Google Form navigation.
    posthog.capture('registration_clicked', { placement, destination: FORM_URL }, {
      transport: 'sendBeacon',
      send_instantly: true,
    });
  }, { capture: true });
}
