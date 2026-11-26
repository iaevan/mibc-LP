import { handleCampaignApi } from "./api.mjs";
import { sha256Hex } from "./shared.mjs";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/campaigns/"))
      return new Response("Not found", { status: 404 });
    // The raw service URL never accepts browser traffic or an untrusted forwarded IP.
    if (
      !env.CAMPAIGN_GATEWAY_TOKEN ||
      (await sha256Hex(request.headers.get("x-campaign-gateway") || "")) !==
        (await sha256Hex(env.CAMPAIGN_GATEWAY_TOKEN))
    )
      return new Response("Not found", { status: 404 });
    const headers = new Headers(request.headers);
    headers.set(
      "cf-connecting-ip",
      headers.get("x-campaign-client-ip") || "unknown",
    );
    headers.delete("x-campaign-gateway");
    headers.delete("x-campaign-client-ip");
    const incoming = new Request(
      `${env.PUBLIC_ORIGIN || "https://nsumibc.online"}${url.pathname}${url.search}`,
      {
        method: request.method,
        duplex: "half",
        headers,
        body: ["GET", "HEAD"].includes(request.method)
          ? undefined
          : request.body,
      },
    );
    return handleCampaignApi(incoming, env);
  },
};
