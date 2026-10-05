import React, { useState } from "react";
import type { Comment, Reply } from "./docs.ts";
import type { Person } from "./session.tsx";

export interface Draft {
  quote: string;
  from: number;
}

const ago = (ms: number): string => {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
};

function Byline(props: {
  by: { name: string; color: string };
  at: number;
  actions?: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="sg-cm-by">
      <span
        className="sg-cm-dot"
        style={{ background: props.by.color }}
        aria-hidden="true"
      >
        {props.by.name.slice(0, 1).toUpperCase()}
      </span>
      <strong>{props.by.name}</strong>
      <small>{typeof props.at === "number" ? ago(props.at) : ""}</small>
      {props.actions ? (
        <span className="sg-cm-tools">{props.actions}</span>
      ) : null}
    </div>
  );
}

function Quote(props: { text: string; lost?: boolean }): React.ReactElement {
  const [open, setOpen] = useState(false);
  if (!props.text)
    return <div className="sg-cm-quote sg-cm-whole">Whole document</div>;
  const long = props.text.length > 90;
  return (
    <div
      className={`sg-cm-quote${props.lost ? " sg-cm-lost" : ""}`}
      data-open={open}
    >
      <span>{props.text}</span>
      {long ? (
        <button
          type="button"
          className="sg-link"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
        >
          {open ? "Less" : "More"}
        </button>
      ) : null}
    </div>
  );
}

function Box(props: {
  placeholder: string;
  submit: string;
  autoFocus?: boolean;
  compact?: boolean;
  onSubmit: (text: string) => void;
  onCancel?: () => void;
}): React.ReactElement {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const showActions = !props.compact || focused || text.length > 0;
  const send = () => {
    if (!text.trim()) return;
    props.onSubmit(text.trim());
    setText("");
  };
  return (
    <div className="sg-cm-box">
      <textarea
        rows={props.compact && !showActions ? 1 : 2}
        value={text}
        autoFocus={props.autoFocus}
        placeholder={props.placeholder}
        aria-label={props.placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
          if (e.key === "Escape") {
            setText("");
            props.onCancel?.();
            e.currentTarget.blur();
          }
        }}
      />
      <div className="sg-cm-actions" hidden={!showActions}>
        {props.onCancel ? (
          <button
            type="button"
            className="sg-link"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setText("");
              props.onCancel?.();
            }}
          >
            Cancel
          </button>
        ) : null}
        <button
          type="button"
          className="sg-primary"
          disabled={!text.trim()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={send}
        >
          {props.submit}
        </button>
      </div>
    </div>
  );
}

export function CommentsPanel(props: {
  person: Person;
  comments: Comment[];
  replies: Record<string, Reply[]>;
  located: Set<string>;
  draft: Draft | null;
  activeId: string | null;
  thinking: Set<string>;
  canComment: boolean;
  canModerate: boolean;
  onDraft: (text: string) => void;
  onCancelDraft: () => void;
  onSelect: (id: string) => void;
  onReply: (id: string, text: string) => void;
  onResolve: (id: string, resolved: boolean) => void;
  onDelete: (id: string) => void;
  onDeleteReply: (id: string, replyId: string) => void;
  onClose: () => void;
}): React.ReactElement {
  const { person, comments } = props;
  const [showResolved, setShowResolved] = useState(false);
  const open = comments.filter((c) => !c.resolved);
  const resolved = comments.filter((c) => c.resolved);
  const list = showResolved ? resolved : open;

  return (
    <aside className="sg-cm" aria-label="Comments">
      <header className="sg-cm-head">
        <h3>Comments</h3>
        <button
          type="button"
          className="sg-link"
          onClick={() => setShowResolved((v) => !v)}
        >
          {showResolved ? "Show open" : `Resolved (${resolved.length})`}
        </button>
        <button
          type="button"
          className="sg-tool sg-btn"
          aria-label="Close comments"
          onClick={props.onClose}
        >
          ✕
        </button>
      </header>
      <div className="sg-cm-list">
        {props.draft ? (
          <div className="sg-cm-thread sg-cm-draft">
            <Quote text={props.draft.quote} />
            <Box
              autoFocus
              placeholder={
                props.canModerate
                  ? "Comment, or @scribe to ask"
                  : "Add a comment"
              }
              submit="Comment"
              onSubmit={props.onDraft}
              onCancel={props.onCancelDraft}
            />
          </div>
        ) : null}
        {list.map((c) => {
          const replies = props.replies[c.id] ?? [];
          const mine = c.by === person.uid;
          return (
            <div
              key={c.id}
              className="sg-cm-thread"
              aria-current={props.activeId === c.id}
              onClick={() => props.onSelect(c.id)}
            >
              <Quote
                text={c.quote}
                lost={!!c.quote && !props.located.has(c.id)}
              />
              <Byline
                by={c}
                at={c.at}
                actions={
                  <>
                    {(mine || props.canModerate) && (
                      <button
                        type="button"
                        className="sg-link"
                        onClick={(e) => {
                          e.stopPropagation();
                          props.onResolve(c.id, !c.resolved);
                        }}
                      >
                        {c.resolved ? "Reopen" : "Resolve"}
                      </button>
                    )}
                    {(mine || props.canModerate) && (
                      <button
                        type="button"
                        className="sg-link sg-cm-danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          props.onDelete(c.id);
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </>
                }
              />
              <p>{c.text}</p>
              {replies.map((r) => (
                <div key={r.id} className="sg-cm-reply">
                  <Byline
                    by={r}
                    at={r.at}
                    actions={
                      r.by === person.uid || props.canModerate ? (
                        <button
                          type="button"
                          className="sg-link sg-cm-danger"
                          onClick={(e) => {
                            e.stopPropagation();
                            props.onDeleteReply(c.id, r.id);
                          }}
                        >
                          Delete
                        </button>
                      ) : null
                    }
                  />
                  <p>{r.text}</p>
                </div>
              ))}
              {props.thinking.has(c.id) ? (
                <div className="sg-cm-thinking">Scribe is working on it…</div>
              ) : null}
              {props.canComment && !c.resolved ? (
                <Box
                  compact
                  placeholder={
                    props.canModerate ? "Reply, or @scribe to ask" : "Reply"
                  }
                  submit="Reply"
                  onSubmit={(text) => props.onReply(c.id, text)}
                />
              ) : null}
            </div>
          );
        })}
        {list.length === 0 && !props.draft ? (
          <p className="sg-cm-empty">
            {showResolved
              ? "No resolved comments."
              : props.canComment
                ? "Select text and choose Add comment to start a conversation."
                : "No comments yet."}
          </p>
        ) : null}
      </div>
    </aside>
  );
}
