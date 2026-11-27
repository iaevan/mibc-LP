"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./campaigns.module.css";
import { api, useTask, when, type ListSummary } from "./api";

type Item = {
  id: number;
  at: number;
  username: string;
  name: string;
  role: string;
  action: string;
  summary: string;
};
type Person = { username: string; name: string; role: string };

export function ActivityLog() {
  const task = useTask();
  const [items, setItems] = useState<Item[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [user, setUser] = useState("");
  const [list, setList] = useState("");
  const [more, setMore] = useState(false);
  const load = useCallback(
    async (before = 0) => {
      const params = new URLSearchParams();
      if (user) params.set("user", user);
      if (list) params.set("list", list);
      if (before) params.set("before", String(before));
      const result = await api<{ items: Item[]; people: Person[] }>(`activity?${params}`);
      setPeople(result.people);
      setItems((current) => (before ? [...current, ...result.items] : result.items));
      setMore(result.items.length === 100);
    },
    [user, list],
  );
  useEffect(() => {
    void task.run(() => load());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);
  useEffect(() => {
    void api<ListSummary[]>("lists").then(setLists).catch(() => undefined);
  }, []);
  return (
    <>
      <h1>Activity log</h1>
      <p className={styles.helper}>Every change to team lists and emails, newest first.</p>
      <div className={styles.searchRow}>
        <label>
          Person
          <select value={user} onChange={(e) => setUser(e.target.value)}>
            <option value="">Everyone</option>
            {people.map((p) => (
              <option key={p.username} value={p.username}>
                {p.name}
                {p.role === "helper" ? " (helper)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Team list
          <select value={list} onChange={(e) => setList(e.target.value)}>
            <option value="">All lists</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {task.error && <p className={styles.error}>{task.error}</p>}
      <ol className={styles.activity}>
        {items.map((item) => (
          <li key={item.id}>
            <span className={styles.helper}>{when(item.at)}</span>
            <strong>
              {item.name}
              {item.role === "helper" && <span className={styles.badge}>Helper</span>}
            </strong>
            <span>{item.summary}</span>
          </li>
        ))}
        {!items.length && !task.busy && <li className={styles.empty}>No activity yet.</li>}
      </ol>
      {more && (
        <button disabled={task.busy} onClick={() => void task.run(() => load(items[items.length - 1].id))}>
          Show older
        </button>
      )}
    </>
  );
}
