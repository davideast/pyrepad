import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import {
  history,
  historyKeymap,
  undo,
  redo,
  undoDepth,
  redoDepth,
} from "@codemirror/commands";
import { CollaborativeEditor } from "../../src/react/index.ts";
import { FirebaseAdapter } from "../../src/adapters/index.ts";
import { consumeStream } from "../../src/react/consume-stream.ts";
import {
  SuggestionAnalyzer,
  SuggestionBook,
  SuggestionSession,
  cm6SuggestionHost,
  createGeminiProposer,
  suggestionExtension,
  type GenerativeModelLike,
  type ProposedEdit,
  type Proposer,
} from "../../src/suggestions/index.ts";

import { contentConfig, model, MAIN_TAB } from "./firebase.ts";
import { Composer } from "./composer.tsx";
import { interpret, nameTabs } from "./commands.ts";
import { MenuBar, type MenuItem } from "./menu-bar.tsx";
import { TabsPanel } from "./tabs-panel.tsx";
import {
  DEFAULT_TITLE,
  addTab,
  createDocument,
  deleteDocument,
  deleteTab,
  isDefaultTabName,
  watchInvite,
  watchMeta,
  type Access,
  type Role,
  type DocMeta,
  renameTab,
  saveSummary,
  saveTabSnippet,
  watchTabs,
  type DocTab,
} from "./docs.ts";
import { AccountMenu, go } from "./grid-page.tsx";
import { profileReady, type Person } from "./session.tsx";
import { ShareButton, ShareDialog } from "./share-dialog.tsx";

// `?mock` swaps Gemini for a fixed typo list, for trying the UI without a key.
const MOCK_TYPOS: Record<string, string> = {
  teh: "the",
  recieve: "receive",
  tyop: "typo",
  definately: "definitely",
};
const mockProposer: Proposer = async (request) => {
  await new Promise((resolve) => setTimeout(resolve, 900));
  if (request.revision) {
    return [
      {
        find: request.text,
        replacement: `${request.revision.replacement} [${request.revision.comment}]`,
        reason: `Revised: ${request.revision.comment}`,
        kind: "typo",
      },
    ];
  }
  const edits: ProposedEdit[] = [];
  for (const [wrong, right] of Object.entries(MOCK_TYPOS)) {
    if (request.text.includes(wrong)) {
      edits.push({
        find: wrong,
        replacement: right,
        reason: `Spelling: "${wrong}" should be "${right}".`,
        kind: "typo",
      });
    }
  }
  return edits;
};
const useMock = new URLSearchParams(window.location.search).has("mock");

const LIGHT: React.CSSProperties = {
  background: "#fff",
  color: "#202124",
  border: "none",
  borderRadius: 0,
  boxShadow: "none",
  backdropFilter: "none",
  overflow: "visible",
};

const KINDS = ["typo", "grammar", "clarity", "tone", "style"] as const;

interface Preset {
  label: string;
  instructions: string;
  kinds: string[];
}

const PRESETS: Preset[] = [
  {
    label: "Proofread",
    instructions:
      "Fix spelling mistakes, grammar errors, and punctuation. Do not change meaning or style.",
    kinds: ["typo", "grammar"],
  },
  {
    label: "Tighten",
    instructions:
      "Cut filler words and wordy phrases. Keep every fact and the author's voice.",
    kinds: ["clarity", "style"],
  },
  {
    label: "Warmer tone",
    instructions:
      "Make the tone friendlier and more welcoming without adding new information.",
    kinds: ["tone"],
  },
  {
    label: "Plain language",
    instructions:
      "Replace jargon and long sentences with plain language a general reader understands.",
    kinds: ["clarity", "style"],
  },
  {
    label: "Translate to Spanish",
    instructions:
      "Suggest a Spanish translation for each sentence, replacing the English sentence.",
    kinds: ["style"],
  },
];

const SAMPLE = "";

interface Config {
  instructions: string;
  kinds: string[];
  enabled: boolean;
}

const CONFIG_KEY = "pyrepad-suggest-config";

function loadConfig(): Config {
  const fallback: Config = {
    instructions: PRESETS[0]!.instructions,
    kinds: PRESETS[0]!.kinds,
    enabled: true,
  };
  try {
    const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? "null");
    if (saved && typeof saved.instructions === "string") {
      return { ...fallback, ...saved };
    }
  } catch {
    // unreadable storage: use the defaults
  }
  return fallback;
}

interface EditorOps {
  acceptAll: () => void;
  rejectAll: () => void;
  pending: () => number;
  /** The document text with every pending suggestion applied. */
  applied: () => string;
  text: () => string;
}

function useAssistant(config: Config, docId: string, canSuggest: boolean) {
  const configRef = useRef(config);
  configRef.current = config;
  const [assistant] = useState(() => {
    const book = new SuggestionBook();
    const analyzer = new SuggestionAnalyzer({
      proposer: useMock ? mockProposer : createGeminiProposer(model),
      book,
      agentId: "assistant",
      getInstructions: () => configRef.current.instructions,
      getKinds: () => configRef.current.kinds,
    });
    return {
      book,
      analyzer,
      discard: { current: () => book.clear() },
      ops: { current: null as EditorOps | null },
    };
  });

  // Let the room's document load, then skip whatever an earlier visit already reviewed.
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const key = `pyrepad-suggest-reviewed:${docId}`;
    const { analyzer } = assistant;
    let ready = false;
    const timer = setTimeout(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(key) ?? "[]");
        if (Array.isArray(saved)) analyzer.restoreReviewed(saved);
      } catch {
        // nothing to restore
      }
      ready = true;
      setLoaded(true);
    }, 1500);
    let save: ReturnType<typeof setTimeout> | undefined;
    const persist = () => {
      if (!ready) return;
      clearTimeout(save);
      save = setTimeout(() => {
        try {
          localStorage.setItem(key, JSON.stringify(analyzer.reviewedText()));
        } catch {
          // storage unavailable
        }
      }, 500);
    };
    analyzer.on("change", persist);
    return () => {
      clearTimeout(timer);
      clearTimeout(save);
      analyzer.off("change", persist);
    };
  }, [assistant, docId]);

  useEffect(() => {
    assistant.analyzer.setEnabled(loaded && canSuggest);
  }, [assistant, loaded, canSuggest]);

  // Only the tab on screen is reviewed: leaving it stops its analyzer.
  useEffect(() => () => assistant.analyzer.setEnabled(false), [assistant]);

  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(() => {
      assistant.discard.current();
      assistant.analyzer.reset();
    }, 600);
    return () => clearTimeout(timer);
  }, [assistant, config.instructions, config.kinds.join(",")]);

  return assistant;
}

function Pane(props: {
  adapter: FirebaseAdapter;
  person: Person;
  defaultText?: string;
  assistant: {
    book: SuggestionBook;
    analyzer: SuggestionAnalyzer;
    discard: { current: () => void };
    ops: { current: EditorOps | null };
  };
  onView: (view: EditorView | null) => void;
  onHistory: (undoable: boolean, redoable: boolean) => void;
  onDoc: (text: string) => void;
  canEdit: boolean;
  canSuggest: boolean;
}): React.ReactElement {
  const mountRef = useRef<HTMLDivElement>(null);
  const marginRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<EditorView | null>(null);
  const { adapter, assistant, onView, onHistory, onDoc, canEdit, canSuggest } =
    props;

  useEffect(() => {
    const book = assistant.book;
    let editorView: EditorView | null = null;
    const session = new SuggestionSession({
      book,
      host: {
        getText: () => editorView!.state.doc.toString(),
        applyChange: (c) => cm6SuggestionHost(editorView!).applyChange(c),
      },
      broadcast: (event) => {
        adapter
          .broadcastAgentive(event)
          .catch((err) => console.warn("broadcastAgentive failed:", err));
      },
    });
    editorView = new EditorView({
      parent: mountRef.current!,
      state: EditorState.create({
        doc: "",
        extensions: [
          EditorView.lineWrapping,
          EditorState.readOnly.of(!canEdit),
          EditorView.editable.of(canEdit),
          history(),
          keymap.of(historyKeymap),
          // Only the user's own edits are undoable; peers' edits just rebase the stack.
          EditorState.transactionFilter.of((tr) =>
            tr.docChanged && tr.annotation(Transaction.userEvent) === undefined
              ? [tr, { annotations: Transaction.addToHistory.of(false) }]
              : tr,
          ),
          EditorView.updateListener.of((u) => {
            onHistory(undoDepth(u.state) > 0, redoDepth(u.state) > 0);
            if (u.docChanged) onDoc(u.state.doc.toString());
          }),
          placeholder(
            "Start typing. Try a few misspelled words in a full sentence.",
          ),
          suggestionExtension({
            book,
            session,
            analyzer: canSuggest ? assistant.analyzer : null,
            canResolve: canEdit,
            user: { name: props.person.name, color: props.person.color },
            author: () => ({ name: "Scribe", color: "#8430ce" }),
            margin: marginRef.current!,
          }),
        ],
      }),
    });
    assistant.discard.current = () => session.rejectAll();
    assistant.ops.current = {
      acceptAll: () => {
        for (const s of [...book.list()].reverse()) session.accept(s.id);
      },
      rejectAll: () => session.rejectAll(),
      pending: () => book.list().length,
      text: () => editorView!.state.doc.toString(),
      applied: () => {
        let text = editorView!.state.doc.toString();
        for (const s of [...book.list()].reverse()) {
          text = text.slice(0, s.from) + s.replacement + text.slice(s.to);
        }
        return text;
      },
    };
    const stop = consumeStream(adapter.agentive, (event) =>
      session.ingest(event),
    );
    setView(editorView);
    onView(editorView);
    return () => {
      assistant.ops.current = null;
      stop();
      editorView?.destroy();
      setView(null);
      onView(null);
    };
  }, [adapter, assistant, onView, onHistory, onDoc, canEdit, canSuggest]);

  return (
    <section className="sg-pane">
      <div className="sg-stage">
        <CollaborativeEditor
          adapter={adapter}
          editor={view}
          defaultText={canEdit ? props.defaultText : undefined}
          type="cm6"
          userId={props.person.uid}
          userColor={props.person.color}
          showCollaboratorBar={false}
          className="sg-editor"
          style={LIGHT}
        >
          <div ref={mountRef} />
        </CollaborativeEditor>
        <div ref={marginRef} className="pad-margin" />
      </div>
    </section>
  );
}

function Editor(props: {
  person: Person;
  docId: string;
  tabId: string;
  title: string;
  seed?: string;
  tabs: React.ReactElement;
  onCreateTab: (title: string, seed?: string) => Promise<void>;
  onNameTabs: (activeText: string) => Promise<number>;
  access: Access;
  share: React.ReactElement;
  note: string;
  onNote: (note: string) => void;
}): React.ReactElement {
  const { person, docId, tabId, access } = props;
  const isOwner = access === "owner";
  const canEdit = isOwner || access === "editor";
  const canSuggest = canEdit || access === "commenter";
  const adapter = useMemo(() => {
    const a = new FirebaseAdapter(
      contentConfig(docId, tabId),
      person.uid,
      person.color,
    );
    a.commitDelayMs = 400;
    a.presenceThrottleMs = 1000;
    return a;
  }, [docId, tabId, person.uid, person.color]);
  useEffect(() => () => void adapter.dispose(), [adapter]);

  const [title, setTitle] = useState(props.title);
  const savedTitle = useRef(props.title);
  const commitTitle = () => {
    if (!isOwner) return;
    const next = title.trim() || DEFAULT_TITLE;
    setTitle(next);
    if (next === savedTitle.current) return;
    savedTitle.current = next;
    void saveSummary(person.uid, docId, { title: next });
  };

  const summaryTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(summaryTimer.current), []);
  const onDoc = useCallback(
    (text: string) => {
      clearTimeout(summaryTimer.current);
      summaryTimer.current = setTimeout(() => {
        const snippet = text.replace(/\s+/g, " ").trim().slice(0, 200);
        if (isOwner)
          void saveSummary(person.uid, docId, { snippet }).catch(() => {});
        if (canEdit) void saveTabSnippet(docId, tabId, snippet).catch(() => {});
      }, 3000);
    },
    [person.uid, docId, tabId, isOwner, canEdit],
  );

  const [config, setConfig] = useState<Config>(loadConfig);
  useEffect(() => {
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    } catch {
      // storage unavailable: settings just won't persist
    }
  }, [config]);
  const assistant = useAssistant(config, `${docId}:${tabId}`, canSuggest);
  const [view, setView] = useState<EditorView | null>(null);
  const [history, setHistory] = useState({ undo: false, redo: false });
  const onHistory = useCallback(
    (undoable: boolean, redoable: boolean) =>
      setHistory((h) =>
        h.undo === undoable && h.redo === redoable
          ? h
          : { undo: undoable, redo: redoable },
      ),
    [],
  );

  const runCommand = async (text: string): Promise<string | void> => {
    const ops = assistant.ops.current;
    const pending = ops?.pending() ?? 0;
    const cmd = await interpret(text, useMock ? null : model, {
      instructions: config.instructions,
      pending,
    });
    switch (cmd.type) {
      case "accept_all":
        ops?.acceptAll();
        return pending
          ? `Accepted ${pending} suggestion${pending === 1 ? "" : "s"}.`
          : "No suggestions to accept.";
      case "reject_all":
        ops?.rejectAll();
        return pending
          ? `Rejected ${pending} suggestion${pending === 1 ? "" : "s"}.`
          : "No suggestions to reject.";
      case "set_instructions":
        setConfig((c) => ({
          ...c,
          instructions: cmd.instructions,
          kinds: [...KINDS],
        }));
        return "Instructions updated. Scribe will review the tab again.";
      case "new_tab":
        await props.onCreateTab(cmd.title);
        return `Created "${cmd.title}".`;
      case "new_tab_from_suggestions":
        if (!ops || pending === 0)
          return "There are no suggestions to build a tab from.";
        await props.onCreateTab(cmd.title, ops.applied());
        return `Created "${cmd.title}" with ${pending} suggestion${pending === 1 ? "" : "s"} applied.`;
      case "name_tabs": {
        const n = await props.onNameTabs(ops?.text() ?? "");
        return n
          ? `Named ${n} tab${n === 1 ? "" : "s"} from their content.`
          : "No tabs with default names and content to name.";
      }
      case "reply":
        return cmd.message;
    }
  };

  const titleRef = useRef<HTMLInputElement>(null);
  const [panel, setPanel] = useState(false);
  const docText = () => assistant.ops.current?.text() ?? "";
  const fileMenu = (): MenuItem[] => [
    {
      label: "New document",
      onSelect: () =>
        void createDocument(person.uid).then((id) => go(`/d/${id}`)),
    },
    { label: "Open…", shortcut: "All documents", onSelect: () => go("/") },
    "separator",
    {
      label: "Rename",
      disabled: !isOwner,
      onSelect: () => {
        titleRef.current?.focus();
        titleRef.current?.select();
      },
    },
    {
      label: "Download as text (.txt)",
      onSelect: () => {
        const url = URL.createObjectURL(
          new Blob([docText()], { type: "text/plain" }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = `${title.trim() || DEFAULT_TITLE}.txt`;
        a.click();
        URL.revokeObjectURL(url);
      },
    },
    {
      label: "Move to trash",
      disabled: !isOwner,
      onSelect: () => {
        if (!window.confirm(`Delete "${title}"? This can't be undone.`)) return;
        void deleteDocument(person.uid, docId).then(() => go("/"));
      },
    },
    "separator",
    { label: "Print", shortcut: "⌘P", onSelect: () => window.print() },
  ];
  const pendingCount = assistant.ops.current?.pending() ?? 0;
  const editMenu = (): MenuItem[] => [
    {
      label: "Undo",
      shortcut: "⌘Z",
      disabled: !canEdit || !history.undo,
      onSelect: () => view && (undo(view), view.focus()),
    },
    {
      label: "Redo",
      shortcut: "⇧⌘Z",
      disabled: !canEdit || !history.redo,
      onSelect: () => view && (redo(view), view.focus()),
    },
    "separator",
    {
      label: "Select all",
      shortcut: "⌘A",
      onSelect: () =>
        view &&
        (view.dispatch({
          selection: { anchor: 0, head: view.state.doc.length },
        }),
        view.focus()),
    },
    {
      label: "Copy document text",
      onSelect: () => void navigator.clipboard?.writeText(docText()),
    },
    "separator",
    {
      label: `Accept all suggestions${pendingCount ? ` (${pendingCount})` : ""}`,
      disabled: !canEdit || pendingCount === 0,
      onSelect: () => assistant.ops.current?.acceptAll(),
    },
    {
      label: `Reject all suggestions${pendingCount ? ` (${pendingCount})` : ""}`,
      disabled: !canEdit || pendingCount === 0,
      onSelect: () => assistant.ops.current?.rejectAll(),
    },
  ];
  const preset =
    PRESETS.find((p) => p.instructions === config.instructions)?.label ??
    "Custom";

  return (
    <div className="sg-app">
      <header className="sg-head">
        <div className="sg-title-row">
          <a
            className="sg-home-link"
            href="#/"
            aria-label="All documents"
            title="All documents"
          >
            <svg className="sg-logo" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 2h8l6 6v14H6z" fill="#4285f4" />
              <path d="M14 2l6 6h-6z" fill="#a1c2fa" />
              <path d="M9 13h8v1.5H9zm0 3h8v1.5H9zm0-6h4v1.5H9z" fill="#fff" />
            </svg>
          </a>
          <input
            ref={titleRef}
            className="sg-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            aria-label="Document title"
            maxLength={120}
            readOnly={!isOwner}
            spellCheck={false}
          />
          {props.share}
          <AccountMenu person={person} />
        </div>
        <MenuBar
          menus={[
            { label: "File", items: fileMenu },
            { label: "Edit", items: editMenu },
          ]}
        />
        <div className="sg-toolbar" role="toolbar" aria-label="Editing">
          <button
            type="button"
            className="sg-tool sg-btn"
            aria-label="Undo"
            title="Undo (⌘Z)"
            disabled={!canEdit || !history.undo}
            onClick={() => view && (undo(view), view.focus())}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                fill="currentColor"
                d="M12.5 8c-2.65 0-5.05 1-6.9 2.6L2 7v9h9l-3.62-3.62A7.96 7.96 0 0 1 12.5 10c3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 10.75 17.19 8 12.5 8z"
              />
            </svg>
          </button>
          <button
            type="button"
            className="sg-tool sg-btn"
            aria-label="Redo"
            title="Redo (⇧⌘Z)"
            disabled={!canEdit || !history.redo}
            onClick={() => view && (redo(view), view.focus())}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                fill="currentColor"
                d="M18.4 10.6A11.94 11.94 0 0 0 11.5 8c-4.69 0-8.58 2.75-9.97 6.72l2.37.78C4.95 12.31 7.96 10 11.5 10c1.96 0 3.73.72 5.12 1.88L13 15.5h9V6.5l-3.6 4.1z"
              />
            </svg>
          </button>
          <span className="sg-sep" />
          <span className="sg-select-wrap">
            <select
              className="sg-select"
              aria-label="Assistant"
              value={preset}
              onChange={(e) => {
                const p = PRESETS.find((x) => x.label === e.target.value);
                if (p)
                  setConfig((c) => ({
                    ...c,
                    instructions: p.instructions,
                    kinds: p.kinds,
                  }));
              }}
            >
              {preset === "Custom" ? <option>Custom</option> : null}
              {PRESETS.map((p) => (
                <option key={p.label}>{p.label}</option>
              ))}
            </select>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path fill="currentColor" d="M7 10l5 5 5-5z" />
            </svg>
          </span>
          <button
            type="button"
            className="sg-tool sg-btn"
            aria-expanded={panel}
            onClick={() => setPanel((v) => !v)}
          >
            Instructions
          </button>
        </div>
        {panel ? (
          <div className="sg-pop">
            <label htmlFor="sg-instr">What should the assistant do?</label>
            <textarea
              id="sg-instr"
              value={config.instructions}
              onChange={(e) =>
                setConfig((c) => ({
                  ...c,
                  instructions: e.target.value,
                  kinds: [...KINDS],
                }))
              }
            />
          </div>
        ) : null}
      </header>
      <div className="sg-body">
        {props.tabs}
        <main className="sg-canvas">
          <Pane
            adapter={adapter}
            person={person}
            defaultText={props.seed ?? SAMPLE}
            assistant={assistant}
            onView={setView}
            onHistory={onHistory}
            onDoc={onDoc}
            canEdit={canEdit}
            canSuggest={canSuggest}
          />
        </main>
        {canEdit ? (
          <Composer
            onSubmit={runCommand}
            note={props.note}
            onNote={props.onNote}
          />
        ) : null}
      </div>
    </div>
  );
}

export function EditorPage(props: {
  person: Person;
  docId: string;
  onSignIn: () => void;
}): React.ReactElement {
  const { person, docId } = props;
  const [meta, setMeta] = useState<DocMeta | null | undefined>(undefined);
  const [invite, setInvite] = useState<Role | null | undefined>(undefined);
  const [tabs, setTabs] = useState<DocTab[]>([
    { id: MAIN_TAB, title: "Tab 1", snippet: "" },
  ]);
  const [active, setActive] = useState(MAIN_TAB);
  const [note, setNote] = useState("");
  const [seeds, setSeeds] = useState<Record<string, string>>({});
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    setMeta(undefined);
    setInvite(undefined);
    setActive(MAIN_TAB);
    let stops: Array<() => void> = [];
    let cancelled = false;
    void profileReady().then(() => {
      if (cancelled) return;
      stops = [
        watchMeta(docId, setMeta),
        watchInvite(docId, person.email, setInvite),
        watchTabs(docId, setTabs),
      ];
    });
    return () => {
      cancelled = true;
      stops.forEach((stop) => stop());
    };
  }, [docId, person.email]);

  if (meta === undefined || invite === undefined)
    return <div className="sg-app sg-status">Opening…</div>;
  if (!meta) {
    return (
      <div className="sg-app sg-status">
        <p>This document doesn't exist, or you need access to open it.</p>
        {person.anonymous ? (
          <button type="button" className="sg-primary" onClick={props.onSignIn}>
            Sign in with another account
          </button>
        ) : (
          <button type="button" className="sg-primary" onClick={() => go("/")}>
            All documents
          </button>
        )}
      </div>
    );
  }
  const access = accessOf(meta, person.uid, invite);
  const readOnly = access !== "owner" && access !== "editor";
  const current = tabs.some((t) => t.id === active) ? active : MAIN_TAB;
  const panel = (
    <TabsPanel
      tabs={tabs}
      active={current}
      readOnly={readOnly}
      onSelect={setActive}
      onAdd={() => void addTab(docId, `Tab ${tabs.length + 1}`).then(setActive)}
      onRename={(id, title) => void renameTab(docId, id, title)}
      onDelete={(id) => {
        setActive(MAIN_TAB);
        void deleteTab(docId, id);
      }}
    />
  );
  return (
    <>
      <Editor
        key={`${docId}:${current}`}
        person={person}
        docId={docId}
        tabId={current}
        title={meta.title}
        seed={seeds[current]}
        tabs={panel}
        access={access}
        share={
          <ShareButton link={meta.link} onClick={() => setSharing(true)} />
        }
        note={note}
        onNote={setNote}
        onNameTabs={async (activeText) => {
          const items = tabs
            .filter(isDefaultTabName)
            .map((t) => ({
              id: t.id,
              text:
                t.id === current && activeText.trim() ? activeText : t.snippet,
            }))
            .filter((i) => i.text.trim());
          const titles = await nameTabs(items, useMock ? null : model);
          const entries = Object.entries(titles);
          await Promise.all(entries.map(([id, t]) => renameTab(docId, id, t)));
          return entries.length;
        }}
        onCreateTab={async (title, seed) => {
          const id = await addTab(docId, title);
          if (seed !== undefined) setSeeds((m) => ({ ...m, [id]: seed }));
          setActive(id);
        }}
      />
      {sharing ? (
        <ShareDialog
          docId={docId}
          title={meta.title}
          access={access}
          link={meta.link}
          person={person}
          onClose={() => setSharing(false)}
        />
      ) : null}
    </>
  );
}

const RANK: Record<Access, number> = {
  viewer: 0,
  commenter: 1,
  editor: 2,
  owner: 3,
};

/** The strongest of: ownership, the invite for this email, and link access. */
function accessOf(meta: DocMeta, uid: string, invite: Role | null): Access {
  if (meta.ownerId === uid) return "owner";
  return [invite, meta.link ?? null]
    .filter((r): r is Role => r !== null)
    .reduce<Access>((a, b) => (RANK[b] > RANK[a] ? b : a), "viewer");
}
