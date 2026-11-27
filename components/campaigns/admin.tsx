"use client";

import { useEffect, useState } from "react";
import styles from "./campaigns.module.css";
import { ApiError, SIGNED_OUT, api, useTask, type Me } from "./api";
import { ListView, ListsHome } from "./lists";
import { EmailView, EmailsHome } from "./emails";
import { ActivityLog } from "./activity";

// The address bar remembers the open screen, so a reload keeps your place.
function useRoute() {
  const read = () => (typeof window === "undefined" ? "" : window.location.hash.slice(1));
  const [route, setRoute] = useState("");
  useEffect(() => {
    setRoute(read());
    const update = () => setRoute(read());
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return [route, (next: string) => (window.location.hash = next)] as const;
}

export function CampaignAdmin() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [route, go] = useRoute();
  const login = useTask();

  useEffect(() => {
    api<Me>("session")
      .then(setMe)
      .catch((problem) => {
        if (!(problem instanceof ApiError && problem.status === 401)) login.setError(problem.message);
      })
      .finally(() => setLoading(false));
    const signedOut = () => setMe(null);
    window.addEventListener(SIGNED_OUT, signedOut);
    return () => window.removeEventListener(SIGNED_OUT, signedOut);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading)
    return (
      <div className={styles.app}>
        <p className={styles.main}>Loading…</p>
      </div>
    );
  if (!me)
    return (
      <div className={`${styles.app} ${styles.login}`}>
        <form
          className={styles.card}
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void login.run(async () =>
              setMe(
                await api<Me>("login", {
                  username: String(form.get("username") || "").trim(),
                  password: form.get("password"),
                }),
              ),
            );
          }}
        >
          <img src="/images/mibc-logo.webp" alt="MIBC" width="84" height="60" />
          <h1>MIBC team emails</h1>
          <p className={styles.helper}>Sign in with the username you were given.</p>
          <label>
            Username
            <input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required />
          </label>
          <label>
            Password
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          {login.error && (
            <p role="alert" className={styles.error}>
              {login.error}
            </p>
          )}
          <button className={styles.primary} disabled={login.busy}>
            {login.busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    );

  const [section, id] = route.split("/");
  const admin = me.role === "admin";
  const tab = admin && (section === "emails" || section === "email") ? "emails" : admin && section === "activity" ? "activity" : "lists";
  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <a href="/" aria-label="MIBC home">
          <img src="/images/mibc-logo.webp" alt="MIBC" width="66" height="48" />
        </a>
        <nav className={styles.tabs} aria-label="Sections">
          <button aria-current={tab === "lists" ? "page" : undefined} onClick={() => go("lists")}>
            Team lists
          </button>
          {admin && (
            <>
              <button aria-current={tab === "emails" ? "page" : undefined} onClick={() => go("emails")}>
                Emails
              </button>
              <button aria-current={tab === "activity" ? "page" : undefined} onClick={() => go("activity")}>
                Activity
              </button>
            </>
          )}
        </nav>
        <span>
          {me.name}
          {!admin && " (helper)"}
        </span>
        <button
          onClick={() =>
            void api("logout", {})
              .catch(() => undefined)
              .finally(() => setMe(null))
          }
        >
          Sign out
        </button>
      </header>
      <main className={styles.main}>
        {tab === "lists" &&
          (section === "list" && id ? (
            <ListView key={id} id={id} me={me} back={() => go("lists")} />
          ) : (
            <ListsHome me={me} open={(listId) => go(`list/${listId}`)} />
          ))}
        {tab === "emails" &&
          (section === "email" && id ? (
            <EmailView key={id} id={id} back={() => go("emails")} />
          ) : (
            <EmailsHome open={(emailId) => go(`email/${emailId}`)} />
          ))}
        {tab === "activity" && <ActivityLog />}
      </main>
    </div>
  );
}
