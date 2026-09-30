import React, { useEffect, useRef, useState } from "react";
import {
  createDocument,
  deleteDocument,
  watchDocuments,
  watchShared,
  type SharedDoc,
  type DocSummary,
} from "./docs.ts";
import { Avatar, logOut, type Person } from "./session.tsx";

export function go(path: string): void {
  window.location.hash = path;
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function AccountMenu(props: { person: Person }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (
        e instanceof KeyboardEvent
          ? e.key === "Escape"
          : !ref.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div className="sg-account" ref={ref}>
      <button
        type="button"
        className="sg-account-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${props.person.name}`}
        title={props.person.name}
        onClick={() => setOpen((v) => !v)}
      >
        <Avatar person={props.person} />
      </button>
      {open ? (
        <div className="sg-account-menu" role="menu">
          <div className="sg-account-who">
            <strong>{props.person.name}</strong>
            {props.person.email ? <span>{props.person.email}</span> : null}
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              go("/");
              void logOut();
            }}
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function GridPage(props: { person: Person }): React.ReactElement {
  const { person } = props;
  const [docs, setDocs] = useState<DocSummary[] | null>(null);
  const [error, setError] = useState("");
  const [shared, setShared] = useState<SharedDoc[]>([]);
  useEffect(() => watchShared(person.email, setShared), [person.email]);

  useEffect(
    () =>
      watchDocuments(
        person.uid,
        (d) => {
          setDocs(d);
          setError("");
        },
        () => setError("Couldn't load your documents."),
      ),
    [person.uid],
  );

  const create = async () => {
    try {
      go(`/d/${await createDocument(person.uid)}`);
    } catch (err) {
      console.warn("createDocument failed:", err);
      setError("Couldn't create a document.");
    }
  };

  return (
    <div className="sg-app sg-home">
      <header className="sg-home-head">
        <svg className="sg-logo" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 2h8l6 6v14H6z" fill="#4285f4" />
          <path d="M14 2l6 6h-6z" fill="#a1c2fa" />
          <path d="M9 13h8v1.5H9zm0 3h8v1.5H9zm0-6h4v1.5H9z" fill="#fff" />
        </svg>
        <h1>Documents</h1>
        <AccountMenu person={person} />
      </header>
      <main className="sg-grid-wrap">
        {error ? <p className="sg-auth-error">{error}</p> : null}
        <ul className="sg-grid">
          <li>
            <button
              type="button"
              className="sg-tile sg-tile-new"
              onClick={() => void create()}
            >
              <span className="sg-plus" aria-hidden="true">
                +
              </span>
              New document
            </button>
          </li>
          {(docs ?? []).map((d) => (
            <li key={d.id} className="sg-tile-cell">
              <button
                type="button"
                className="sg-tile"
                onClick={() => go(`/d/${d.id}`)}
              >
                <span className="sg-tile-preview">{d.snippet || " "}</span>
                <span className="sg-tile-title">
                  {d.title || "Untitled document"}
                </span>
                <span className="sg-tile-meta">Edited {ago(d.updatedAt)}</span>
              </button>
              <button
                type="button"
                className="sg-tile-del"
                aria-label={`Delete ${d.title}`}
                title="Delete"
                onClick={() => {
                  if (
                    window.confirm(`Delete "${d.title}"? This can't be undone.`)
                  ) {
                    void deleteDocument(person.uid, d.id).catch(() =>
                      setError("Couldn't delete that document."),
                    );
                  }
                }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
        {docs && docs.length === 0 ? (
          <p className="sg-empty">No documents yet. Start one above.</p>
        ) : null}
        {shared.length > 0 ? (
          <>
            <h2 className="sg-grid-heading">Shared with me</h2>
            <ul className="sg-grid">
              {shared.map((d) => (
                <li key={d.id} className="sg-tile-cell">
                  <button
                    type="button"
                    className="sg-tile"
                    onClick={() => go(`/d/${d.id}`)}
                  >
                    <span className="sg-tile-preview"> </span>
                    <span className="sg-tile-title">
                      {d.title || "Untitled document"}
                    </span>
                    <span className="sg-tile-meta">
                      Can{" "}
                      {d.role === "editor"
                        ? "edit"
                        : d.role === "commenter"
                          ? "comment"
                          : "view"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </main>
    </div>
  );
}
