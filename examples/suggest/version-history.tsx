import React, { useMemo, useState } from "react";
import type { Version } from "./docs.ts";

type Piece = { text: string; kind: "same" | "add" | "del" };

const MAX_CELLS = 4_000_000;

/** Word-level diff of `before` to `after`; null when the inputs are too large to compare. */
export function diffWords(before: string, after: string): Piece[] | null {
  const a = before.split(/(\s+)/).filter(Boolean);
  const b = after.split(/(\s+)/).filter(Boolean);
  if (a.length * b.length > MAX_CELLS) return null;
  const w = b.length + 1;
  const lcs = new Uint32Array((a.length + 1) * w);
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lcs[i * w + j] =
        a[i] === b[j]
          ? lcs[(i + 1) * w + j + 1] + 1
          : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
  const out: Piece[] = [];
  const push = (kind: Piece["kind"], text: string) => {
    const last = out[out.length - 1];
    if (last?.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push("same", b[j]);
      i++;
      j++;
    } else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) push("del", a[i++]);
    else push("add", b[j++]);
  }
  while (i < a.length) push("del", a[i++]);
  while (j < b.length) push("add", b[j++]);
  return out;
}

const CURRENT = "current";

const stamp = (at: number) =>
  new Date(at).toLocaleString(undefined, {
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export function VersionHistory(props: {
  tabTitle: string;
  currentText: string;
  versions: Version[];
  canRestore: boolean;
  onRestore: (text: string) => void;
  onClose: () => void;
}): React.ReactElement {
  const { versions, currentText } = props;
  const [selected, setSelected] = useState(CURRENT);
  const [namedOnly, setNamedOnly] = useState(false);
  const [highlight, setHighlight] = useState(true);

  const shown = namedOnly ? versions.filter((v) => v.name) : versions;
  const index = versions.findIndex((v) => v.id === selected);
  const text =
    selected === CURRENT ? currentText : (versions[index]?.text ?? "");
  const previous = selected === CURRENT ? versions[0] : versions[index + 1];
  const pieces = useMemo(
    () => (highlight && previous ? diffWords(previous.text, text) : null),
    [highlight, previous, text],
  );
  const edits = pieces?.filter((p) => p.kind !== "same").length ?? 0;

  return (
    <div className="sg-vh" role="dialog" aria-label="Version history">
      <div className="sg-vh-main">
        <div className="sg-vh-bar">
          <button
            type="button"
            className="sg-tool sg-btn"
            aria-label="Back to document"
            onClick={props.onClose}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path
                fill="currentColor"
                d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20z"
              />
            </svg>
          </button>
          <h2>
            {selected === CURRENT
              ? "Current version"
              : (versions[index]?.name ?? stamp(versions[index]?.at ?? 0))}
            <span className="sg-vh-tab"> · {props.tabTitle}</span>
          </h2>
          <span className="sg-vh-total">
            {pieces ? `Total: ${edits} change${edits === 1 ? "" : "s"}` : ""}
          </span>
          {props.canRestore && selected !== CURRENT ? (
            <button
              type="button"
              className="sg-primary"
              onClick={() => {
                props.onRestore(text);
                props.onClose();
              }}
            >
              Restore this version
            </button>
          ) : null}
        </div>
        <div className="sg-vh-page">
          <pre className="sg-vh-text">
            {pieces
              ? pieces.map((p, i) =>
                  p.kind === "same" ? (
                    <React.Fragment key={i}>{p.text}</React.Fragment>
                  ) : p.kind === "add" ? (
                    <ins key={i}>{p.text}</ins>
                  ) : (
                    <del key={i}>{p.text}</del>
                  ),
                )
              : text || "(empty)"}
          </pre>
        </div>
      </div>
      <aside className="sg-vh-side">
        <h3>Version history</h3>
        <select
          className="sg-vh-filter"
          aria-label="Filter versions"
          value={namedOnly ? "named" : "all"}
          onChange={(e) => setNamedOnly(e.target.value === "named")}
        >
          <option value="all">All versions</option>
          <option value="named">Named versions</option>
        </select>
        <ul className="sg-vh-list">
          {namedOnly ? null : (
            <li>
              <button
                type="button"
                aria-current={selected === CURRENT}
                onClick={() => setSelected(CURRENT)}
              >
                <strong>Current version</strong>
                <span>Live document</span>
              </button>
            </li>
          )}
          {shown.map((v) => (
            <li key={v.id}>
              <button
                type="button"
                aria-current={selected === v.id}
                onClick={() => setSelected(v.id)}
              >
                <strong>{v.name ?? stamp(v.at)}</strong>
                {v.name ? <span>{stamp(v.at)}</span> : null}
                <span>{v.by}</span>
              </button>
            </li>
          ))}
          {shown.length === 0 ? (
            <li className="sg-vh-empty">
              {namedOnly
                ? "No named versions yet. Use File → Version history → Name current version."
                : "Earlier versions appear here as you edit."}
            </li>
          ) : null}
        </ul>
        <label className="sg-vh-highlight">
          <input
            type="checkbox"
            checked={highlight}
            onChange={(e) => setHighlight(e.target.checked)}
          />
          Highlight changes
        </label>
      </aside>
    </div>
  );
}
