// Local preview only. Production uses the authenticated gateway and entry modules.
import { handleCampaignApi } from "./api.mjs";
import { serveAdmin } from "./gateway.mjs";
export default {
  fetch(request, env) {
    const path = new URL(request.url).pathname;
    return path.startsWith("/api/campaigns/")
      ? handleCampaignApi(request, env)
      : path.startsWith("/admin")
        ? serveAdmin(request, env)
        : env.ASSETS.fetch(request);
  },
};
