# MIBC: five recruitment worlds

Seed: b9cf57a2. Mode: Persuade. The brief explicitly requests five built alternatives, so the decision deliverable is all five working pages, rather than an intermediate selection board. The reference's burgundy, crimson and faceted geometry remain recognizable throughout. The original request authorizes invented recruitment copy.

Grounded candidates, ordered by audience resonance: campaign sculpture; student editorial; global network; creative workshop; portfolio exhibition; campus campaign wall; private invitation. The roll assigned candidate 7, represented fully by Invitation; the user-requested set also builds the first four.

## First viewport

- Signal (/): burgundy cinematic campaign. A broad two-line cream headline anchors the left, a large crimson sculpture reaches into the right. The club identity and join action are immediately visible. A fine white angular network echoes the supplied poster.
- Edition (/edition): warm ivory magazine. Asymmetric masthead, serif editorial headline, red typographic poster, running marginal captions, rule-led prose. A page that reads like a campus culture publication.
- Orbit (/orbit): dark technical atlas. A luminous dotted globe is the central visual, with concise flanking recruitment copy. Visitors can turn the globe and select a theme; no fabricated locations or reach statistics.
- Studio (/studio): bold crimson creative canvas. Oversized black typographic composition and rotated cream campaign artifacts, an animated typographic stamp, and an expandable discipline list.
- Invitation (/invitation): split burgundy/ivory letter. A sticky left invitation and a composed reading column on the right. The final Google Forms action closes a physical-feeling letter.

## Visitor path

Each page contains a complete introduction, concrete skills/activities, membership expectations, a short recruitment path, accessible FAQs, and a strong final action to https://forms.google.com. No event dates, numeric claims, alumni endorsements or invented sponsors.

## Signature interactions

Signal's sculpture has one finite entrance. Edition uses a changing typographic poster on hover/focus. Orbit uses a bounded drag-responsive dot globe and topic tabs. Studio exposes details through large accordion rows. Invitation opens native details and has a closing seal. All pages share a small fixed layout navigator, allowing easy comparison of the five designs.

## Performance and accessibility

Server-rendered static HTML, route-level layouts, local fonts, one compressed generated image, no animation framework, native scrolling, IntersectionObserver for bounded prose motion, compositor-friendly feedback, no autoplay video. Reduced-motion and transparency preferences are honored. Every route works without JavaScript, including its final CTA and FAQ. Globe falls back to a static graphic description.

## Challenger verdicts and raises

Drum machine: declined on clarity and audience identification. Kept: immediately legible active controls for the layout switcher. Minihompy: declined on clarity; kept: a human invitation to make space for one's own identity. Bioluminescence: declined on product clarity, competitive on expressive ambition; kept: restrained light on the Orbit dots. Glaze shelf: declined on both; kept: larger visual quiet between major passages. Pop sleeve: competitive on audience identification; Studio takes full graphic confidence with the user-pinned burgundy/red palette. Factory catalog: competitive on visual discipline; Edition uses firm rules and consistent typographic roles, while keeping descriptive navigation.

## Open decisions

Official recruitment campaign name, final dates, eligibility and form URL remain editable. The program uses the four researched MIBC events in `docs/event-sources.md` and the user-specified Register / Book an appointment / Check your mail sequence; only Register is an action. Beyond the Ordinary is proposal copy. The user subsequently requested deployment through Wrangler to a new Cloudflare Worker, configured as mibc-recruitment.
