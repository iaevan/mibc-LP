// Small helpers shared by the campaign API modules.
export class CampaignError extends Error {
  constructor(status, message, data = undefined) {
    super(message);
    this.status = status;
    this.data = data;
  }
}
export const fail = (status, message, data) => {
  throw new CampaignError(status, message, data);
};
export const clean = (value) => String(value ?? "").trim();
export const inline = (value) =>
  clean(value)
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .replace(/\s+/g, " ");
export const validEmail = (value) => {
  if (typeof value !== "string" || value.length > 254) return false;
  const parts = value.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  return (
    local.length <= 64 &&
    /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local) &&
    !local.startsWith(".") &&
    !local.endsWith(".") &&
    !local.includes("..") &&
    domain.includes(".") &&
    domain
      .split(".")
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
  );
};
export function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
      ...extra,
    },
  });
}
export async function body(request) {
  if (Number(request.headers.get("content-length")) > 4_000_000)
    fail(413, "Upload must be under 4 MB");
  const text = await request.text();
  if (text.length > 4_000_000) fail(413, "Upload must be under 4 MB");
  try {
    return JSON.parse(text);
  } catch {
    fail(400, "Invalid JSON");
  }
}
// Activity entries are readable sentences plus structured before/after detail.
export function activity(db, username, entry) {
  return db
    .prepare(
      "INSERT INTO activity(at,username,list_id,team_id,campaign_id,action,summary,detail) VALUES(?,?,?,?,?,?,?,?)",
    )
    .bind(
      Date.now(),
      username,
      entry.list ?? null,
      entry.team ?? null,
      entry.campaign ?? null,
      entry.action,
      String(entry.summary).slice(0, 600),
      entry.detail === undefined ? null : JSON.stringify(entry.detail),
    );
}
