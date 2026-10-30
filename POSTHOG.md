# PostHog analytics

The public website sends anonymous page views and `registration_clicked` events
to the NSU MIBC project in the US region. Registration events include `placement`
(`header`, `hero`, or `closing`) and the Google Form destination. They measure
outbound clicks, not completed Google Form submissions.

`instrumentation-client.ts` initializes the official `posthog-js` SDK on the
production domain only. Local previews do not send analytics. Session recording,
surveys, and automatic element capture are disabled. Do Not Track is respected.
No registration responses or personal details are collected by this integration.

The project token is a public browser ingestion token, safe to ship in JavaScript.
Never replace it with a personal API key. Builds can override the public defaults
using `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` and `NEXT_PUBLIC_POSTHOG_HOST` in
Cloudflare's build environment. These values are compiled into the static export,
so changing them requires a rebuild.

## Installation checklist

- SDK and production initialization: installed.
- Page views: automatically captured by the SDK.
- Registration links: custom click event with placement, using sendBeacon without
  blocking navigation.
- Account verification: open the live site without Do Not Track or a tracking
  blocker, then check PostHog's installation verification and Activity feed.
- In PostHog, create an insight counting `registration_clicked`, broken down by
  `placement`, and a funnel from `$pageview` to `registration_clicked`.
- Google Form completion tracking requires a separate integration with the form;
  a button click must not be reported as a completed registration.
