// The public site forwards only campaign API calls to the isolated email service.
export async function campaignGateway(request, env) {
  if (!env.CAMPAIGN_API_ORIGIN || !env.CAMPAIGN_GATEWAY_TOKEN)
    return new Response(
      JSON.stringify({ error: "Campaign service activation is pending" }),
      {
        status: 503,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      },
    );
  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  headers.set("x-campaign-gateway", env.CAMPAIGN_GATEWAY_TOKEN);
  // Preserve the client address for login throttling across the service boundary.
  headers.set(
    "x-campaign-client-ip",
    request.headers.get("cf-connecting-ip") || "unknown",
  );
  try {
    return await fetch(
      `${env.CAMPAIGN_API_ORIGIN}${url.pathname}${url.search}`,
      {
        method: request.method,
        duplex: "half",
        headers,
        body: ["GET", "HEAD"].includes(request.method)
          ? undefined
          : request.body,
        redirect: "manual",
      },
    );
  } catch {
    return new Response(
      JSON.stringify({ error: "Campaign service is temporarily unavailable" }),
      {
        status: 503,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      },
    );
  }
}
export async function serveAdmin(request, env) {
  const response = await env.ASSETS.fetch(request);
  const headers = new Headers(response.headers);
  headers.set("x-robots-tag", "noindex, nofollow");
  headers.set("cache-control", "no-store");
  headers.set(
    "content-security-policy",
    "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
  );
  headers.set("referrer-policy", "no-referrer");
  return new Response(response.body, { status: response.status, headers });
}
