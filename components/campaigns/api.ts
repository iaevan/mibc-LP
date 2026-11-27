"use client";

import { useCallback, useState } from "react";

export type Role = "admin" | "helper";
export type Me = { username: string; name: string; role: Role };
export type Member = {
  name: string;
  email: string;
  institute?: string;
  studentId?: string;
  phone?: string;
};
export type Team = {
  id: string;
  list_id: string;
  team: string;
  leader_name: string;
  leader_email: string;
  members: Member[];
  round: number;
  shared_confirmed: number;
  version: number;
  updated_at: number;
  updated_by: string | null;
  deleted_at: number | null;
  issue: string;
};
export type ListSummary = {
  id: string;
  name: string;
  rounds: number;
  teams: number;
  updated_at: number;
  archived_at: number | null;
};
export type TeamList = Omit<ListSummary, "teams"> & { teams: Team[] };
export type Settings = {
  provider: string;
  dailyLimit: number;
  perMinute: number;
  used: number;
  resumeAt: number | null;
  heartbeat: number | null;
  ready: boolean;
  workflowUrl: string;
};
export type Counts = {
  queued: number;
  sending: number;
  sent: number;
  failed: number;
  uncertain: number;
  total: number;
};
export type Email = {
  id: string;
  name: string;
  subject: string;
  html: string;
  state: string;
  version: number;
  list_id: string | null;
  list: { id: string; name: string; rounds: number; archived_at: number | null } | null;
  audience_round: number;
  excluded: string[];
  case_link: string;
  last_error: string | null;
  launched_at: number | null;
  launched_by: string | null;
  archived_at: number | null;
  tests: {
    id: string;
    team: string;
    email: string;
    status: string;
    error: string | null;
    sent_at: number | null;
  }[];
  counts: Counts | null;
  settings: Settings;
};
export type EmailSummary = {
  id: string;
  name: string;
  state: string;
  list_name: string | null;
  audience_round: number;
  total: number;
  sent: number;
  updated_at: number;
};
export type AudienceTeam = {
  id: string;
  team: string;
  leader_name: string;
  leader_email: string;
  round: number;
  issue: string;
  excluded: boolean;
};

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
export const SIGNED_OUT = "campaign-signed-out";

export async function api<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/campaigns/${path}`, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers:
        body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("No connection. Check your internet and try again.", 0);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && path !== "login")
      window.dispatchEvent(new Event(SIGNED_OUT));
    throw new ApiError(data.error || "Something went wrong. Try again.", response.status, data);
  }
  return data as T;
}

// Runs one request at a time for a view and keeps its error and notice text.
export function useTask() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const run = useCallback(async (task: () => Promise<unknown>, done = "") => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
      if (done) setNotice(done);
      return true;
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Try again");
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, notice, setError, setNotice, run };
}

export const when = (time: number | null | undefined) =>
  time
    ? new Date(time).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "";
export function ago(time: number | null | undefined, now = Date.now()) {
  if (!time) return "never";
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  return when(time);
}
export const stateLabel = (state: string) =>
  ({
    draft: "Draft",
    running: "Sending",
    paused: "Stopped",
    done: "Finished",
    archived: "In Trash",
  })[state] || state;

export function downloadCsv(name: string, rows: string[][]) {
  const csv = rows
    .map((row) =>
      row
        .map(
          (value) =>
            `"${String(value ?? "")
              .replace(/^[=+@-]/, "'$&")
              .replace(/"/g, '""')}"`,
        )
        .join(","),
    )
    .join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
