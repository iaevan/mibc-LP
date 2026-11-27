"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./campaigns.module.css";
import { ApiError, api, ago, type Member, type Team } from "./api";

const FIELDS: [keyof Member, string, string][] = [
  ["name", "Full name", "text"],
  ["email", "Email", "email"],
  ["institute", "Institute", "text"],
  ["studentId", "Student ID", "text"],
  ["phone", "Phone", "tel"],
];

type Status = "idle" | "waiting" | "saving" | "saved" | "error" | "conflict";

// Edits save on their own about a second after typing stops.
export function TeamEditor({
  team,
  rounds,
  onSaved,
  onClose,
}: {
  team: Team;
  rounds: number;
  onSaved: (teams: Team[] | null, team: Team) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Team>(team);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState<Team | null>(null);
  const latest = useRef(draft);
  const version = useRef(team.version);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<void> | null>(null);
  const pending = useRef(false);
  latest.current = draft;

  useEffect(() => {
    setDraft(team);
    version.current = team.version;
    setStatus("idle");
    setConflict(null);
    // Only reset when a different team is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team.id]);

  async function save() {
    if (saving.current) {
      pending.current = true;
      return saving.current;
    }
    pending.current = false;
    setStatus("saving");
    const task = (async () => {
      try {
        const current = latest.current;
        const result = await api<{ team: Team; teams: Team[] | null }>(
          `teams/${current.id}`,
          { ...current, version: version.current },
        );
        version.current = result.team.version;
        setDraft((value) => ({
          ...value,
          version: result.team.version,
          issue: result.team.issue,
        }));
        onSaved(result.teams, result.team);
        setStatus("saved");
      } catch (problem) {
        if (problem instanceof ApiError && problem.status === 409 && problem.data.team) {
          setConflict(problem.data.team as Team);
          setStatus("conflict");
        } else setStatus("error");
        setMessage(problem instanceof Error ? problem.message : "Couldn't save");
        pending.current = false;
      } finally {
        saving.current = null;
      }
    })();
    saving.current = task;
    await task;
    if (pending.current) await save();
  }
  function change(patch: Partial<Team>) {
    if (status === "conflict") return;
    setDraft((value) => ({ ...value, ...patch }));
    setStatus("waiting");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 900);
  }
  async function close() {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      await save();
    } else if (saving.current) await saving.current;
    onClose();
  }
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (timer.current || saving.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      if (timer.current) {
        clearTimeout(timer.current);
        void save();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const members = draft.members.length
    ? draft.members
    : [{ name: draft.leader_name, email: draft.leader_email }];
  function setMember(index: number, field: keyof Member, value: string) {
    const next = members.map((m, i) => (i === index ? { ...m, [field]: value } : m));
    change({
      members: next,
      ...(index === 0
        ? { leader_name: next[0].name, leader_email: next[0].email }
        : {}),
    });
  }
  const statusText = {
    idle: "Changes save automatically",
    waiting: "Saving soon…",
    saving: "Saving…",
    saved: "All changes saved",
    error: message,
    conflict: message,
  }[status];
  const duplicate = draft.issue.startsWith("Same") || !!draft.shared_confirmed;

  return (
    <section className={styles.teamDetails} aria-label={`${draft.team || "New team"} details`}>
      <div className={styles.row}>
        <p
          className={status === "error" || status === "conflict" ? styles.flag : styles.helper}
          role="status"
          aria-live="polite"
        >
          {statusText}
        </p>
        <button onClick={() => void close()}>Close</button>
      </div>
      {conflict && (
        <div className={styles.error}>
          <p>Your last change wasn&apos;t saved.</p>
          <button
            onClick={() => {
              setDraft(conflict);
              version.current = conflict.version;
              setConflict(null);
              setStatus("idle");
              onSaved(null, conflict);
            }}
          >
            Load the latest version
          </button>
        </div>
      )}
      <div className={styles.formGrid}>
        <label>
          Team name
          <input value={draft.team} onChange={(e) => change({ team: e.target.value })} />
        </label>
        <label>
          Round
          <select
            value={draft.round}
            onChange={(e) => change({ round: Number(e.target.value) })}
          >
            {Array.from({ length: rounds }, (_, i) => (
              <option key={i} value={i + 1}>
                Round {i + 1}
              </option>
            ))}
          </select>
        </label>
      </div>
      {draft.issue && <p className={styles.flag}>{draft.issue}</p>}
      {duplicate && (
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={!!draft.shared_confirmed}
            onChange={(e) => change({ shared_confirmed: e.target.checked ? 1 : 0 })}
          />
          This is a different team. Keep both and send to each.
        </label>
      )}
      <div className={styles.members}>
        {members.map((m, i) => (
          <fieldset className={styles.member} key={i}>
            <legend>{i === 0 ? "Leader (receives the email)" : `Member ${i + 1}`}</legend>
            <div className={styles.memberForm}>
              {FIELDS.map(([field, label, type]) => (
                <label key={field}>
                  {label}
                  <input
                    type={type}
                    value={m[field] || ""}
                    onChange={(e) => setMember(i, field, e.target.value)}
                  />
                </label>
              ))}
            </div>
            {i > 0 && (
              <button
                className={styles.danger}
                onClick={() => {
                  if (window.confirm(`Remove ${m.name || "this member"}?`))
                    change({ members: members.filter((_, index) => index !== i) });
                }}
              >
                Remove member
              </button>
            )}
          </fieldset>
        ))}
      </div>
      <div className={styles.row}>
        <button
          disabled={members.length >= 10}
          onClick={() => change({ members: [...members, { name: "", email: "" }] })}
        >
          Add member
        </button>
        <span className={styles.helper}>
          Last change {ago(team.updated_at)}
          {team.updated_by ? ` by ${team.updated_by}` : ""}
        </span>
      </div>
    </section>
  );
}
