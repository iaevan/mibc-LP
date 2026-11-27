import { API_PREFIX, handleTicketApi, serveTicketPage } from './worker/ticketing.mjs';
import { campaignGateway, serveAdmin } from './worker/campaigns/gateway.mjs';
import { PUBLIC_CASE_API, handlePublicCaseApi, serveCasePage } from './worker/cases.mjs';

const PREFIX = '/mibc-pulse';
const PROJECT_TOKEN = 'phc_DbtF2v2rM5f4jj4quFvWzDebRTytBxvbhKNsLvgc2Zim';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/campaigns' || url.pathname.startsWith('/api/campaigns/')) return campaignGateway(request, env);
    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) return serveAdmin(request, env);
    if (url.pathname.startsWith(API_PREFIX)) return handleTicketApi(request, env, ctx);
    if (url.pathname.startsWith(PUBLIC_CASE_API)) return handlePublicCaseApi(request, env, ctx);
    if (url.pathname === '/case' || url.pathname.startsWith('/case/')) return serveCasePage(request, env, '/case/');
    if (url.pathname === '/casemanagement' || url.pathname.startsWith('/casemanagement/')) return serveCasePage(request, env, '/casemanagement/');
    if (url.pathname === '/ticketmanagement' || url.pathname.startsWith('/ticketmanagement/')) return serveTicketPage(request, env);
    if (!url.pathname.startsWith(`${PREFIX}/`)) return env.ASSETS.fetch(request);

    const path = url.pathname.slice(PREFIX.length);
    const asset = path.startsWith('/static/') || path.startsWith('/array/');
    const api = /^\/(e|i\/v0\/e|flags|decide|capture|batch)\/?$/.test(path);
    if (!asset && !api) return new Response('Not found', { status: 404 });
    if (!['GET', 'HEAD', 'POST', 'OPTIONS'].includes(request.method) || (asset && request.method === 'POST')) {
      return new Response('Method not allowed', { status: 405 });
    }

    const headers = new Headers(request.headers);
    headers.delete('cookie');
    headers.delete('host');
    if (headers.get('authorization') !== `Bearer ${PROJECT_TOKEN}`) headers.delete('authorization');
    const ip = request.headers.get('CF-Connecting-IP');
    headers.delete('x-forwarded-for');
    if (ip) headers.set('x-forwarded-for', ip);

    const upstream = `https://${asset ? 'us-assets.i.posthog.com' : 'us.i.posthog.com'}${path}${url.search}`;
    try {
      const response = await fetch(upstream, {
        method: request.method,
        headers,
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
        redirect: 'manual',
      });
      const outgoing = new Headers(response.headers);
      outgoing.delete('set-cookie');
      if (!asset) outgoing.set('cache-control', 'no-store');
      return new Response(response.body, { status: response.status, headers: outgoing });
    } catch {
      return new Response('Service temporarily unavailable', { status: 502, headers: { 'cache-control': 'no-store' } });
    }
  },
};
