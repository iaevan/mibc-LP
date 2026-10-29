# Beyond the Ordinary: MIBC Recruitment

## Current live version

Only the Signal layout at `/` is published. The other four layouts are retained in `archive/layouts/` and are not exported or available on the live site. The layout switcher has been removed. The supplied official club logo is used in the header and footer, with phone navigation, readable content, and a compact single-column recruitment flow.

The sections below describe the original five-layout concept collection.

Five complete, responsive recruitment landing pages for the **Marketing and International Business Club of North South University**. Built in Next.js with a static export, original campaign copy, local fonts, and one generated artwork.

Live website: https://nsumibc.online/

## Social link previews

The current Recruitment 10.0 page uses `public/og/mibc-recruitment-10-v2.jpg` for Open Graph previews and X's large-image card. The image is a public 1200×630 JPEG with a prominent “Join the recruitment” call to action. `app/layout.tsx` defines the production URL, canonical link, preview title, description, image dimensions, and image alt text. These tags are included in static HTML, so preview crawlers do not need JavaScript.

The generated artwork's exact prompt is in `docs/og-image-v2-prompt.txt`. Keep future image filenames versioned and update both Open Graph and X metadata when replacing the artwork. Social apps cache previews independently; an already-shared URL may need a fresh scrape or platform cache refresh. Search indexing remains disabled while the registration form is a placeholder; `robots.txt` permits fetching the public page and image assets.

## Preview the five layouts

| Layout | Route | Direction |
| --- | --- | --- |
| Signal | `/` | Cinematic burgundy, a crimson glass sculpture, and angular linework |
| Edition | `/edition/` | Warm paper, magazine typography, and an interactive campaign poster |
| Orbit | `/orbit/` | Dark atlas, an interactive dotted globe, and topic controls |
| Studio | `/studio/` | Bold coral, oversized typography, paper artifacts, and discipline accordions |
| Invitation | `/invitation/` | Burgundy and ivory, a sticky invitation panel, and a personal letter |

A floating navigator switches between the five concepts. Every final application button links to **https://forms.google.com**.

## Run locally

```sh
npm install
npm run dev
```

Open http://localhost:3000. For a production preview:

```sh
npm run build
npm start
```

`npm run typecheck` checks TypeScript. The build produces the complete static website in `out/`.

## Deploy to Cloudflare Workers

The project is configured as the **mibc-recruitment** Worker in `wrangler.jsonc`. With Wrangler logged in to the configured account, deploy all five pages with:

```sh
npm run deploy
```

This builds the Next.js static export and uploads `out/` using the project’s local Wrangler installation. Direct page links use trailing slashes, and unknown routes return the exported 404 page. For a local Cloudflare preview, run `npm run build` followed by `npm run cloudflare:dev`.

The Worker serves static assets directly and does not require secrets, environment variables, or a server adapter. Generate configuration types after changing Wrangler settings with `npx wrangler types --include-runtime false`.

Official reference: https://developers.cloudflare.com/workers/static-assets/get-started/

### Alternative: Cloudflare Pages

For **Cloudflare Pages**, choose the Next.js Static HTML Export preset, use `npm run build` as the build command, and set `out` as the output directory. No environment variables, database, API keys, or server runtime are required.

This project uses no request-time Next.js features.

Official reference: https://developers.cloudflare.com/pages/framework-guides/nextjs/deploy-a-static-nextjs-site/

## Change the recruitment details

- `lib/content.ts` holds the **FORM_URL**, FAQs, discipline copy, and layout links. Change FORM_URL once to update all application links.
- `app/page.tsx`, `app/edition/page.tsx`, `app/orbit/page.tsx`, `app/studio/page.tsx`, and `app/invitation/page.tsx` hold each page’s original content.
- `components/club-program.tsx` holds the three recruitment steps and four researched MIBC event summaries; `docs/event-sources.md` records their sources.
- `app/globals.css` holds the shared system and five scoped themes.
- `app/layout.tsx` holds shared metadata. Search indexing is disabled for these concept previews; change its robots setting when you select and publish a final page.

**Beyond the Ordinary** is the proposed recruitment event name. Dates, official eligibility requirements, and recruitment deadlines were deliberately left out because they were not supplied. The drawn wordmark is a typographic concept; the original reference’s sponsor marks were not reused as current endorsements.

## Motion, accessibility, and performance

Pages render to static HTML. Fonts and images are hosted locally. Animation uses CSS and the browser’s Web Animations API rather than a motion framework. Native scrolling, semantic landmarks, visible keyboard focus, a skip link, native FAQ details, reduced-motion and reduced-transparency preferences are supported. Content and application links remain usable with JavaScript disabled.

The globe responds to scrolling with rotation, tilt, and a travelling orbital point. Pointer capture keeps dragging continuous; release uses a critically damped spring. Its arrow buttons provide a keyboard alternative. Animation settles when input stops, and the fallback globe remains visible without JavaScript.

On phones, recruitment panels pin and stack as the next step approaches, with earlier panels scaling back. Event headings and linework respond to scrolling. The stack activates only when the cards fit the viewport; short screens and reduced-motion settings retain a normal reading flow.

The single generated crimson sculpture is in `public/images/crimson-knot.webp`, about 164 KB. It was created with the built-in ImageGen tool; its full prompt is in `docs/artwork-prompt.txt` and the image’s provenance sidecar. Geometric motifs and paper artifacts are drawn in code. DM Sans, Space Grotesk, and Instrument Serif are served as local WOFF2 files; their open font licenses are included under `public/fonts/`.

The supplied reference informed the burgundy/crimson palette and faceted linework. No club statistics, member testimonials, event dates, or sponsor endorsements were invented.
