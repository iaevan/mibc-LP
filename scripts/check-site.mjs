import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

const html = await readFile(new URL('../out/index.html', import.meta.url), 'utf8');
const sitemap = await readFile(new URL('../out/sitemap.xml', import.meta.url), 'utf8');
const robots = await readFile(new URL('../out/robots.txt', import.meta.url), 'utf8');
const notFound = await readFile(new URL('../out/404.html', import.meta.url), 'utf8');
const domain = 'https://nsumibc.online/';

assert.equal((html.match(/<h1\b/g) || []).length, 1, 'Homepage needs one primary heading');
assert.match(html, /<html lang="en"/);
assert.match(html, /<meta name="robots" content="index, follow/);
assert.doesNotMatch(html, /<meta name="robots" content="[^"]*noindex/);
assert.match(html, /<link rel="canonical" href="https:\/\/nsumibc\.online\/"/);
assert.match(html, /<meta property="og:image" content="https:\/\/nsumibc\.online\/og\//);
assert.match(html, /<meta name="twitter:card" content="summary_large_image"/);
const jsonLd = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
assert.ok(jsonLd, 'Structured data must be server rendered');
const graph = JSON.parse(jsonLd[1])['@graph'];
assert.deepEqual(graph.map(node => node['@type']), ['Organization', 'WebSite', 'WebPage']);
assert.equal(graph[0].url, domain);
assert.equal(graph[0].sameAs.length, 3);
assert.deepEqual([...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1]), [domain]);
assert.match(robots, /Allow: \/\s/);
assert.ok(robots.includes(`Sitemap: ${domain}sitemap.xml`));
assert.match(notFound, /<meta name="robots" content="[^"]*noindex/);
assert.ok(notFound.includes('Back to home'));
assert.match(html, /crimson-knot-480\.webp 480w/);
assert.match(html, /fetchPriority="high"|fetchpriority="high"/);
assert.match(html, /width="1100" height="1100"/);
for (const file of ['crimson-knot-480.webp', 'crimson-knot-768.webp', 'mibc-logo.webp']) {
  const info = await stat(new URL(`../out/images/${file}`, import.meta.url));
  assert.ok(info.size > 0 && info.size < 110_000, `Image budget exceeded: ${file}`);
}
assert.ok((await stat(new URL('../out/favicon.png', import.meta.url))).size > 0);
assert.ok((await stat(new URL('../out/apple-touch-icon.png', import.meta.url))).size > 0);
console.log('Site checks passed: SEO, structured data, sitemap, error page, and image budgets.');
if (html.includes('href="https://forms.google.com"')) {
  console.warn('Registration form URL is still a placeholder. Replace FORM_URL before promoting registration.');
}
