import assert from 'node:assert/strict';
import worker from '../worker.mjs';

const token = 'phc_DbtF2v2rM5f4jj4quFvWzDebRTytBxvbhKNsLvgc2Zim';
const originalFetch = globalThis.fetch;
const forwarded = [];
globalThis.fetch = async (url, options) => {
  forwarded.push({ url, options });
  return new Response('ok', { headers: { 'set-cookie': 'upstream=secret' } });
};
const env = { ASSETS: { fetch: async () => new Response('static page') } };

try {
  assert.equal(await (await worker.fetch(new Request('https://nsumibc.online/'), env)).text(), 'static page');
  const request = new Request('https://nsumibc.online/mibc-pulse/i/v0/e/?v=1', {
    method: 'POST', body: 'event payload', headers: {
      cookie: 'private=secret', authorization: `Bearer ${token}`,
      'CF-Connecting-IP': '192.0.2.10', 'X-Forwarded-For': 'spoofed',
    },
  });
  const response = await worker.fetch(request, env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('set-cookie'), null);
  const event = forwarded.at(-1);
  assert.equal(event.url, 'https://us.i.posthog.com/i/v0/e/?v=1');
  assert.equal(event.options.headers.get('cookie'), null);
  assert.equal(event.options.headers.get('authorization'), `Bearer ${token}`);
  assert.equal(event.options.headers.get('x-forwarded-for'), '192.0.2.10');
  assert.equal(await new Response(event.options.body).text(), 'event payload');
  await worker.fetch(new Request('https://nsumibc.online/mibc-pulse/array/project/config.js', {
    headers: { authorization: 'Bearer unrelated-private-key', cookie: 'secret' },
  }), env);
  assert.equal(forwarded.at(-1).url, 'https://us-assets.i.posthog.com/array/project/config.js');
  assert.equal(forwarded.at(-1).options.headers.get('authorization'), null);
  assert.equal(forwarded.at(-1).options.headers.get('cookie'), null);
  assert.equal((await worker.fetch(new Request('https://nsumibc.online/mibc-pulse/admin'), env)).status, 404);
  assert.equal((await worker.fetch(new Request('https://nsumibc.online/mibc-pulse/e/', { method: 'DELETE' }), env)).status, 405);
  globalThis.fetch = async () => { throw new Error('offline'); };
  assert.equal((await worker.fetch(new Request('https://nsumibc.online/mibc-pulse/e/'), env)).status, 502);
  console.log('Proxy checks passed: static fallback, routing, body, credentials, verified IP, no event caching, and failures.');
} finally {
  globalThis.fetch = originalFetch;
}
