import React, { useEffect, useRef, useState } from "react";
import { MAIN_TAB } from "./firebase.ts";
import type { DocTab } from "./docs.ts";

const MIN_W = 160;
const MAX_W = 480;
const DEFAULT_W = 220;
const DOCK_BELOW = 110;
const RAIL_W = 44;
const KEY = "pyrepad-suggest-tabs";

function loadLayout(): { width: number; docked: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (v && typeof v.width === "number") {
      return {
        width: Math.min(MAX_W, Math.max(MIN_W, v.width)),
        docked: v.docked === true,
      };
    }
  } catch {
    // unreadable storage: default layout
  }
  return { width: DEFAULT_W, docked: false };
}

/** Width in px, or docked to a slim rail; dragging the edge past DOCK_BELOW docks it. */
function useTabsLayout() {
  const [layout, setLayout] = useState(loadLayout);
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? (layout.docked ? RAIL_W : layout.width);

  useEffect(() => {
    document.documentElement.style.setProperty("--sg-tabs-w", `${shown}px`);
  }, [shown]);
  useEffect(
    () => () => document.documentElement.style.removeProperty("--sg-tabs-w"),
    [],
  );
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(layout));
    } catch {
      // storage unavailable
    }
  }, [layout]);

  const commit = (w: number) =>
    setLayout((l) =>
      w < DOCK_BELOW
        ? { ...l, docked: true }
        : { width: Math.min(MAX_W, Math.max(MIN_W, w)), docked: false },
    );
  return { layout, shown, drag, setDrag, commit, setLayout };
}

export function TabsPanel(props: {
  tabs: DocTab[];
  active: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  /** Readers cannot add, rename or delete tabs. */
  readOnly?: boolean;
}): React.ReactElement {
  const [editing, setEditing] = useState<string | null>(null);
  const { layout, shown, drag, setDrag, commit, setLayout } = useTabsLayout();
  const navRef = useRef<HTMLElement>(null);

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const left = navRef.current!.getBoundingClientRect().left;
    let latest = shown;
    const move = (ev: PointerEvent) => {
      latest = Math.min(MAX_W, Math.max(0, ev.clientX - left));
      setDrag(latest);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      commit(latest);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const handle = (
    <div
      className="sg-tabs-grip"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize tabs panel"
      tabIndex={0}
      onPointerDown={startDrag}
      onDoubleClick={() => setLayout((l) => ({ ...l, docked: !l.docked }))}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") commit(shown - 20);
        if (e.key === "ArrowRight") commit(Math.max(shown, MIN_W) + 20);
      }}
    />
  );

  if (layout.docked && drag === null) {
    return (
      <nav
        ref={navRef}
        className="sg-tabs sg-tabs-docked"
        aria-label="Document tabs"
      >
        <button
          type="button"
          className="sg-icon"
          aria-label="Show document tabs"
          title="Show document tabs"
          onClick={() => setLayout((l) => ({ ...l, docked: false }))}
        >
          ☰
        </button>
        {handle}
      </nav>
    );
  }
  return (
    <nav
      ref={navRef}
      className={
        drag !== null && drag < DOCK_BELOW
          ? "sg-tabs sg-tabs-docking"
          : "sg-tabs"
      }
      style={{ width: shown }}
      aria-label="Document tabs"
    >
      {handle}
      <div className="sg-tabs-head">
        <span>Document tabs</span>
        {props.readOnly ? null : (
          <button
            type="button"
            className="sg-icon"
            aria-label="Add tab"
            title="Add tab"
            onClick={props.onAdd}
          >
            +
          </button>
        )}
      </div>
      <ul>
        {props.tabs.map((t) => (
          <li
            key={t.id}
            className={
              t.id === props.active ? "sg-tab sg-tab-active" : "sg-tab"
            }
          >
            {editing === t.id ? (
              <input
                className="sg-tab-input"
                autoFocus
                defaultValue={t.title}
                maxLength={60}
                onFocus={(e) => e.currentTarget.select()}
                onBlur={(e) => {
                  const next = e.currentTarget.value.trim();
                  setEditing(null);
                  if (next && next !== t.title) props.onRename(t.id, next);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") setEditing(null);
                }}
              />
            ) : (
              <button
                type="button"
                className="sg-tab-btn"
                onClick={() => props.onSelect(t.id)}
                onDoubleClick={() => !props.readOnly && setEditing(t.id)}
                title={props.readOnly ? undefined : "Double-click to rename"}
              >
                {t.title}
              </button>
            )}
            {!props.readOnly && t.id !== MAIN_TAB && editing !== t.id ? (
              <button
                type="button"
                className="sg-tab-del"
                aria-label={`Delete ${t.title}`}
                onClick={() =>
                  window.confirm(`Delete "${t.title}"?`) && props.onDelete(t.id)
                }
              >
                ✕
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </nav>
  );
}
