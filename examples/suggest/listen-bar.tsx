import React from "react";
import type { ListenState, Span } from "./listen.ts";

export interface ListenInfo {
  label: string;
  /** Text shown in the bar, with the spoken word marked (summaries only). */
  text: string | null;
}

export function ListenBar(props: {
  state: ListenState;
  info: ListenInfo;
  word: Span | null;
  onToggle: () => void;
  onStop: () => void;
}): React.ReactElement {
  const { state, info, word } = props;
  const busy = state === "loading";
  const text = info.text;
  return (
    <div className="sg-listen" role="region" aria-label="Listen">
      <div className="sg-listen-row">
        <button
          type="button"
          className="sg-listen-play"
          onClick={props.onToggle}
          disabled={busy}
          aria-label={state === "playing" ? "Pause" : "Play"}
        >
          {busy ? (
            <span className="sg-listen-spin" />
          ) : state === "playing" ? (
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M6 5h4v14H6zM14 5h4v14h-4z" fill="currentColor" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M8 5v14l11-7z" fill="currentColor" />
            </svg>
          )}
        </button>
        <span className="sg-listen-label">
          {busy ? "Preparing audio…" : info.label}
        </span>
        <button
          type="button"
          className="sg-listen-close"
          onClick={props.onStop}
          aria-label="Stop listening"
        >
          ×
        </button>
      </div>
      {text ? (
        <p className="sg-listen-text">
          {word ? (
            <>
              {text.slice(0, word.from)}
              <mark className="sg-spoken">
                {text.slice(word.from, word.to)}
              </mark>
              {text.slice(word.to)}
            </>
          ) : (
            text
          )}
        </p>
      ) : null}
    </div>
  );
}
