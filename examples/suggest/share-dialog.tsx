import React, { useEffect, useState } from "react";
import {
  setLinkAccess,
  shareWith,
  unshare,
  watchMembers,
  type Access,
  type Member,
  type Role,
} from "./docs.ts";
import { Avatar, type Person } from "./session.tsx";

const ROLES: { value: Role; label: string }[] = [
  { value: "viewer", label: "Viewer" },
  { value: "commenter", label: "Commenter" },
  { value: "editor", label: "Editor" },
];

const EMAIL = /^[^\s@#$[\]/]+@[^\s@#$[\]/]+\.[^\s@#$[\]/]+$/;

export function shareUrl(docId: string): string {
  return `${location.origin}${location.pathname}#/d/${docId}`;
}

export function ShareButton(props: {
  link: Role | undefined;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      className="sg-share-btn"
      onClick={props.onClick}
      aria-label="Share"
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        {props.link ? (
          <path
            fill="currentColor"
            d="M12 2a10 10 0 100 20 10 10 0 000-20zm6.9 6h-2.95a15.7 15.7 0 00-1.38-3.56A8.03 8.03 0 0118.9 8zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14a8.2 8.2 0 010-4h3.38a16.5 16.5 0 000 4H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56A7.99 7.99 0 015.08 16zm2.95-8H5.08a7.99 7.99 0 014.33-3.56A15.7 15.7 0 008.03 8zM12 19.96A14.1 14.1 0 0110.09 16h3.82A14.1 14.1 0 0112 19.96zM14.34 14H9.66a14.7 14.7 0 010-4h4.68a14.7 14.7 0 010 4zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95a8.03 8.03 0 01-4.33 3.56zM16.36 14a16.5 16.5 0 000-4h3.38a8.2 8.2 0 010 4h-3.38z"
          />
        ) : (
          <path
            fill="currentColor"
            d="M18 8h-1V6a5 5 0 00-10 0v2H6a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V10a2 2 0 00-2-2zM9 6a3 3 0 016 0v2H9V6zm9 14H6V10h12v10zm-6-3a2 2 0 100-4 2 2 0 000 4z"
          />
        )}
      </svg>
      Share
    </button>
  );
}

export function ShareDialog(props: {
  docId: string;
  title: string;
  access: Access;
  link: Role | undefined;
  person: Person;
  onClose: () => void;
}): React.ReactElement {
  const { docId, access, link, person } = props;
  const isOwner = access === "owner";
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(
    () => (isOwner ? watchMembers(docId, setMembers) : undefined),
    [docId, isOwner],
  );
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [props.onClose]);

  const attempt = async (action: () => Promise<void>, message: string) => {
    setError("");
    try {
      await action();
    } catch (err) {
      console.warn(message, err);
      setError(message);
    }
  };

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const value = email.trim();
    if (!EMAIL.test(value)) return setError("Enter a valid email address.");
    if (value.toLowerCase() === person.email?.toLowerCase())
      return setError("You already own this document.");
    void attempt(async () => {
      await shareWith(docId, value, role);
      setEmail("");
    }, "Couldn't share with that address.");
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl(docId));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Couldn't copy. Copy the address bar instead.");
    }
  };

  return (
    <div
      className="sg-modal-back"
      onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}
    >
      <div
        className="sg-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Share"
      >
        <h2>Share “{props.title}”</h2>
        {isOwner ? (
          <form onSubmit={add} className="sg-share-add">
            <input
              className="sg-field"
              type="text"
              placeholder="Add people by email"
              aria-label="Add people by email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <select
              aria-label="Role for new person"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <button type="submit" className="sg-primary">
              Share
            </button>
          </form>
        ) : null}
        {error ? (
          <p className="sg-auth-error" role="alert">
            {error}
          </p>
        ) : null}

        <h3>People with access</h3>
        <ul className="sg-people">
          {isOwner ? (
            <li>
              <Avatar person={person} />
              <span className="sg-person">
                {person.name} (you)
                <small>{person.email}</small>
              </span>
              <span className="sg-role-fixed">Owner</span>
            </li>
          ) : (
            <li>
              <span className="sg-person">
                You have {access} access
                <small>{person.email ?? "Signed in as a guest"}</small>
              </span>
            </li>
          )}
          {members.map((m) => (
            <li key={m.email}>
              <span className="sg-person">{m.email}</span>
              <select
                aria-label={`Role for ${m.email}`}
                value={m.role}
                onChange={(e) =>
                  e.target.value === "remove"
                    ? void attempt(
                        () => unshare(docId, m.email),
                        "Couldn't remove access.",
                      )
                    : void attempt(
                        () => shareWith(docId, m.email, e.target.value as Role),
                        "Couldn't change access.",
                      )
                }
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
                <option value="remove">Remove access</option>
              </select>
            </li>
          ))}
        </ul>

        <h3>General access</h3>
        <div className="sg-general">
          <span className="sg-general-icon" aria-hidden="true">
            {link ? "🌐" : "🔒"}
          </span>
          <div className="sg-general-body">
            {isOwner ? (
              <select
                aria-label="General access"
                value={link ? "link" : "restricted"}
                onChange={(e) =>
                  void attempt(
                    () =>
                      setLinkAccess(
                        docId,
                        e.target.value === "link" ? "viewer" : null,
                      ),
                    "Couldn't change general access.",
                  )
                }
              >
                <option value="restricted">Restricted</option>
                <option value="link">Anyone with the link</option>
              </select>
            ) : (
              <strong>{link ? "Anyone with the link" : "Restricted"}</strong>
            )}
            <small>
              {link
                ? `Anyone on the internet with the link can ${link === "editor" ? "edit" : link === "commenter" ? "comment" : "view"}`
                : "Only people with access can open with the link"}
            </small>
          </div>
          {isOwner && link ? (
            <select
              aria-label="Link role"
              value={link}
              onChange={(e) =>
                void attempt(
                  () => setLinkAccess(docId, e.target.value as Role),
                  "Couldn't change general access.",
                )
              }
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          ) : null}
        </div>

        <div className="sg-modal-foot">
          <button
            type="button"
            className="sg-outline"
            onClick={() => void copy()}
          >
            {copied ? "Link copied" : "Copy link"}
          </button>
          <button type="button" className="sg-primary" onClick={props.onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
