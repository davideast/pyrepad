import React, { useState } from "react";

const CHIPS = [
  "Accept all",
  "Reject all",
  "New tab from suggestions",
  "Name all tabs",
];

export function Composer(props: {
  onSubmit: (text: string) => Promise<string | void>;
  note: string;
  onNote: (note: string) => void;
}): React.ReactElement {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async (value: string) => {
    if (!value.trim() || busy) return;
    setBusy(true);
    props.onNote("");
    try {
      props.onNote((await props.onSubmit(value.trim())) ?? "");
      setText("");
    } catch {
      props.onNote("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sg-composer">
      {props.note ? (
        <p className="sg-composer-note" role="status">
          {props.note}
        </p>
      ) : null}
      <div className="sg-chips">
        {CHIPS.map((c) => (
          <button
            key={c}
            type="button"
            className="sg-chip"
            disabled={busy}
            onClick={() => void send(c)}
          >
            {c}
          </button>
        ))}
      </div>
      <form
        className={
          busy ? "sg-composer-box sg-composer-busy" : "sg-composer-box"
        }
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <input
          className="sg-composer-input"
          placeholder="Ask Scribe to accept, reject, change instructions, or add a tab…"
          aria-label="Command Scribe"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          type="submit"
          className="sg-send"
          aria-label="Send"
          disabled={busy || !text.trim()}
        >
          ↑
        </button>
      </form>
    </div>
  );
}
