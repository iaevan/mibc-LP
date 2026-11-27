"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./campaigns.module.css";
import {
  api,
  downloadCsv,
  useTask,
  when,
  type ListSummary,
  type Me,
  type Team,
  type TeamList,
} from "./api";
import { TeamEditor } from "./team-editor";

const PAGE = 50;
const readFile = async (file: File) => {
  if (file.size > 3_000_000) throw new Error("The CSV must be under 3 MB");
  return file.text();
};

export function ListsHome({ me, open }: { me: Me; open: (id: string) => void }) {
  const task = useTask();
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [trash, setTrash] = useState(false);
  const [name, setName] = useState("");
  const [rounds, setRounds] = useState(3);
  const [file, setFile] = useState<File | null>(null);
  const load = useCallback(
    (showTrash = trash) =>
      task.run(async () => setLists(await api<ListSummary[]>(`lists${showTrash ? "?trash=1" : ""}`))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trash],
  );
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <>
      <h1>Team lists</h1>
      <p className={styles.helper}>
        Upload the registration sheet once. Everyone fixes it here, and every email uses the corrected list.
      </p>
      <form
        className={styles.card}
        onSubmit={(event) => {
          event.preventDefault();
          void task.run(async () => {
            if (!name.trim()) throw new Error("Enter a name for the team list");
            const csv = file ? await readFile(file) : "";
            const { id } = await api<{ id: string }>("lists", { name, rounds, csv });
            open(id);
          });
        }}
      >
        <h2>New team list</h2>
        <div className={styles.formGrid}>
          <label>
            Competition name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Case Competition 2026"
            />
          </label>
          <label>
            Number of rounds
            <select value={rounds} onChange={(e) => setRounds(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Registration sheet (CSV)
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </label>
        <p className={styles.helper}>
          In Google Sheets choose File, Download, Comma-separated values (.csv). The first member of each team is the leader.
        </p>
        {task.error && <p className={styles.error} role="alert">{task.error}</p>}
        <button className={styles.primary} disabled={task.busy}>
          {task.busy ? "Creating…" : "Create team list"}
        </button>
      </form>
      <div className={styles.row}>
        <h2>{trash ? "Deleted team lists" : "Your team lists"}</h2>
        {me.role === "admin" && (
          <button
            onClick={() => {
              setTrash(!trash);
              void load(!trash);
            }}
          >
            {trash ? "Show active lists" : "View trash"}
          </button>
        )}
      </div>
      {task.notice && <p role="status">{task.notice}</p>}
      <div className={styles.card}>
        {lists.length ? (
          lists.map((list) => (
            <article className={styles.campaignItem} key={list.id}>
              <div>
                <strong>{list.name}</strong>
                <span className={styles.helper}>
                  {list.teams} teams · {list.rounds} rounds · updated {when(list.updated_at)}
                </span>
              </div>
              <div className={styles.actions}>
                {trash ? (
                  <button
                    onClick={() =>
                      void task.run(async () => {
                        await api(`lists/${list.id}/restore`, {});
                        await load(true);
                      }, "Team list restored")
                    }
                  >
                    Restore
                  </button>
                ) : (
                  <>
                    <button className={styles.primary} onClick={() => open(list.id)}>
                      Open
                    </button>
                    {me.role === "admin" && (
                      <button
                        className={styles.danger}
                        onClick={() => {
                          if (window.confirm(`Move "${list.name}" to Trash? Emails already sent are kept.`))
                            void task.run(async () => {
                              await api(`lists/${list.id}/archive`, {});
                              await load(false);
                            }, "Moved to Trash");
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </>
                )}
              </div>
            </article>
          ))
        ) : (
          <p>{trash ? "Trash is empty." : "Create your first team list above."}</p>
        )}
      </div>
    </>
  );
}

type Filter = "all" | "problems" | "deleted" | `round-${number}`;

export function ListView({ id, me, back }: { id: string; me: Me; back: () => void }) {
  const task = useTask();
  const [list, setList] = useState<TeamList | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<"name" | "round">("name");
  const [page, setPage] = useState(0);
  const [openTeam, setOpenTeam] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [panel, setPanel] = useState<"" | "rounds" | "sheet" | "settings">("");

  const load = useCallback(async () => {
    setList(await api<TeamList>(`lists/${id}`));
  }, [id]);
  useEffect(() => {
    void task.run(load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);
  // Pick up other people's changes while nobody here is editing a team.
  useEffect(() => {
    const timer = setInterval(() => {
      if (!openTeam && !panel && !document.hidden) void load().catch(() => undefined);
    }, 20000);
    return () => clearInterval(timer);
  }, [load, openTeam, panel]);
  useEffect(() => setPage(0), [query, filter, sort]);

  const teams = useMemo(() => list?.teams || [], [list]);
  const live = teams.filter((t) => !t.deleted_at);
  const problems = live.filter((t) => t.issue);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return teams
      .filter(
        (t) =>
          // The team being edited stays on screen even once it no longer matches.
          t.id === openTeam ||
          (filter === "deleted"
            ? !!t.deleted_at
            : !t.deleted_at &&
              (filter === "all" ||
                (filter === "problems" && !!t.issue) ||
                (filter.startsWith("round-") && t.round >= Number(filter.slice(6))))),
      )
      .filter(
        (t) =>
          !q ||
          `${t.team} ${t.leader_name} ${t.leader_email} ${t.members.map((m) => `${m.name} ${m.email} ${m.phone} ${m.studentId}`).join(" ")}`
            .toLowerCase()
            .includes(q),
      )
      .sort((a, b) =>
        sort === "round" && a.round !== b.round
          ? b.round - a.round
          : a.team.localeCompare(b.team, "en", { numeric: true, sensitivity: "base" }),
      );
  }, [teams, query, filter, sort, openTeam]);
  const pages = Math.max(1, Math.ceil(visible.length / PAGE));
  const current = Math.min(page, pages - 1);
  const shown = visible.slice(current * PAGE, current * PAGE + PAGE);

  if (!list)
    return (
      <>
        <button onClick={back}>← Team lists</button>
        {task.error ? <p className={styles.error}>{task.error}</p> : <p>Loading team list…</p>}
      </>
    );
  const replaceTeams = (next: Team[] | null, one?: Team) =>
    setList((value) =>
      value
        ? {
            ...value,
            teams: next || value.teams.map((t) => (one && t.id === one.id ? one : t)),
          }
        : value,
    );
  const roundCounts = Array.from({ length: list.rounds }, (_, i) =>
    live.filter((t) => t.round >= i + 1).length,
  );

  return (
    <>
      <div className={styles.row}>
        <button onClick={back}>← Team lists</button>
        <button onClick={() => setPanel(panel === "settings" ? "" : "settings")}>
          List settings
        </button>
      </div>
      <h1>{list.name}</h1>
      <div className={styles.chips} role="group" aria-label="Filter teams">
        <button aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
          All teams <strong>{live.length}</strong>
        </button>
        {roundCounts.slice(1).map((count, i) => (
          <button
            key={i}
            aria-pressed={filter === `round-${i + 2}`}
            onClick={() => setFilter(`round-${i + 2}`)}
          >
            In Round {i + 2} <strong>{count}</strong>
          </button>
        ))}
        <button
          aria-pressed={filter === "problems"}
          className={problems.length ? styles.warnChip : undefined}
          onClick={() => setFilter("problems")}
        >
          Needs attention <strong>{problems.length}</strong>
        </button>
        <button aria-pressed={filter === "deleted"} onClick={() => setFilter("deleted")}>
          Deleted <strong>{teams.length - live.length}</strong>
        </button>
      </div>
      {task.error && <p className={styles.error} role="alert">{task.error}</p>}
      {task.notice && <p role="status">{task.notice}</p>}
      {panel === "settings" && (
        <ListSettings
          list={list}
          close={() => setPanel("")}
          saved={async () => {
            setPanel("");
            await load();
          }}
        />
      )}
      <div className={styles.toolbar}>
        <button
          disabled={task.busy}
          onClick={() =>
            void task.run(async () => {
              const result = await api<{ id: string; teams: Team[] }>(`lists/${id}/team`, {
                team: "",
                members: [{ name: "", email: "" }],
              });
              replaceTeams(result.teams);
              setFilter("all");
              setQuery("");
              setOpenTeam(result.id);
            })
          }
        >
          Add a team
        </button>
        <button onClick={() => setPanel(panel === "sheet" ? "" : "sheet")}>
          Add teams from a sheet
        </button>
        {list.rounds > 1 && (
          <button onClick={() => setPanel(panel === "rounds" ? "" : "rounds")}>
            Move qualified teams
          </button>
        )}
        <button
          onClick={() =>
            downloadCsv(`${list.name}.csv`, [
              ["Team", "Round", "Leader", "Leader email", "Leader phone", "Members", "Problem"],
              ...live.map((t) => [
                t.team,
                String(t.round),
                t.leader_name,
                t.leader_email,
                t.members[0]?.phone || "",
                t.members.slice(1).map((m) => m.name).join("; "),
                t.issue,
              ]),
            ])
          }
        >
          Download CSV
        </button>
      </div>
      {panel === "sheet" && (
        <AddSheet
          listId={id}
          close={() => setPanel("")}
          done={async (message) => {
            setPanel("");
            await load();
            task.setNotice(message);
          }}
        />
      )}
      {panel === "rounds" && (
        <RoundMover
          list={list}
          close={() => setPanel("")}
          done={(teamsNow, message) => {
            replaceTeams(teamsNow);
            setPanel("");
            task.setNotice(message);
          }}
        />
      )}
      <div className={styles.searchRow}>
        <label>
          Search
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Team, leader, email, phone or student ID"
          />
        </label>
        <label>
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as "name" | "round")}>
            <option value="name">Team name A to Z</option>
            <option value="round">Highest round first</option>
          </select>
        </label>
      </div>
      {selected.size > 0 && list.rounds > 1 && (
        <SelectionBar
          count={selected.size}
          rounds={list.rounds}
          busy={task.busy}
          clear={() => setSelected(new Set())}
          move={(round) =>
            void task.run(async () => {
              const result = await api<{ moved: number; teams: Team[] }>(`lists/${id}/round`, {
                teamIds: [...selected],
                round,
              });
              replaceTeams(result.teams);
              setSelected(new Set());
              task.setNotice(`Moved ${result.moved} teams to Round ${round}`);
            })
          }
        />
      )}
      <p className={styles.helper}>
        {visible.length} teams shown.{" "}
        {filter === "problems" && !problems.length && "No problems left. "}
        Open a team to fix it. Changes save on their own.
      </p>
      <div className={styles.teamList}>
        {shown.map((t) => (
          <article className={styles.teamListItem} key={t.id}>
            <div className={styles.teamRow}>
              <label className={styles.include}>
                <input
                  type="checkbox"
                  aria-label={`Select ${t.team || "unnamed team"}`}
                  checked={selected.has(t.id)}
                  disabled={!!t.deleted_at}
                  onChange={(e) =>
                    setSelected((value) => {
                      const next = new Set(value);
                      if (e.target.checked) next.add(t.id);
                      else next.delete(t.id);
                      return next;
                    })
                  }
                />
              </label>
              <div>
                <h2>
                  {t.team || "Unnamed team"}{" "}
                  {list.rounds > 1 && <span className={styles.badge}>Round {t.round}</span>}
                </h2>
                <p className={styles.helper}>
                  {t.leader_name || "No leader name"} · {t.leader_email || "No email"} · {t.members.length}{" "}
                  {t.members.length === 1 ? "member" : "members"}
                </p>
                {t.issue && <p className={styles.flag}>{t.issue}</p>}
              </div>
              <div className={styles.actions}>
                {t.deleted_at ? (
                  <button
                    onClick={() =>
                      void task.run(async () => {
                        const result = await api<{ teams: Team[] }>(`teams/${t.id}/restore`, {});
                        replaceTeams(result.teams);
                      }, "Team restored")
                    }
                  >
                    Restore
                  </button>
                ) : (
                  <>
                    <button
                      aria-expanded={openTeam === t.id}
                      onClick={() => setOpenTeam(openTeam === t.id ? "" : t.id)}
                    >
                      {openTeam === t.id ? "Close" : "Open"}
                    </button>
                    <button
                      className={styles.danger}
                      onClick={() => {
                        if (window.confirm(`Delete "${t.team || "this team"}"? You can restore it from Deleted.`))
                          void task.run(async () => {
                            const result = await api<{ teams: Team[] }>(`teams/${t.id}/delete`, {});
                            if (openTeam === t.id) setOpenTeam("");
                            replaceTeams(result.teams);
                          }, "Team deleted. Restore it from the Deleted filter.");
                      }}
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            </div>
            {openTeam === t.id && (
              <TeamEditor
                team={t}
                rounds={list.rounds}
                onSaved={(next, one) => replaceTeams(next, one)}
                onClose={() => setOpenTeam("")}
              />
            )}
          </article>
        ))}
        {!shown.length && <p className={styles.empty}>No teams match.</p>}
      </div>
      {pages > 1 && (
        <div className={styles.row}>
          <span>
            Page {current + 1} of {pages}
          </span>
          <div className={styles.actions}>
            <button disabled={current === 0} onClick={() => setPage(current - 1)}>
              Previous
            </button>
            <button disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
              Next
            </button>
          </div>
        </div>
      )}
      {me.role === "helper" && (
        <p className={styles.helper}>
          Main admins can see every change you make in the activity log.
        </p>
      )}
    </>
  );
}

function SelectionBar({
  count,
  rounds,
  busy,
  clear,
  move,
}: {
  count: number;
  rounds: number;
  busy: boolean;
  clear: () => void;
  move: (round: number) => void;
}) {
  const [round, setRound] = useState(2);
  return (
    <div className={styles.selectionBar}>
      <strong>{count} selected</strong>
      <label>
        Move to
        <select value={round} onChange={(e) => setRound(Number(e.target.value))}>
          {Array.from({ length: rounds }, (_, i) => (
            <option key={i} value={i + 1}>
              Round {i + 1}
            </option>
          ))}
        </select>
      </label>
      <button className={styles.primary} disabled={busy} onClick={() => move(round)}>
        Move
      </button>
      <button onClick={clear}>Clear selection</button>
    </div>
  );
}

function ListSettings({
  list,
  close,
  saved,
}: {
  list: TeamList;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const task = useTask();
  const [name, setName] = useState(list.name);
  const [rounds, setRounds] = useState(list.rounds);
  return (
    <section className={styles.card}>
      <h2>List settings</h2>
      <div className={styles.formGrid}>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Rounds
          <select value={rounds} onChange={(e) => setRounds(Number(e.target.value))}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      {task.error && <p className={styles.error}>{task.error}</p>}
      <div className={styles.actions}>
        <button
          className={styles.primary}
          disabled={task.busy}
          onClick={() =>
            void task.run(async () => {
              await api(`lists/${list.id}/settings`, { name, rounds });
              await saved();
            })
          }
        >
          Save settings
        </button>
        <button onClick={close}>Cancel</button>
      </div>
    </section>
  );
}

type Preview = { team: string; leader_name: string; leader_email: string; status: string };
function AddSheet({
  listId,
  close,
  done,
}: {
  listId: string;
  close: () => void;
  done: (message: string) => Promise<void>;
}) {
  const task = useTask();
  const [preview, setPreview] = useState<Preview[] | null>(null);
  const fresh = preview?.filter((t) => t.status === "new") || [];
  return (
    <section className={styles.card}>
      <h2>Add teams from a sheet</h2>
      <p className={styles.helper}>
        Nothing is replaced. Teams already in the list (same team name or leader email) are skipped.
      </p>
      <label>
        Registration sheet (CSV)
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file)
              void task.run(async () => {
                const csv = await readFile(file);
                setPreview((await api<{ teams: Preview[] }>(`lists/${listId}/preview`, { csv })).teams);
              });
          }}
        />
      </label>
      {task.error && <p className={styles.error}>{task.error}</p>}
      {preview && (
        <>
          <p>
            <strong>{fresh.length} new teams</strong> · {preview.length - fresh.length} already in the list
          </p>
          {fresh.length > 0 && (
            <ul className={styles.compactList}>
              {fresh.slice(0, 30).map((t, i) => (
                <li key={i}>
                  {t.team || "Unnamed team"} · {t.leader_email || "no email"}
                </li>
              ))}
              {fresh.length > 30 && <li>and {fresh.length - 30} more</li>}
            </ul>
          )}
        </>
      )}
      <div className={styles.actions}>
        <button
          className={styles.primary}
          disabled={task.busy || !fresh.length}
          onClick={() =>
            void task.run(async () => {
              const result = await api<{ added: number; skipped: number }>(`lists/${listId}/add`, {
                teams: fresh,
              });
              await done(`Added ${result.added} teams`);
            })
          }
        >
          Add {fresh.length || ""} teams
        </button>
        <button onClick={close}>Cancel</button>
      </div>
    </section>
  );
}

type Match = {
  line: string;
  status: "match" | "ambiguous" | "missing";
  candidates: { id: string; team: string; leader_name: string; leader_email: string; round: number }[];
};
function RoundMover({
  list,
  close,
  done,
}: {
  list: TeamList;
  close: () => void;
  done: (teams: Team[], message: string) => void;
}) {
  const task = useTask();
  const [text, setText] = useState("");
  const [round, setRound] = useState(2);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [choices, setChoices] = useState<Record<number, string>>({});
  // The same team pasted twice (by name and by email) counts once.
  const chosen = [
    ...new Set(
      (matches || [])
        .map((m, i) => (m.status === "match" ? m.candidates[0].id : choices[i]))
        .filter(Boolean) as string[],
    ),
  ];
  const missing = matches?.filter((m) => m.status === "missing") || [];
  return (
    <section className={styles.card}>
      <h2>Move qualified teams</h2>
      <p className={styles.helper}>
        Paste the qualified teams, one per line. Use the team name or the leader&apos;s email. You can move a team back the same way.
      </p>
      <label>
        Qualified teams
        <textarea
          rows={6}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setMatches(null);
          }}
          placeholder={"The Overthinkers\nleader@example.com"}
        />
      </label>
      <label>
        Move them to
        <select value={round} onChange={(e) => setRound(Number(e.target.value))}>
          {Array.from({ length: list.rounds }, (_, i) => (
            <option key={i} value={i + 1}>
              Round {i + 1}
            </option>
          ))}
        </select>
      </label>
      {task.error && <p className={styles.error}>{task.error}</p>}
      {!matches ? (
        <div className={styles.actions}>
          <button
            className={styles.primary}
            disabled={task.busy || !text.trim()}
            onClick={() =>
              void task.run(async () => {
                setChoices({});
                setMatches((await api<{ results: Match[] }>(`lists/${list.id}/match`, { text })).results);
              })
            }
          >
            Find teams
          </button>
          <button onClick={close}>Cancel</button>
        </div>
      ) : (
        <>
          <ul className={styles.matchList}>
            {matches.map((m, i) => (
              <li key={i} data-status={m.status}>
                <strong>{m.line}</strong>
                {m.status === "match" && (
                  <span>
                    Found: {m.candidates[0].team} · {m.candidates[0].leader_email} (Round {m.candidates[0].round})
                  </span>
                )}
                {m.status === "missing" && <span>Not found. Check the spelling or use the leader email.</span>}
                {m.status === "ambiguous" && (
                  <label>
                    More than one team has this {m.line.includes("@") ? "leader email" : "name"}. Choose one:
                    <select
                      value={choices[i] || ""}
                      onChange={(e) => setChoices({ ...choices, [i]: e.target.value })}
                    >
                      <option value="">Skip this line</option>
                      {m.candidates.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.team} · {c.leader_name} · {c.leader_email}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </li>
            ))}
          </ul>
          <p>
            {chosen.length} teams will move to Round {round}.
            {missing.length > 0 && ` ${missing.length} lines were not found.`}
          </p>
          <div className={styles.actions}>
            <button
              className={styles.primary}
              disabled={task.busy || !chosen.length}
              onClick={() =>
                void task.run(async () => {
                  const result = await api<{ moved: number; teams: Team[] }>(`lists/${list.id}/round`, {
                    teamIds: chosen,
                    round,
                  });
                  done(result.teams, `Moved ${result.moved} teams to Round ${round}`);
                })
              }
            >
              Move {chosen.length} teams
            </button>
            <button onClick={() => setMatches(null)}>Edit the list</button>
            <button onClick={close}>Cancel</button>
          </div>
        </>
      )}
    </section>
  );
}
