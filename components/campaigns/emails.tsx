"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./campaigns.module.css";
import {
  ApiError,
  ago,
  api,
  downloadCsv,
  stateLabel,
  useTask,
  when,
  type AudienceTeam,
  type Counts,
  type Email,
  type EmailSummary,
  type ListSummary,
  type Settings,
} from "./api";

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
function personalize(value: string, team?: { team: string; leader_name: string }, html = false) {
  return value.replace(/{{\s*(team_name|recipient_name|leader_name)\s*}}/g, (_, key: string) => {
    const text = key === "team_name" ? team?.team || "Team name" : team?.leader_name || "Leader name";
    return html ? escape(text) : text;
  });
}
function Preview({
  email,
  html,
  team,
}: {
  email: Email;
  html: string;
  team?: { team: string; leader_name: string };
}) {
  const caseBlock = email.case_link
    ? `<p><a href="${escape(email.case_link)}"><strong>Open the case</strong></a></p>`
    : "";
  const content = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'"><style>body{font:16px/1.65 Arial;padding:16px;color:#25141b;overflow-wrap:anywhere;margin:0}a{color:#6c273e}table{max-width:100%}</style>${personalize(html, team, true)}${caseBlock}`;
  return (
    <div className={styles.preview}>
      <p>
        <span className={styles.helper}>From</span> NSU MIBC &lt;info@nsumibc.online&gt;
        <br />
        <span className={styles.helper}>To</span> {team?.leader_name || "Leader name"}
        <br />
        <strong>{personalize(email.subject, team) || "No subject yet"}</strong>
      </p>
      <iframe title="Email preview" sandbox="" srcDoc={content} />
    </div>
  );
}

export function EmailsHome({ open }: { open: (id: string) => void }) {
  const task = useTask();
  const [emails, setEmails] = useState<EmailSummary[]>([]);
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [trash, setTrash] = useState(false);
  const [name, setName] = useState("");
  const [listId, setListId] = useState("");
  const load = useCallback(async (showTrash: boolean) => {
    const [e, l] = await Promise.all([
      api<EmailSummary[]>(`emails${showTrash ? "?trash=1" : ""}`),
      api<ListSummary[]>("lists"),
    ]);
    setEmails(e);
    setLists(l);
    setListId((current) => current || l[0]?.id || "");
  }, []);
  useEffect(() => {
    void task.run(() => load(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <>
      <h1>Emails</h1>
      <form
        className={styles.card}
        onSubmit={(event) => {
          event.preventDefault();
          void task.run(async () => {
            if (!name.trim()) throw new Error("Enter a name for this email");
            if (!listId) throw new Error("Create a team list first");
            const email = await api<Email>("emails", { name, list_id: listId });
            open(email.id);
          });
        }}
      >
        <h2>New email</h2>
        <div className={styles.formGrid}>
          <label>
            Email name (only your team sees this)
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Round 1 case" />
          </label>
          <label>
            Team list
            <select value={listId} onChange={(e) => setListId(e.target.value)}>
              {!lists.length && <option value="">No team lists yet</option>}
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.teams} teams)
                </option>
              ))}
            </select>
          </label>
        </div>
        {task.error && <p className={styles.error}>{task.error}</p>}
        <button className={styles.primary} disabled={task.busy}>
          Create email
        </button>
      </form>
      <div className={styles.row}>
        <h2>{trash ? "Deleted emails" : "All emails"}</h2>
        <button
          onClick={() =>
            void task.run(async () => {
              setTrash(!trash);
              await load(!trash);
            })
          }
        >
          {trash ? "Show active emails" : "View trash"}
        </button>
      </div>
      {task.notice && <p role="status">{task.notice}</p>}
      <div className={styles.card}>
        {emails.length ? (
          emails.map((e) => (
            <article className={styles.campaignItem} key={e.id}>
              <div>
                <strong>{e.name}</strong>
                <span className={styles.helper}>
                  <span className={styles.badge} data-state={e.state}>
                    {stateLabel(e.state)}
                  </span>{" "}
                  {e.list_name || "No team list"}
                  {e.audience_round > 1 ? ` · Round ${e.audience_round}` : ""}
                  {e.total && e.state !== "draft" ? ` · ${e.sent} of ${e.total} sent` : ""}
                </span>
              </div>
              <div className={styles.actions}>
                {trash ? (
                  <button
                    onClick={() =>
                      void task.run(async () => {
                        await api(`emails/${e.id}/restore`, {});
                        await load(true);
                      }, "Email restored")
                    }
                  >
                    Restore
                  </button>
                ) : (
                  <>
                    <button className={styles.primary} onClick={() => open(e.id)}>
                      {e.state === "draft" ? "Edit" : "Dashboard"}
                    </button>
                    <button
                      className={styles.danger}
                      disabled={e.state === "running"}
                      onClick={() => {
                        if (window.confirm(`Move "${e.name}" to Trash? Its results are kept.`))
                          void task.run(async () => {
                            await api(`emails/${e.id}/archive`, {});
                            await load(false);
                          }, "Moved to Trash");
                      }}
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            </article>
          ))
        ) : (
          <p>{trash ? "Trash is empty." : "No emails yet."}</p>
        )}
      </div>
    </>
  );
}

export function EmailView({ id, back }: { id: string; back: () => void }) {
  const task = useTask();
  const [email, setEmail] = useState<Email | null>(null);
  const load = useCallback(async () => setEmail(await api<Email>(`emails/${id}`)), [id]);
  useEffect(() => {
    void task.run(load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);
  if (!email)
    return (
      <>
        <button onClick={back}>← Emails</button>
        {task.error ? <p className={styles.error}>{task.error}</p> : <p>Loading…</p>}
      </>
    );
  return (
    <>
      <div className={styles.row}>
        <button onClick={back}>← Emails</button>
        <div className={styles.actions}>
          <button
            onClick={() => {
              const name = window.prompt("Email name", email.name);
              if (name?.trim())
                void task.run(async () => setEmail(await api<Email>(`emails/${id}/rename`, { name })));
            }}
          >
            Rename
          </button>
          <button
            onClick={() =>
              void task.run(async () => {
                const copy = await api<Email>(`emails/${id}/copy`, {});
                window.location.hash = `email/${copy.id}`;
              })
            }
          >
            Copy as new email
          </button>
        </div>
      </div>
      <h1>{email.name}</h1>
      {task.error && <p className={styles.error}>{task.error}</p>}
      {email.state === "draft" ? (
        <Draft email={email} setEmail={setEmail} />
      ) : (
        <Dashboard email={email} setEmail={setEmail} />
      )}
    </>
  );
}

// Draft: choose recipients, write, then review and send. Everything autosaves.
function Draft({ email, setEmail }: { email: Email; setEmail: (e: Email) => void }) {
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [audience, setAudience] = useState<AudienceTeam[]>([]);
  const [lists, setLists] = useState<ListSummary[]>([]);
  const latest = useRef(email);
  const pending = useRef<Partial<Email>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const editor = useRef<HTMLDivElement>(null);
  latest.current = email;

  const loadAudience = useCallback(async () => {
    setAudience((await api<{ teams: AudienceTeam[] }>(`emails/${latest.current.id}/audience`)).teams);
  }, []);
  useEffect(() => {
    void api<ListSummary[]>("lists").then(setLists).catch(() => undefined);
  }, []);
  // The audience comes from the saved list and round, so save before reloading it.
  useEffect(() => {
    void flush()
      .then(loadAudience)
      .catch((problem) => setError(problem.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadAudience, email.list_id, email.audience_round]);

  async function flush() {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    while (inFlight.current) await inFlight.current;
    const patch = pending.current;
    if (!Object.keys(patch).length) return;
    pending.current = {};
    setStatus("Saving…");
    const task = (async () => {
      try {
        const next = await api<Email>(`emails/${latest.current.id}/save`, {
          ...patch,
          version: latest.current.version,
        });
        // Keep what was typed meanwhile, take everything else from the server.
        latest.current = { ...next, ...pending.current };
        setEmail(latest.current);
        setStatus("All changes saved");
        setError("");
      } catch (problem) {
        setStatus("");
        setError(
          problem instanceof ApiError && problem.status === 409
            ? `${problem.message} Your last change was not saved.`
            : problem instanceof Error
              ? problem.message
              : "Couldn't save",
        );
      } finally {
        inFlight.current = null;
      }
    })();
    inFlight.current = task;
    await task;
    if (Object.keys(pending.current).length) await flush();
  }
  function change(patch: Partial<Email>, delay = 900) {
    pending.current = { ...pending.current, ...patch };
    latest.current = { ...latest.current, ...patch };
    setEmail(latest.current);
    setStatus("Saving soon…");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), delay);
  }
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (timer.current || inFlight.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      void flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (step === 1 && editor.current) editor.current.innerHTML = latest.current.html || "";
  }, [step]);

  const unticked = new Set(email.excluded);
  const receiving = audience.filter((t) => !t.issue && !unticked.has(t.id));
  const go = async (next: number) => {
    await flush();
    setStep(next);
    // Helpers may have fixed or moved teams meanwhile. Count from the latest list.
    if (next === 2) await loadAudience().catch((problem) => setError(problem.message));
  };
  return (
    <>
      <nav className={styles.steps} aria-label="Email steps">
        {["Who gets it", "Write the email", "Review and send"].map((label, i) => (
          <button key={label} aria-current={step === i ? "step" : undefined} onClick={() => void go(i)}>
            {i + 1}. {label}
          </button>
        ))}
      </nav>
      <p className={styles.helper} role="status" aria-live="polite">
        {status || "Changes save automatically"}
      </p>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {step === 0 && (
        <Recipients
          email={email}
          lists={lists}
          audience={audience}
          change={change}
          refresh={() => void loadAudience().catch((problem) => setError(problem.message))}
        />
      )}
      {step === 1 && <Compose email={email} editor={editor} change={change} audience={receiving} />}
      {step === 2 && (
        <Send
          email={email}
          setEmail={setEmail}
          receiving={receiving}
          audience={audience}
          flush={flush}
          refreshAudience={loadAudience}
        />
      )}
      <div className={styles.row}>
        <button disabled={step === 0} onClick={() => void go(step - 1)}>
          ← Back
        </button>
        {step < 2 && (
          <button className={styles.primary} onClick={() => void go(step + 1)}>
            Continue →
          </button>
        )}
      </div>
    </>
  );
}

function Recipients({
  email,
  lists,
  audience,
  change,
  refresh,
}: {
  email: Email;
  lists: ListSummary[];
  audience: AudienceTeam[];
  change: (patch: Partial<Email>, delay?: number) => void;
  refresh: () => void;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const rounds = lists.find((l) => l.id === email.list_id)?.rounds || email.list?.rounds || 1;
  const excluded = new Set(email.excluded);
  const problems = audience.filter((t) => t.issue);
  const receiving = audience.filter((t) => !t.issue && !excluded.has(t.id));
  const visible = audience.filter((t) =>
    `${t.team} ${t.leader_name} ${t.leader_email}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const shown = visible.slice(page * 50, page * 50 + 50);
  const setExcluded = (ids: Set<string>) => change({ excluded: [...ids] }, 400);
  useEffect(() => setPage(0), [query]);
  return (
    <>
      <h2>Who gets this email</h2>
      <div className={styles.formGrid}>
        <label>
          Team list
          <select
            value={email.list_id || ""}
            onChange={(e) => change({ list_id: e.target.value, audience_round: 1, excluded: [] }, 0)}
          >
            {!email.list_id && <option value="">Choose a team list</option>}
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({l.teams} teams)
              </option>
            ))}
          </select>
        </label>
        <label>
          Send to
          <select
            value={email.audience_round}
            onChange={(e) => change({ audience_round: Number(e.target.value), excluded: [] }, 0)}
          >
            <option value={1}>All teams</option>
            {Array.from({ length: Math.max(0, rounds - 1) }, (_, i) => (
              <option key={i} value={i + 2}>
                Teams in Round {i + 2}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={styles.summaryBox}>
        <strong>{receiving.length} team leaders will get this email.</strong>
        {problems.length > 0 && (
          <span>
            {problems.length} teams are skipped because of problems. Fix them in the team list, then{" "}
            <button className={styles.linkButton} onClick={refresh}>
              refresh this count
            </button>
            .
          </span>
        )}
        {excluded.size > 0 && <span>{excluded.size} teams were unticked by hand.</span>}
      </div>
      <div className={styles.searchRow}>
        <label>
          Search
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className={styles.actions}>
          <button onClick={() => setExcluded(new Set())}>Tick all</button>
          <button onClick={() => setExcluded(new Set(audience.map((t) => t.id)))}>Untick all</button>
        </div>
      </div>
      <div className={styles.teamList}>
        {shown.map((t) => (
          <label className={styles.audienceRow} key={t.id}>
            <input
              type="checkbox"
              disabled={!!t.issue}
              checked={!t.issue && !excluded.has(t.id)}
              onChange={(e) => {
                const next = new Set(excluded);
                if (e.target.checked) next.delete(t.id);
                else next.add(t.id);
                setExcluded(next);
              }}
            />
            <span>
              <strong>{t.team || "Unnamed team"}</strong>
              <span className={styles.helper}>
                {t.leader_name} · {t.leader_email || "no email"}
                {rounds > 1 ? ` · Round ${t.round}` : ""}
              </span>
              {t.issue && <span className={styles.flag}>{t.issue}</span>}
            </span>
          </label>
        ))}
        {!shown.length && <p className={styles.empty}>No teams here yet.</p>}
      </div>
      {visible.length > 50 && (
        <div className={styles.row}>
          <span>
            {page * 50 + 1} to {Math.min(visible.length, page * 50 + 50)} of {visible.length}
          </span>
          <div className={styles.actions}>
            <button disabled={page === 0} onClick={() => setPage(page - 1)}>
              Previous
            </button>
            <button disabled={(page + 1) * 50 >= visible.length} onClick={() => setPage(page + 1)}>
              Next
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function Compose({
  email,
  editor,
  change,
  audience,
}: {
  email: Email;
  editor: React.RefObject<HTMLDivElement | null>;
  change: (patch: Partial<Email>, delay?: number) => void;
  audience: AudienceTeam[];
}) {
  const [previewId, setPreviewId] = useState("");
  const [html, setHtml] = useState(email.html);
  const team = audience.find((t) => t.id === previewId) || audience[0];
  const sync = () => {
    const value = editor.current?.innerHTML ?? "";
    setHtml(value);
    change({ html: value }, 1200);
  };
  const command = (name: string, value?: string) => {
    editor.current?.focus();
    document.execCommand(name, false, value);
    sync();
  };
  return (
    <>
      <h2>Write the email</h2>
      <div className={styles.columns}>
        <section>
          <label>
            Subject
            <input
              value={email.subject}
              maxLength={200}
              onChange={(e) => change({ subject: e.target.value })}
              placeholder="Round 1 case for {{team_name}}"
            />
          </label>
          <div className={styles.toolbar}>
            {[
              ["Bold", "bold"],
              ["Italic", "italic"],
              ["Underline", "underline"],
              ["Bullets", "insertUnorderedList"],
              ["Numbers", "insertOrderedList"],
            ].map(([label, name]) => (
              <button key={name} onMouseDown={(e) => e.preventDefault()} onClick={() => command(name)}>
                {label}
              </button>
            ))}
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const url = window.prompt("Link address (https://…)");
                if (url && /^https?:\/\//.test(url)) command("createLink", url);
              }}
            >
              Link
            </button>
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => command("insertText", "{{team_name}}")}>
              + Team name
            </button>
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => command("insertText", "{{leader_name}}")}>
              + Leader name
            </button>
          </div>
          <div
            ref={editor}
            className={styles.editor}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-label="Email body"
            aria-multiline="true"
            onInput={sync}
            onPaste={(event) => {
              event.preventDefault();
              const doc = new DOMParser().parseFromString(
                event.clipboardData.getData("text/html") ||
                  `<p>${escape(event.clipboardData.getData("text/plain")).replace(/\n/g, "<br>")}</p>`,
                "text/html",
              );
              doc
                .querySelectorAll("script,style,iframe,object,form,input,img,svg,math,link,meta,video,audio,source,embed,base")
                .forEach((el) => el.remove());
              doc.querySelectorAll<HTMLElement>("*").forEach((el) => {
                const keep = ["text-align", "font-weight", "font-style", "text-decoration"]
                  .map((key) => [key, el.style.getPropertyValue(key)])
                  .filter(([, value]) => /^(left|right|center|bold|normal|[1-9]00|italic|underline)$/.test(value));
                [...el.attributes].forEach((a) => {
                  if (!(el.tagName === "A" && a.name === "href" && /^https?:\/\//i.test(a.value)))
                    el.removeAttribute(a.name);
                });
                keep.forEach(([key, value]) => el.style.setProperty(key, value));
              });
              document.execCommand("insertHTML", false, doc.body.innerHTML);
              sync();
            }}
          />
          <p className={styles.helper}>
            Paste from Google Docs to keep bold, lists and links. Images are removed.
          </p>
          <label>
            Case link (optional)
            <input
              type="url"
              value={email.case_link}
              onChange={(e) => change({ case_link: e.target.value.trim() })}
              placeholder="https://nsumibc.online/case/…"
            />
          </label>
          <p className={styles.helper}>
            Upload the case PDF at <a href="/casemanagement/" target="_blank" rel="noreferrer">Case management</a>, copy its share link and paste it here. The email gets an &ldquo;Open the case&rdquo; link at the end.
          </p>
        </section>
        <section>
          <label>
            Preview for
            <select value={team?.id || ""} onChange={(e) => setPreviewId(e.target.value)}>
              {audience.slice(0, 500).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.team} · {t.leader_name}
                </option>
              ))}
            </select>
          </label>
          <Preview email={email} html={html} team={team} />
        </section>
      </div>
    </>
  );
}

function Send({
  email,
  setEmail,
  receiving,
  audience,
  flush,
  refreshAudience,
}: {
  email: Email;
  setEmail: (e: Email) => void;
  receiving: AudienceTeam[];
  audience: AudienceTeam[];
  flush: () => Promise<void>;
  refreshAudience: () => Promise<void>;
}) {
  const task = useTask();
  const [testTo, setTestTo] = useState("");
  const [teamId, setTeamId] = useState("");
  const team = receiving.find((t) => t.id === teamId) || receiving[0];
  const test = email.tests[0];
  // Refresh while a test is waiting, so its result appears here.
  useEffect(() => {
    if (!test || !["queued", "sending"].includes(test.status)) return;
    const timer = setInterval(() => {
      void api<Email>(`emails/${email.id}`).then(setEmail).catch(() => undefined);
    }, 5000);
    return () => clearInterval(timer);
  }, [test, email.id, setEmail]);
  const problems = [
    !email.subject.trim() && "Write a subject.",
    !email.html.replace(/<[^>]*>/g, "").trim() && "Write the email body.",
    !receiving.length && "Choose at least one team.",
  ].filter(Boolean) as string[];
  return (
    <>
      <h2>Review and send</h2>
      <div className={styles.columns}>
        <section className={styles.card}>
          <dl className={styles.facts}>
            <div>
              <dt>From</dt>
              <dd>NSU MIBC &lt;info@nsumibc.online&gt;</dd>
            </div>
            <div>
              <dt>Team list</dt>
              <dd>{email.list?.name || "None"}</dd>
            </div>
            <div>
              <dt>Who</dt>
              <dd>
                {email.audience_round > 1 ? `Teams in Round ${email.audience_round}` : "All teams"} · {receiving.length} leaders
                {audience.length > receiving.length && ` (${audience.length - receiving.length} skipped)`}
              </dd>
            </div>
            <div>
              <dt>Case link</dt>
              <dd>{email.case_link || "None"}</dd>
            </div>
            <div>
              <dt>Time needed</dt>
              <dd>
                {(() => {
                  const minutes = Math.max(1, Math.ceil(receiving.length / email.settings.perMinute));
                  return `About ${minutes} minute${minutes === 1 ? "" : "s"} at ${email.settings.perMinute} per minute`;
                })()}
              </dd>
            </div>
            <div>
              <dt>Daily allowance</dt>
              <dd>
                {email.settings.used} of {email.settings.dailyLimit} used in the last 24 hours
              </dd>
            </div>
          </dl>
          {receiving.length > email.settings.dailyLimit - email.settings.used && (
            <p className={styles.flag}>
              More emails than today&apos;s remaining allowance. Sending pauses at the limit and needs another Run workflow when space frees up.
            </p>
          )}
          <h3>Test email (optional)</h3>
          <div className={styles.formGrid}>
            <label>
              Send a test to
              <input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@nsumibc.online" />
            </label>
            <label>
              Using the details of
              <select value={team?.id || ""} onChange={(e) => setTeamId(e.target.value)}>
                {receiving.slice(0, 500).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.team}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            disabled={task.busy || !team}
            onClick={() =>
              void task.run(async () => {
                await flush();
                setEmail(await api<Email>(`emails/${email.id}/test`, { email: testTo, teamId: team?.id }));
              }, "Test queued. Press Run workflow below to send it now.")
            }
          >
            Send test
          </button>
          {test && (
            <p className={test.status === "failed" ? styles.flag : styles.helper}>
              Latest test to {test.email}: {test.status === "sent" ? "sent. Check the inbox and spam folder." : test.status}
              {test.error ? ` (${test.error})` : ""}
            </p>
          )}
          <SenderLink settings={email.settings} />
        </section>
        <section>
          <Preview email={email} html={email.html} team={team} />
        </section>
      </div>
      {task.error && <p className={styles.error} role="alert">{task.error}</p>}
      {task.notice && <p role="status">{task.notice}</p>}
      {problems.length > 0 && <p className={styles.flag}>{problems.join(" ")}</p>}
      <button
        className={`${styles.primary} ${styles.big}`}
        disabled={task.busy || problems.length > 0}
        onClick={() => {
          if (
            window.confirm(
              `Send "${email.subject}" to ${receiving.length} team leaders now?\n\nAfter this, press Run workflow in GitHub to start the sender.`,
            )
          )
            void task.run(async () => {
              await flush();
              try {
                setEmail(await api<Email>(`emails/${email.id}/start`, { confirm: true, expected: receiving.length }));
              } catch (problem) {
                // The list changed since this screen loaded: show the new count to confirm.
                if (problem instanceof ApiError && problem.status === 409) await refreshAudience().catch(() => undefined);
                throw problem;
              }
            });
        }}
      >
        Send to {receiving.length} team leaders
      </button>
    </>
  );
}

function SenderLink({ settings }: { settings: Settings }) {
  return (
    <p className={styles.helper}>
      The sender starts when someone presses Run workflow in GitHub.{" "}
      <a href={settings.workflowUrl} target="_blank" rel="noreferrer">
        Open Run workflow
      </a>
      . Last seen {ago(settings.heartbeat)}.
    </p>
  );
}

type Stats = {
  state: string;
  last_error: string | null;
  counts: Counts;
  recent: { started_at: number; status: string; error: string | null; team: string; email: string; is_test: number }[];
  settings: Settings;
  now: number;
};
type Row = {
  id: string;
  team: string;
  name: string;
  email: string;
  status: string;
  attempts: number;
  error: string | null;
  sent_at: number | null;
};
const STATUS_TEXT: Record<string, string> = {
  queued: "Waiting",
  sending: "Sending now",
  sent: "Sent",
  failed: "Failed",
  uncertain: "Check delivery",
};

function Dashboard({ email, setEmail }: { email: Email; setEmail: (e: Email) => void }) {
  const task = useTask();
  const [stats, setStats] = useState<Stats | null>(null);
  const [rows, setRows] = useState<{ total: number; items: Row[] }>({ total: 0, items: [] });
  const [filter, setFilter] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const state = stats?.state || email.state;
  // The 24-hour allowance count is the costly part, so it is fetched every
  // 30 seconds while the counts refresh every few seconds.
  const fullAt = useRef(0);
  const loadStats = useCallback(async () => {
    const full = Date.now() - fullAt.current > 30000;
    const next = await api<Stats>(`emails/${email.id}/stats${full ? "?full=1" : ""}`);
    if (full) fullAt.current = Date.now();
    setStats((previous) =>
      full || !previous
        ? next
        : {
            ...next,
            settings: { ...next.settings, used: previous.settings.used, resumeAt: previous.settings.resumeAt },
          },
    );
  }, [email.id]);
  const loadRows = useCallback(async () => {
    const params = new URLSearchParams({ status: filter, q: query, page: String(page) });
    setRows(await api<{ total: number; items: Row[] }>(`emails/${email.id}/recipients?${params}`));
  }, [email.id, filter, query, page]);
  useEffect(() => {
    void loadStats().catch(() => undefined);
  }, [loadStats]);
  useEffect(() => {
    const timer = setTimeout(() => void loadRows().catch(() => undefined), 250);
    return () => clearTimeout(timer);
  }, [loadRows]);
  useEffect(() => setPage(0), [filter, query]);
  // Live updates: counts every 3 seconds while sending, the team table every
  // 15 seconds, both slower when idle and paused while the tab is hidden.
  useEffect(() => {
    let tick = 0;
    const timer = setInterval(
      () => {
        if (document.hidden) return;
        tick++;
        void loadStats().catch(() => undefined);
        if (state !== "running" || tick % 5 === 0) void loadRows().catch(() => undefined);
      },
      state === "running" ? 3000 : 15000,
    );
    return () => clearInterval(timer);
  }, [state, loadStats, loadRows]);
  // When sending finishes or stops, update the table and header at once.
  const lastState = useRef(state);
  useEffect(() => {
    if (lastState.current !== state) {
      lastState.current = state;
      void loadRows().catch(() => undefined);
      void api<Email>(`emails/${email.id}`).then(setEmail).catch(() => undefined);
    }
  }, [state, loadRows, email.id, setEmail]);
  const act = (action: string, body: object = {}, done = "") =>
    task.run(async () => {
      setEmail(await api<Email>(`emails/${email.id}/${action}`, body));
      await loadStats();
      await loadRows();
    }, done);

  const counts = stats?.counts || email.counts;
  const settings = stats?.settings || email.settings;
  const now = stats?.now || Date.now();
  const finished = counts ? counts.sent + counts.failed + counts.uncertain : 0;
  const percent = counts?.total ? Math.round((finished / counts.total) * 100) : 0;
  const senderAsleep = state === "running" && (!settings.heartbeat || now - settings.heartbeat > 90000);
  const limited = !!settings.resumeAt && settings.used >= settings.dailyLimit;
  const waiting = counts ? counts.queued + counts.sending : 0;
  const minutes = Math.ceil(waiting / settings.perMinute);
  return (
    <>
      <section className={styles.card} aria-live="polite">
        <div className={styles.row}>
          <div>
            <span className={styles.badge} data-state={state}>
              {stateLabel(state)}
            </span>{" "}
            <span className={styles.helper}>
              {email.list?.name}
              {email.audience_round > 1 ? ` · Round ${email.audience_round}` : ""} · started {when(email.launched_at)}
            </span>
          </div>
          <div className={styles.actions}>
            {state === "running" && (
              <button className={`${styles.stop} ${styles.big}`} disabled={task.busy} onClick={() => void act("pause", {}, "Sending stopped")}>
                Stop sending now
              </button>
            )}
            {state === "paused" && (
              <button className={styles.primary} disabled={task.busy} onClick={() => void act("start", {}, "Sending resumed. Press Run workflow if the sender is not running.")}>
                Resume sending
              </button>
            )}
          </div>
        </div>
        <div
          className={styles.progress}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label="Sending progress"
        >
          <span style={{ width: `${percent}%` }} />
        </div>
        <p>
          <strong>{percent}%</strong> · {finished} of {counts?.total || 0} done
          {state === "running" && waiting > 0 && ` · about ${minutes} min left`}
        </p>
        <div className={styles.stats}>
          {[
            ["Sent", counts?.sent || 0, "sent"],
            ["Waiting", waiting, "queued"],
            ["Failed", counts?.failed || 0, "failed"],
            ["Check delivery", counts?.uncertain || 0, "uncertain"],
          ].map(([label, value, key]) => (
            <button
              key={key as string}
              className={styles.stat}
              aria-pressed={filter === key}
              onClick={() => setFilter(filter === key ? "" : (key as string))}
            >
              <strong>{value as number}</strong>
              <span>{label as string}</span>
            </button>
          ))}
        </div>
        {senderAsleep && !limited && (
          <div className={styles.warning}>
            <strong>The sender isn&apos;t running yet.</strong>
            <span>Open GitHub, press Run workflow, then Run workflow again in the box that opens. Sending starts within about a minute.</span>
            <a className={styles.buttonLink} href={settings.workflowUrl} target="_blank" rel="noreferrer">
              Open Run workflow
            </a>
          </div>
        )}
        {limited && state === "running" && (
          <div className={styles.warning}>
            <strong>Daily limit reached ({settings.dailyLimit} emails in 24 hours).</strong>
            <span>Room frees up from {when(settings.resumeAt)}. Then press Run workflow again to continue.</span>
            <a className={styles.buttonLink} href={settings.workflowUrl} target="_blank" rel="noreferrer">
              Open Run workflow
            </a>
          </div>
        )}
        {(stats?.last_error || email.last_error) && state !== "running" && (
          <p className={styles.error}>{stats?.last_error || email.last_error}</p>
        )}
        <p className={styles.helper}>
          Sender last seen {ago(settings.heartbeat, now)}. Stop takes effect at once. At most one email already being handed to the mail server can still go out.
        </p>
      </section>
      {task.error && <p className={styles.error} role="alert">{task.error}</p>}
      {task.notice && <p role="status">{task.notice}</p>}
      {stats && stats.recent.length > 0 && (
        <details className={styles.card}>
          <summary>Latest activity</summary>
          <ul className={styles.compactList}>
            {stats.recent.map((r, i) => (
              <li key={i}>
                {when(r.started_at)} · {r.is_test ? "Test to " : ""}
                {r.team} · {STATUS_TEXT[r.status] || r.status}
                {r.error ? ` (${r.error})` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className={styles.toolbar}>
        {(counts?.failed || 0) > 0 && (
          <button disabled={task.busy || state === "running"} onClick={() => void act("retry", { status: "failed" }, "Failed emails queued again. Resume sending.")}>
            Retry {counts?.failed} failed
          </button>
        )}
        <button
          onClick={() =>
            void task.run(async () => {
              const all = await api<{ items: Row[] }>(`emails/${email.id}/recipients?all=1`);
              downloadCsv(`${email.name} results.csv`, [
                ["Team", "Leader", "Email", "Status", "Attempts", "Sent at", "Problem"],
                ...all.items.map((r) => [r.team, r.name, r.email, STATUS_TEXT[r.status] || r.status, String(r.attempts), when(r.sent_at), r.error || ""]),
              ]);
            })
          }
        >
          Download results
        </button>
      </div>
      {state === "running" && (counts?.failed || counts?.uncertain) ? (
        <p className={styles.helper}>Stop sending to retry or check individual emails.</p>
      ) : null}
      <div className={styles.searchRow}>
        <label>
          Search
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Team, leader or email" />
        </label>
        <label>
          Show
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">Everyone</option>
            {Object.entries(STATUS_TEXT).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={styles.teamList}>
        {rows.items.map((r) => (
          <div className={styles.resultRow} key={r.id}>
            <div>
              <strong>{r.team}</strong>
              <span className={styles.helper}>
                {r.name} · {r.email}
              </span>
              {r.error && <span className={styles.flag}>{r.error}</span>}
            </div>
            <span className={styles.badge} data-state={r.status}>
              {STATUS_TEXT[r.status] || r.status}
              {r.sent_at && r.status === "sent" ? ` ${new Date(r.sent_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
            </span>
            {state !== "running" && ["failed", "uncertain", "sent"].includes(r.status) && (
              <div className={styles.actions}>
                {r.status === "uncertain" && (
                  <button
                    onClick={() => {
                      if (window.confirm("You checked the Hostinger Sent folder or asked the leader, and the email arrived?"))
                        void act("resolve", { recipientId: r.id, confirm: true });
                    }}
                  >
                    It arrived
                  </button>
                )}
                <button
                  onClick={() => {
                    if (r.status === "failed" || window.confirm(`${r.email} may get a second copy. Continue?`))
                      void act("retry", { status: r.status, recipientId: r.id, confirm: true }, "Queued again. Resume sending.");
                  }}
                >
                  {r.status === "sent" ? "Send again" : "Retry"}
                </button>
              </div>
            )}
          </div>
        ))}
        {!rows.items.length && <p className={styles.empty}>No teams match.</p>}
      </div>
      {rows.total > 50 && (
        <div className={styles.row}>
          <span>
            {page * 50 + 1} to {Math.min(rows.total, page * 50 + 50)} of {rows.total}
          </span>
          <div className={styles.actions}>
            <button disabled={page === 0} onClick={() => setPage(page - 1)}>
              Previous
            </button>
            <button disabled={(page + 1) * 50 >= rows.total} onClick={() => setPage(page + 1)}>
              Next
            </button>
          </div>
        </div>
      )}
    </>
  );
}
