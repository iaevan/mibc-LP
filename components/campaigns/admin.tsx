"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./campaigns.module.css";
import { TeamDetails, type Person } from "./team-details";

type Settings = {
  provider: string;
  dailyLimit: number;
  perMinute: number;
  used: number;
  ready: boolean;
  heartbeat: number | null;
};
type Attempt = {
  id: string;
  recipient_id: string;
  started_at: number;
  status: string;
  error?: string;
  message_id?: string;
};
type Campaign = {
  id: string;
  name: string;
  subject: string;
  html: string;
  version: number;
  tested_version: number | null;
  state: string;
  people: Person[];
  settings: Settings;
  history: Attempt[];
  last_error?: string;
  archived_at?: number;
};
type Summary = { id: string; name: string; state: string };
class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/campaigns/${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers:
      body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(data.error || "Request failed", response.status);
  return data;
}
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
function personalize(value: string, person?: Person, html = false) {
  return value.replace(
    /{{\s*(team_name|recipient_name)\s*}}/g,
    (_, key: string) => {
      const text =
        key === "team_name"
          ? person?.team || "Team name"
          : person?.name || "Recipient name";
      return html ? escape(text) : text;
    },
  );
}
function Preview({
  campaign,
  person,
}: {
  campaign: Campaign;
  person?: Person;
}) {
  const content = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'"><style>body{font:16px/1.65 Arial;padding:20px;color:#25141b;overflow-wrap:anywhere}a{color:#6c273e}table{max-width:100%}</style>${personalize(campaign.html, person, true)}`;
  return (
    <div className={styles.preview}>
      <p>
        <strong>Subject</strong>
        <br />
        {personalize(campaign.subject, person)}
      </p>
      <iframe title="Personalized email preview" sandbox="" srcDoc={content} />
    </div>
  );
}

export function CampaignAdmin() {
  const [user, setUser] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [list, setList] = useState<Summary[]>([]);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [teams, setTeams] = useState<Person[]>([]);
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const [testEmail, setTestEmail] = useState("");
  const [testReviewed, setTestReviewed] = useState(false);
  useEffect(() => setTestReviewed(false), [campaign?.id, campaign?.version]);
  const [status, setStatus] = useState("all");
  const [trash, setTrash] = useState(false);
  const [newName, setNewName] = useState("");
  const [page, setPage] = useState(0);
  const editor = useRef<HTMLDivElement>(null);
  const dirty = useRef(false);

  async function perform(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
    } catch (problem) {
      if (problem instanceof ApiError && problem.status === 401) {
        setUser(null);
        setCampaign(null);
      }
      setError(problem instanceof Error ? problem.message : "Please try again");
    } finally {
      setBusy(false);
    }
  }
  async function refreshList(showTrash = trash) {
    setList(await api<Summary[]>(showTrash ? "?trash=1" : ""));
  }
  function accept(next: Campaign) {
    setCampaign(next);
    setTeams(next.people.filter((p) => !p.is_test));
    dirty.current = false;
  }
  useEffect(() => {
    api<{ username: string }>("session")
      .then(async (data) => {
        setUser(data.username);
        await refreshList();
      })
      .catch((problem) => {
        if (!(problem instanceof ApiError && problem.status === 401))
          setError(problem.message);
      })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (!campaign || step < 2) return;
    const timer = setInterval(() => {
      if (dirty.current || document.hidden) return;
      api<Campaign>(campaign.id)
        .then(accept)
        .catch((problem) => setError(problem.message));
    }, 10000);
    return () => clearInterval(timer);
  }, [campaign?.id, step]);
  useEffect(() => {
    if (editor.current && step === 1)
      editor.current.innerHTML = campaign?.html || "";
  }, [step, campaign?.id]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  async function save() {
    if (!campaign) return;
    const html = editor.current?.innerHTML ?? campaign.html;
    const next = await api<Campaign>(`${campaign.id}/save`, {
      version: campaign.version,
      name: campaign.name,
      subject: campaign.subject,
      html,
    });
    accept(next);
    return next;
  }
  function editTeam(id: string, patch: Partial<Person>) {
    dirty.current = true;
    setTeams((current) =>
      current.map((p) => {
        if (p.id !== id) return p;
        const next = { ...p, ...patch };
        if (patch.email !== undefined && patch.email !== p.email)
          next.shared_confirmed = 0;
        next.issue = !next.team.trim()
          ? "Missing team name"
          : !next.name.trim()
            ? "Missing first participant name"
            : !/^\S+@\S+\.\S+$/.test(next.email)
              ? "Invalid first participant email"
              : current.some(
                    (other) =>
                      other.id !== id &&
                      other.email.toLowerCase() === next.email.toLowerCase(),
                  ) && !next.shared_confirmed
                ? "Shared recipient address. Confirm this team should receive its own email."
                : "";
        return next;
      }),
    );
  }
  async function saveTeams() {
    if (!campaign) return;
    accept(
      await api<Campaign>(`${campaign.id}/import`, {
        version: campaign.version,
        teams,
      }),
    );
    setNotice("Team list saved");
  }
  async function action(name: string, body: object = {}) {
    if (!campaign) return;
    accept(await api<Campaign>(`${campaign.id}/${name}`, body));
  }
  function insertToken(token: string) {
    editor.current?.focus();
    document.execCommand("insertText", false, token);
    dirty.current = true;
  }
  const activePerson =
    teams.find((p) => p.id === selected) || teams.find((p) => p.enabled);
  const visible = teams.filter(
    (p) =>
      `${p.team} ${p.name} ${p.email}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (step !== 3 || status === "all" || p.status === status),
  );
  useEffect(() => setPage(0), [query, status, step]);
  const pageIndex = Math.min(
    page,
    Math.max(0, Math.ceil(visible.length / 50) - 1),
  );
  const pageTeams = visible.slice(pageIndex * 50, (pageIndex + 1) * 50);
  const readonly = campaign?.state !== "draft";

  if (loading)
    return (
      <div className={styles.app}>
        <p>Loading campaign workspace…</p>
      </div>
    );
  if (!user)
    return (
      <div className={`${styles.app} ${styles.login}`}>
        <form
          className={styles.card}
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void perform(async () => {
              const result = await api<{ username: string }>("login", {
                username: form.get("username"),
                password: form.get("password"),
              });
              setUser(result.username);
              await refreshList();
            });
          }}
        >
          <img src="/images/mibc-logo.webp" alt="MIBC" width="84" height="60" />
          <h1>Email campaigns</h1>
          <p>Sign in to manage team communications.</p>
          <label>
            Username
            <input
              name="username"
              type="email"
              autoComplete="username"
              required
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          <button disabled={busy}>Sign in</button>
        </form>
      </div>
    );

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <a href="/" aria-label="MIBC home">
          <img src="/images/mibc-logo.webp" alt="MIBC" width="66" height="48" />
        </a>
        <strong>Email campaigns</strong>
        <span>{user}</span>
        <button
          disabled={busy}
          onClick={() => {
            if (
              dirty.current &&
              !window.confirm("Discard unsaved edits and sign out?")
            )
              return;
            void perform(async () => {
              await api("logout", {});
              setUser(null);
              setCampaign(null);
              dirty.current = false;
              setTeams([]);
            });
          }}
        >
          Sign out
        </button>
      </header>
      <main className={styles.main}>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        {!campaign ? (
          <>
            <h1>Campaigns</h1>
            <div className={styles.row}>
              <label>
                New campaign name
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Example: Round 1 results"
                />
              </label>
              <button
                disabled={busy || !newName.trim()}
                onClick={() =>
                  void perform(async () => {
                    if (!newName.trim()) return;
                    accept(await api<Campaign>("", { name: newName }));
                    setNewName("");
                    setStep(0);
                  })
                }
              >
                Add campaign
              </button>
            </div>
            <div className={styles.row}>
              <span>
                {list.length} {trash ? "deleted" : "active"} campaigns
              </span>
              <button
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    setTrash(!trash);
                    await refreshList(!trash);
                  })
                }
              >
                {trash ? "Show active campaigns" : "View trash"}
              </button>
            </div>
            <div className={styles.card}>
              {list.length ? (
                list.map((item) => (
                  <article className={styles.campaignItem} key={item.id}>
                    <div>
                      <strong>{item.name}</strong>
                      <span className={styles.helper}>
                        {item.state === "done" ? "Completed" : item.state}
                      </span>
                    </div>
                    <div className={styles.actions}>
                      {trash ? (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void perform(async () => {
                              await api(item.id + "/restore", {});
                              await refreshList(true);
                              setNotice("Campaign restored");
                            })
                          }
                        >
                          Restore
                        </button>
                      ) : (
                        <>
                          <button
                            disabled={busy}
                            onClick={() =>
                              void perform(async () => {
                                accept(await api<Campaign>(item.id));
                                setStep(item.state === "draft" ? 0 : 3);
                                setQuery("");
                                setSelected("");
                              })
                            }
                          >
                            {item.state === "draft" ? "Edit" : "View results"}
                          </button>
                          <button
                            disabled={busy}
                            onClick={() =>
                              void perform(async () => {
                                const name = window.prompt(
                                  "Campaign name",
                                  item.name,
                                );
                                if (name?.trim()) {
                                  await api(item.id + "/rename", { name });
                                  await refreshList();
                                }
                              })
                            }
                          >
                            Rename
                          </button>
                          <button
                            className={styles.danger}
                            disabled={busy || item.state === "running"}
                            onClick={() => {
                              if (
                                window.confirm(
                                  "Move this campaign to Trash? You can restore it later.",
                                )
                              )
                                void perform(async () => {
                                  await api(item.id + "/archive", {});
                                  await refreshList();
                                  setNotice(
                                    "Moved to Trash. You can restore it from View trash.",
                                  );
                                });
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
                <p>
                  {trash
                    ? "Trash is empty. Deleted campaigns can be restored here."
                    : "Create your first campaign to upload teams."}
                </p>
              )}{" "}
            </div>
          </>
        ) : (
          <>
            <div className={styles.row}>
              <button
                disabled={busy}
                onClick={() => {
                  if (
                    dirty.current &&
                    !window.confirm("Discard unsaved edits?")
                  )
                    return;
                  dirty.current = false;
                  setCampaign(null);
                  void perform(refreshList);
                }}
              >
                ← Campaigns
              </button>
              <strong>{campaign.name}</strong>
              <div className={styles.actions}>
                <span>{campaign.state}</span>
                <button
                  disabled={busy}
                  onClick={() => {
                    if (
                      dirty.current &&
                      !window.confirm(
                        "Discard unsaved edits and copy the saved version?",
                      )
                    )
                      return;
                    void perform(async () => {
                      accept(await api<Campaign>(campaign.id + "/copy", {}));
                      setSelected("");
                      setStep(0);
                      setNotice(
                        "A new editable draft was created. Review it and send a fresh test before launch.",
                      );
                    });
                  }}
                >
                  Copy and edit
                </button>
              </div>
            </div>
            <nav className={styles.steps} aria-label="Campaign steps">
              {["Teams", "Compose", "Review & test", "Sending & results"].map(
                (label, index) => (
                  <button
                    disabled={busy}
                    aria-current={step === index ? "step" : undefined}
                    key={label}
                    onClick={() => {
                      if (dirty.current) {
                        setError("Save your edits before changing steps");
                        return;
                      }
                      setStep(index);
                    }}
                  >
                    {index + 1}. {label}
                  </button>
                ),
              )}
            </nav>
            {step === 0 && (
              <>
                <h1>Teams and recipients</h1>
                <p>One email per team, sent to the first listed participant.</p>
                <section className={styles.card}>
                  <label>
                    Registration CSV
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      disabled={busy || readonly}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        void perform(async () => {
                          if (file.size > 3_000_000)
                            throw new Error("CSV must be under 3 MB");
                          const result = await api<{ teams: Person[] }>(
                            "parse",
                            { csv: await file.text() },
                          );
                          setTeams(result.teams);
                          dirty.current = true;
                          setNotice(
                            "Review and save the imported teams. Your previous list stays active until saved.",
                          );
                        });
                      }}
                    />
                  </label>
                  <div className={styles.row}>
                    <span>
                      {teams.length} teams ·{" "}
                      {teams.filter((p) => p.enabled).length} selected ·{" "}
                      {teams.filter((p) => p.enabled && p.issue).length} flagged
                    </span>
                    <button
                      disabled={busy || readonly}
                      onClick={() => void perform(saveTeams)}
                    >
                      Save team list
                    </button>
                  </div>
                </section>
                <label>
                  Search teams
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
                <div className={styles.row}>
                  <span className={styles.helper}>
                    Edit a team to correct any member’s details. Save changes
                    before continuing.
                  </span>
                  <button
                    disabled={busy || readonly}
                    onClick={() => {
                      const id = crypto.randomUUID();
                      setTeams((current) => [
                        {
                          id,
                          team: "",
                          name: "",
                          email: "",
                          members: [{ name: "", email: "" }],
                          enabled: true,
                          issue: "Add the team name and first member details",
                        },
                        ...current,
                      ]);
                      setSelected(id);
                      setQuery("");
                      setPage(0);
                      dirty.current = true;
                    }}
                  >
                    Add team
                  </button>
                </div>
                <div className={styles.teamList}>
                  {pageTeams.map((p) => (
                    <article className={styles.teamListItem} key={p.id}>
                      <div className={styles.teamRow}>
                        <label className={styles.include}>
                          <input
                            aria-label={"Include " + (p.team || "new team")}
                            type="checkbox"
                            checked={!!p.enabled}
                            disabled={readonly || busy}
                            onChange={(e) =>
                              editTeam(p.id, { enabled: e.target.checked })
                            }
                          />
                        </label>
                        <div>
                          <h2>{p.team || "Unnamed team"}</h2>
                          <p className={styles.helper}>
                            {p.name || "Missing recipient"} ·{" "}
                            {p.email || "Missing email"} · {p.members.length}{" "}
                            members
                          </p>
                          {p.issue && <p className={styles.flag}>{p.issue}</p>}
                        </div>
                        <div className={styles.actions}>
                          <button
                            aria-expanded={selected === p.id}
                            onClick={() =>
                              setSelected(selected === p.id ? "" : p.id)
                            }
                          >
                            {selected === p.id
                              ? "Close"
                              : readonly
                                ? "Details"
                                : "Edit details"}
                          </button>
                          {!readonly && (
                            <button
                              disabled={busy}
                              className={styles.danger}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    "Remove this team from the draft? Save the team list to apply.",
                                  )
                                ) {
                                  setTeams((current) =>
                                    current.filter((team) => team.id !== p.id),
                                  );
                                  if (selected === p.id) setSelected("");
                                  dirty.current = true;
                                }
                              }}
                            >
                              Remove team
                            </button>
                          )}
                        </div>
                      </div>
                      {selected === p.id && (
                        <TeamDetails
                          person={p}
                          readonly={readonly}
                          busy={busy}
                          onChange={(patch) => editTeam(p.id, patch)}
                          onSave={() => void perform(saveTeams)}
                          onClose={() => setSelected("")}
                        />
                      )}
                    </article>
                  ))}
                </div>
              </>
            )}
            {step === 1 && (
              <>
                <h1>Write your email</h1>
                <div className={styles.columns}>
                  <section className={styles.card}>
                    <label>
                      Campaign name
                      <input
                        disabled={readonly}
                        value={campaign.name}
                        onChange={(e) => {
                          dirty.current = true;
                          setCampaign({ ...campaign, name: e.target.value });
                        }}
                      />
                    </label>
                    <label>
                      Subject
                      <input
                        disabled={readonly}
                        value={campaign.subject}
                        onChange={(e) => {
                          dirty.current = true;
                          setCampaign({ ...campaign, subject: e.target.value });
                        }}
                      />
                    </label>
                    <label>
                      Upload HTML template
                      <input
                        type="file"
                        accept=".html,.htm,text/html"
                        disabled={readonly}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file)
                            void perform(async () => {
                              if (file.size > 200000)
                                throw new Error(
                                  "Template must be under 200 KB",
                                );
                              const html = await file.text();
                              accept(
                                await api<Campaign>(`${campaign.id}/save`, {
                                  ...campaign,
                                  html,
                                  version: campaign.version,
                                }),
                              );
                              if (editor.current)
                                editor.current.innerHTML = (
                                  await api<Campaign>(campaign.id)
                                ).html;
                            });
                        }}
                      />
                    </label>
                    {!readonly && (
                      <div className={styles.toolbar}>
                        {[
                          ["Bold", "bold"],
                          ["Italic", "italic"],
                          ["Underline", "underline"],
                          ["Bullet list", "insertUnorderedList"],
                          ["Numbered list", "insertOrderedList"],
                          ["Clear format", "removeFormat"],
                        ].map(([text, command]) => (
                          <button
                            key={command}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              document.execCommand(command);
                              dirty.current = true;
                            }}
                          >
                            {text}
                          </button>
                        ))}
                        <button
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            const url = window.prompt("Link URL (https://…)");
                            if (url && /^https?:\/\//.test(url)) {
                              document.execCommand("createLink", false, url);
                              dirty.current = true;
                            }
                          }}
                        >
                          Link
                        </button>
                        <button
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => insertToken("{{team_name}}")}
                        >
                          + Team name
                        </button>
                        <button
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => insertToken("{{recipient_name}}")}
                        >
                          + Recipient name
                        </button>
                      </div>
                    )}
                    <div
                      ref={editor}
                      className={styles.editor}
                      contentEditable={!readonly}
                      suppressContentEditableWarning
                      role="textbox"
                      aria-label="Email body"
                      aria-multiline="true"
                      onInput={() => {
                        dirty.current = true;
                      }}
                      onPaste={(event) => {
                        event.preventDefault();
                        const doc = new DOMParser().parseFromString(
                          event.clipboardData.getData("text/html") ||
                            `<p>${escape(event.clipboardData.getData("text/plain")).replace(/\n/g, "<br>")}</p>`,
                          "text/html",
                        );
                        doc
                          .querySelectorAll(
                            "script,style,iframe,object,form,input,img,svg,math,link,meta,video,audio,source,embed,base",
                          )
                          .forEach((el) => el.remove());
                        doc.querySelectorAll<HTMLElement>("*").forEach((el) => {
                          const oldStyle = el.style;
                          const safeStyle = [
                            "text-align",
                            "font-weight",
                            "font-style",
                            "text-decoration",
                          ]
                            .map((key) => [key, oldStyle.getPropertyValue(key)])
                            .filter(([, value]) =>
                              /^(left|right|center|bold|normal|[1-9]00|italic|underline)$/.test(
                                value,
                              ),
                            );
                          el.removeAttribute("style");
                          safeStyle.forEach(([key, value]) =>
                            el.style.setProperty(key, value),
                          );
                          [...el.attributes].forEach((a) => {
                            if (
                              a.name !== "style" &&
                              !(
                                el.tagName === "A" &&
                                a.name === "href" &&
                                /^https?:\/\//i.test(a.value)
                              )
                            )
                              el.removeAttribute(a.name);
                          });
                        });
                        document.execCommand(
                          "insertHTML",
                          false,
                          doc.body.innerHTML,
                        );
                        dirty.current = true;
                      }}
                    />
                    <p>
                      Paste Google Docs content here. Save to sanitize the
                      template and update the preview.
                    </p>
                    <button
                      disabled={busy || readonly}
                      onClick={() =>
                        void perform(async () => {
                          await save();
                          setNotice("Draft saved");
                        })
                      }
                    >
                      Save email and preview
                    </button>
                  </section>
                  <section>
                    <h2>Saved preview</h2>
                    <Preview campaign={campaign} person={activePerson} />
                  </section>
                </div>
              </>
            )}
            {step === 2 && (
              <>
                <h1>Review and test</h1>
                <ol className={styles.reviewHelp}>
                  <li>
                    <strong>Preview a team</strong>
                    <span>
                      Check the recipient and personalized wording below.
                    </span>
                  </li>
                  <li>
                    <strong>Send yourself a test</strong>
                    <span>
                      Enter your address. Only that address receives the test.
                    </span>
                  </li>
                  <li>
                    <strong>Check your inbox</strong>
                    <span>
                      After the test is accepted, review the actual email before
                      starting the campaign.
                    </span>
                  </li>
                </ol>
                <div className={styles.columns}>
                  <section className={styles.card}>
                    <label>
                      Preview team
                      <select
                        value={activePerson?.id || ""}
                        onChange={(e) => setSelected(e.target.value)}
                      >
                        {teams.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.team} · {p.email}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Preview campaign={campaign} person={activePerson} />
                  </section>
                  <section className={styles.card}>
                    <h2>Sending summary</h2>
                    <p>NSU MIBC &lt;info@nsumibc.online&gt;</p>
                    <p>
                      {teams.filter((p) => p.enabled).length} selected teams ·
                      one copy per selected recipient
                    </p>
                    <p>
                      {campaign.settings.provider} · Target:{" "}
                      {campaign.settings.perMinute} emails per minute
                      <br />
                      {campaign.settings.used} / {campaign.settings.dailyLimit}{" "}
                      reserved attempts in 24 hours
                    </p>
                    <label>
                      Test email
                      <input
                        type="email"
                        value={testEmail}
                        onChange={(e) => setTestEmail(e.target.value)}
                      />
                    </label>
                    <button
                      disabled={busy || readonly || !activePerson}
                      onClick={() =>
                        void perform(async () => {
                          await action("test", {
                            email: testEmail,
                            recipientId: activePerson?.id,
                          });
                          setNotice(
                            "Test queued for your test address only. The sender checks about every 10 minutes; a scheduled run may be delayed.",
                          );
                        })
                      }
                    >
                      Queue test email
                    </button>
                    <p>
                      {campaign.tested_version === campaign.version
                        ? "Test accepted by the email provider. Check your inbox and spam folder before launch."
                        : "Send a successful test of this saved version to unlock Start sending. Saving edits requires a new test."}
                    </p>
                    {campaign.people
                      .filter((p) => p.is_test)
                      .map((p) => (
                        <p key={p.id}>
                          Test to {p.email} · {p.status} {p.error}
                        </p>
                      ))}
                    {campaign.tested_version === campaign.version && (
                      <label>
                        <span>
                          <input
                            type="checkbox"
                            checked={testReviewed}
                            onChange={(e) => setTestReviewed(e.target.checked)}
                          />{" "}
                          I reviewed the test email and recipient list
                        </span>
                      </label>
                    )}
                    <button
                      disabled={
                        busy ||
                        !testReviewed ||
                        campaign.state !== "draft" ||
                        campaign.tested_version !== campaign.version
                      }
                      onClick={() => {
                        if (
                          window.confirm(
                            `Start sending to ${teams.filter((p) => p.enabled).length} teams using ${campaign.settings.provider}?`,
                          )
                        )
                          void perform(async () => {
                            await action("start", { reviewed: true });
                            setStep(3);
                          });
                      }}
                    >
                      Start sending
                    </button>
                    <p>
                      The daily allowance counts only this system. Ticket emails
                      and other mailbox use share Hostinger’s actual limit.
                      Leave room for those sends.
                    </p>
                    <p>
                      Sender activity{" "}
                      {campaign.settings.heartbeat
                        ? new Date(campaign.settings.heartbeat).toLocaleString()
                        : "has not been received yet"}
                      . Scheduled starts may take several minutes.
                    </p>
                  </section>
                </div>
              </>
            )}
            {step === 3 && (
              <>
                <h1>Sending and results</h1>
                <div className={styles.stats}>
                  {["queued", "sending", "sent", "failed", "uncertain"].map(
                    (state) => (
                      <div className={styles.card} key={state}>
                        <strong>
                          {
                            teams.filter((p) => p.enabled && p.status === state)
                              .length
                          }
                        </strong>
                        <span>
                          {state === "sent" ? "Accepted / confirmed" : state}
                        </span>
                      </div>
                    ),
                  )}
                </div>
                <div className={styles.toolbar}>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void perform(async () =>
                        accept(await api<Campaign>(campaign.id)),
                      )
                    }
                  >
                    Refresh
                  </button>
                  <button
                    disabled={busy || campaign.state !== "running"}
                    onClick={() => void perform(() => action("pause"))}
                  >
                    Pause sending
                  </button>
                  <button
                    disabled={busy || campaign.state !== "paused"}
                    onClick={() => void perform(() => action("start"))}
                  >
                    Resume
                  </button>
                  <button
                    disabled={busy || campaign.state === "running"}
                    onClick={() =>
                      void perform(() => action("retry", { status: "failed" }))
                    }
                  >
                    Retry failed
                  </button>
                </div>
                {campaign.last_error && (
                  <p role="alert" className={styles.error}>
                    {campaign.last_error}
                  </p>
                )}
                <p>
                  Last sender activity{" "}
                  {campaign.settings.heartbeat
                    ? new Date(campaign.settings.heartbeat).toLocaleString()
                    : "not received"}
                  . Pausing allows an in-progress email to finish.
                </p>
                <div className={styles.columns}>
                  <label>
                    Search teams
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  <label>
                    Filter status
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                    >
                      {[
                        "all",
                        "queued",
                        "sending",
                        "sent",
                        "failed",
                        "uncertain",
                      ].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <button
                  onClick={() => {
                    const rows = [
                      [
                        "Team",
                        "Recipient",
                        "Email",
                        "Status",
                        "Attempts",
                        "Error",
                      ],
                      ...teams.map((p) => [
                        p.team,
                        p.name,
                        p.email,
                        p.status || "",
                        String(p.attempts || 0),
                        p.error || "",
                      ]),
                    ];
                    const csv = rows
                      .map((row) =>
                        row
                          .map(
                            (v) =>
                              `"${String(v)
                                .replace(/^[=+@-]/, "'$&")
                                .replace(/"/g, '""')}"`,
                          )
                          .join(","),
                      )
                      .join("\r\n");
                    const url = URL.createObjectURL(
                      new Blob([csv], { type: "text/csv" }),
                    );
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "campaign-results.csv";
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  Export results CSV
                </button>
                <div className={styles.teamGrid}>
                  {pageTeams.map((p) => (
                    <article className={styles.card} key={p.id}>
                      <h2>{p.team}</h2>
                      <p>
                        {p.name}
                        <br />
                        {p.email}
                      </p>
                      <strong>
                        {p.status === "sent"
                          ? "Accepted / confirmed"
                          : p.status}
                      </strong>
                      {p.status === "uncertain" && (
                        <button
                          disabled={busy || campaign.state === "running"}
                          onClick={() => {
                            if (
                              window.confirm(
                                "I checked provider records or the recipient and confirmed this email was delivered. Mark resolved without sending again?",
                              )
                            )
                              void perform(() =>
                                action("resolve", {
                                  recipientId: p.id,
                                  confirm: true,
                                }),
                              );
                          }}
                        >
                          Confirm delivery without resending
                        </button>
                      )}
                      <details>
                        <summary>Attempt history</summary>
                        {campaign.history
                          .filter((a) => a.recipient_id === p.id)
                          .map((a) => (
                            <p key={a.id}>
                              {new Date(a.started_at).toLocaleString()} ·{" "}
                              {a.status}
                              <br />
                              {a.error || a.message_id}
                            </p>
                          ))}
                      </details>
                      <p>
                        Attempts {p.attempts || 0}
                        {p.sent_at
                          ? ` · ${new Date(p.sent_at).toLocaleString()}`
                          : ""}
                      </p>
                      {p.error && <p className={styles.error}>{p.error}</p>}
                      {["failed", "sent", "uncertain"].includes(
                        p.status || "",
                      ) && (
                        <button
                          disabled={busy || campaign.state === "running"}
                          onClick={() => {
                            const confirm =
                              p.status === "failed" ||
                              window.confirm(
                                `This may send another copy to ${p.email}. Continue?`,
                              );
                            if (confirm)
                              void perform(() =>
                                action("retry", {
                                  status: p.status,
                                  recipientId: p.id,
                                  confirm: true,
                                }),
                              );
                          }}
                        >
                          {p.status === "sent" ? "Resend" : "Review and retry"}
                        </button>
                      )}
                    </article>
                  ))}
                </div>
              </>
            )}
            <div className={styles.row}>
              {(step === 0 || step === 3) && (
                <>
                  <span>
                    {visible.length ? pageIndex * 50 + 1 : 0}–
                    {Math.min((pageIndex + 1) * 50, visible.length)} of{" "}
                    {visible.length} teams
                  </span>
                  <button
                    disabled={pageIndex === 0}
                    onClick={() => setPage(pageIndex - 1)}
                  >
                    Previous teams
                  </button>
                  <button
                    disabled={(pageIndex + 1) * 50 >= visible.length}
                    onClick={() => setPage(pageIndex + 1)}
                  >
                    Next teams
                  </button>
                </>
              )}
            </div>
            <div className={styles.row}>
              <button
                disabled={busy || step === 0}
                onClick={() => {
                  if (dirty.current) {
                    setError("Save edits first");
                    return;
                  }
                  setStep(step - 1);
                }}
              >
                ← Back
              </button>
              {step < 2 && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      // Saving creates a new version and invalidates a passed test,
                      // so only save when this step has unsaved edits.
                      if (!readonly && dirty.current) {
                        if (step === 0) await saveTeams();
                        else await save();
                      }
                      setStep(step + 1);
                    })
                  }
                >
                  Continue →
                </button>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
