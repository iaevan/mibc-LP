import { useEffect, useState } from "react";
import styles from "./campaigns.module.css";

export type Member = {
  name: string;
  email: string;
  institute?: string;
  studentId?: string;
  phone?: string;
};
export type Person = {
  id: string;
  team: string;
  name: string;
  email: string;
  members: Member[];
  issue: string;
  enabled: number | boolean;
  status?: string;
  error?: string;
  is_test?: number;
  attempts?: number;
  sent_at?: number;
  shared_confirmed?: number;
};

export function TeamDetails({
  person,
  readonly,
  busy,
  onChange,
  onSave,
  onClose,
}: {
  person: Person;
  readonly: boolean;
  busy: boolean;
  onChange: (patch: Partial<Person>) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  useEffect(() => setEditing(null), [person.id]);
  const members = person.members.length
    ? person.members.map((m, i) =>
        i === 0 ? { ...m, name: person.name, email: person.email } : m,
      )
    : [{ name: person.name, email: person.email }];
  function update(index: number, patch: Partial<Member>) {
    const next = members.map((m, i) => (i === index ? { ...m, ...patch } : m));
    onChange({
      members: next,
      ...(index === 0 ? { name: next[0].name, email: next[0].email } : {}),
      issue: person.issue.startsWith("Shared") ? person.issue : "",
    });
  }
  return (
    <section
      className={styles.teamDetails}
      aria-label={`${person.team || "New team"} details`}
    >
      <div className={styles.row}>
        <div>
          <h2>{person.team || "New team"}</h2>
          <p className={styles.helper}>
            Only member 1 receives this team’s email.
          </p>
        </div>
        <button onClick={onClose}>Close details</button>
      </div>
      <label className={styles.compactLabel}>
        Team name
        <input
          disabled={readonly || busy}
          value={person.team}
          onChange={(e) =>
            onChange({
              team: e.target.value,
              issue: person.issue.startsWith("Shared") ? person.issue : "",
            })
          }
        />
      </label>
      <div className={styles.members}>
        {members.map((m, i) => (
          <article className={styles.member} key={i}>
            <div className={styles.memberHead}>
              <div>
                <strong>{m.name || `Member ${i + 1}`}</strong>
                <span className={styles.memberRole}>
                  {i === 0 ? "Email recipient" : `Member ${i + 1}`}
                </span>
              </div>
              {!readonly && (
                <button
                  aria-expanded={editing === i}
                  onClick={() => setEditing(editing === i ? null : i)}
                >
                  {editing === i ? "Done editing" : "Edit member"}
                </button>
              )}
            </div>
            {editing === i && !readonly ? (
              <div className={styles.memberForm}>
                {(
                  [
                    ["name", "Full name"],
                    ["email", "Email address"],
                    ["institute", "Institute"],
                    ["studentId", "Student ID"],
                    ["phone", "Phone"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <input
                      type={
                        key === "email"
                          ? "email"
                          : key === "phone"
                            ? "tel"
                            : "text"
                      }
                      disabled={busy}
                      value={m[key] || ""}
                      onChange={(e) => update(i, { [key]: e.target.value })}
                    />
                  </label>
                ))}
                {i > 0 && (
                  <button
                    className={styles.danger}
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Remove ${m.name || "this member"} from the draft?`,
                        )
                      ) {
                        onChange({
                          members: members.filter((_, index) => index !== i),
                        });
                        setEditing(null);
                      }
                    }}
                  >
                    Remove member
                  </button>
                )}
              </div>
            ) : (
              <dl className={styles.memberFacts}>
                <div>
                  <dt>Email</dt>
                  <dd>{m.email || "Not provided"}</dd>
                </div>
                <div>
                  <dt>Institute</dt>
                  <dd>{m.institute || "Not provided"}</dd>
                </div>
                <div>
                  <dt>Student ID</dt>
                  <dd>{m.studentId || "Not provided"}</dd>
                </div>
                <div>
                  <dt>Phone</dt>
                  <dd>{m.phone || "Not provided"}</dd>
                </div>
              </dl>
            )}
          </article>
        ))}
      </div>
      {!readonly && (
        <div className={styles.row}>
          <button
            disabled={busy || members.length >= 10}
            onClick={() => {
              onChange({ members: [...members, { name: "", email: "" }] });
              setEditing(members.length);
            }}
          >
            Add member
          </button>
          <button className={styles.primary} disabled={busy} onClick={onSave}>
            Save team changes
          </button>
        </div>
      )}
      {person.issue && (
        <p role="status" className={styles.error}>
          {person.issue}
        </p>
      )}
      {!readonly && person.issue.startsWith("Shared") && (
        <button onClick={() => onChange({ issue: "", shared_confirmed: 1 })}>
          Confirm shared email address
        </button>
      )}
      {readonly && (
        <p className={styles.helper}>
          This campaign has launched. Use “Copy and edit” to prepare corrected
          emails in a new draft.
        </p>
      )}
    </section>
  );
}
