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
import {
  CollaborativeEditor,
  useCollaborators,
} from "../../src/react/index.ts";
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
  type Suggestion,
} from "../../src/suggestions/index.ts";

import { contentConfig, model, ttsModel, MAIN_TAB } from "./firebase.ts";
import {
  Narrator,
  roughSummary,
  setSpoken,
  spokenHighlight,
  type ListenState,
  type Span,
} from "./listen.ts";
import {
  codeFenceEnter,
  insertCodeBlock,
  markdownLive,
  blockTypeWatcher,
  setBlockType,
  type BlockType,
  pasteAsMarkdown,
} from "./markdown.ts";
import { ListenBar, type ListenInfo } from "./listen-bar.tsx";
import { Composer } from "./composer.tsx";
import { draftText, interpret, nameTabs } from "./commands.ts";
import { MenuBar, type MenuItem } from "./menu-bar.tsx";
import { TabsPanel } from "./tabs-panel.tsx";
import {
  DEFAULT_TITLE,
  addTab,
  createDocument,
  deleteDocument,
  deleteTab,
  isDefaultTabName,
  addComment,
  addReply,
  deleteComment,
  deleteReply,
  setResolved,
  watchComments,
  watchReplies,
  type Comment,
  type Reply,
  saveVersion,
  watchInvite,
  watchVersions,
  type Version,
  watchMeta,
  type Access,
  type Role,
  saveSettings,
  watchSettings,
  type DocMeta,
  renameTab,
  saveSummary,
  saveTabSnippet,
  watchTabs,
  type DocTab,
} from "./docs.ts";
import { AccountMenu, go } from "./grid-page.tsx";
import { profileReady, type Person } from "./session.tsx";
import { CommentsPanel, type Draft } from "./comments-panel.tsx";
import {
  commentHighlights,
  commentRange,
  setActive,
  setAnchors,
} from "./comment-highlights.ts";
import { VersionHistory } from "./version-history.tsx";
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
  if (request.mode === "comment") {
    const find = request.text.trim();
    return find
      ? [
          {
            type: "comment",
            find,
            replacement: "",
            reason: `Mock remark on "${find.slice(0, 40)}".`,
            kind: "tone",
          },
        ]
      : [];
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
  if (edits.length === 0 && request.instructions.includes("Direct request")) {
    const find = request.text.trim();
    if (find)
      edits.push({
        find,
        replacement: `${find} (reworked)`,
        reason: "Reworked as requested.",
        kind: "style",
      });
  }
  return edits;
};
/** Code blocks are not prose: drop edits that touch a fenced block or its ``` lines. */
function skipCode(inner: Proposer): Proposer {
  const fences = (t: string) => (t.match(/^[ \t]*```/gm) ?? []).length;
  return async (request, signal) => {
    const edits = await inner(
      {
        ...request,
        instructions: `${request.instructions}\n\nNever edit fenced code blocks (between \`\`\` lines) or the \`\`\` lines themselves.`,
      },
      signal,
    );
    return edits.filter((edit) => {
      if (edit.type === "comment") return true;
      if (edit.find.includes("```") || edit.replacement.includes("```"))
        return false;
      const at = request.text.indexOf(edit.find);
      const upTo = request.before + request.text.slice(0, Math.max(0, at));
      if (fences(upTo) % 2 === 1) return false;
      const line = request.text.slice(at, at + edit.find.length);
      return !(at >= 0 && fences(line) > 0);
    });
  };
}
const useMock = new URLSearchParams(window.location.search).has("mock");

const LIGHT: React.CSSProperties = {
  background: "var(--surface)",
  color: "var(--ink)",
  border: "none",
  borderRadius: 0,
  boxShadow: "none",
  backdropFilter: "none",
  overflow: "visible",
};

const SCRIBE = /@scribe\b/i;
const KINDS = ["typo", "grammar", "clarity", "tone", "style"] as const;

type Mode = "suggest" | "comment" | "both";

const MODES: { value: Mode; label: string }[] = [
  { value: "suggest", label: "Suggest edits" },
  { value: "comment", label: "Comment only" },
  { value: "both", label: "Edits and comments" },
];

interface Preset {
  label: string;
  instructions: string;
  kinds: string[];
  mode?: Mode;
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
    label: "Critique",
    instructions:
      "Give candid, specific feedback on the writing and the ideas in it. Respond to what the author says; do not rewrite it.",
    kinds: ["clarity", "tone"],
    mode: "comment",
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
  mode: Mode;
  enabled: boolean;
}

const CONFIG_KEY = "pyrepad-suggest-config";

function loadConfig(): Config {
  const fallback: Config = {
    instructions: PRESETS[0]!.instructions,
    kinds: PRESETS[0]!.kinds,
    mode: "suggest",
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

const VERSION_IDLE_MS = 10_000;

interface EditorOps {
  acceptAll: () => void;
  rejectAll: () => void;
  pending: () => number;
  /** The document text with every pending suggestion applied. */
  applied: () => string;
  text: () => string;
  cursor: () => number;
}

type CommentSink = {
  current:
    | ((c: { quote: string; from: number; text: string; kind: string }) => void)
    | null;
};

function commentKey(quote: string, text: string): string {
  let h = 5381;
  for (const ch of `${quote}\u0000${text}`)
    h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return `sc${h.toString(36)}`;
}

function useAssistant(config: Config, docId: string, canSuggest: boolean) {
  const configRef = useRef(config);
  configRef.current = config;
  const [assistant] = useState(() => {
    const commentSink: CommentSink = { current: null };
    const book = new SuggestionBook();
    const analyzer = new SuggestionAnalyzer({
      proposer: skipCode(useMock ? mockProposer : createGeminiProposer(model)),
      book,
      agentId: "assistant",
      idleMs: 5000,
      getInstructions: () => configRef.current.instructions,
      getKinds: () => configRef.current.kinds,
      getMode: () => configRef.current.mode,
      onComment: (c) => commentSink.current?.(c),
    });
    return {
      book,
      analyzer,
      discard: { current: () => book.clear() },
      ops: { current: null as EditorOps | null },
      commentSink,
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
  onBlockType: (type: BlockType) => void;
  onHistory: (undoable: boolean, redoable: boolean) => void;
  onDoc: (text: string) => void;
  canEdit: boolean;
  canSuggest: boolean;
  onPickComment: (id: string) => void;
}): React.ReactElement {
  const mountRef = useRef<HTMLDivElement>(null);
  const marginRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<EditorView | null>(null);
  const {
    adapter,
    assistant,
    onView,
    onBlockType,
    onHistory,
    onDoc,
    canEdit,
    canSuggest,
    onPickComment,
  } = props;

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
          commentHighlights(onPickComment),
          spokenHighlight(),
          markdownLive(),
          blockTypeWatcher(onBlockType),
          codeFenceEnter(),
          pasteAsMarkdown(),
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
      cursor: () => editorView!.state.selection.main.head,
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
  }, [
    adapter,
    assistant,
    onView,
    onHistory,
    onDoc,
    canEdit,
    canSuggest,
    onPickComment,
  ]);

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
  creator: boolean;
  share: React.ReactElement;
  note: string;
  onNote: (note: string) => void;
}): React.ReactElement {
  const { person, docId, tabId, access } = props;
  const isCreator = props.creator;
  const isOwner = access === "owner";
  const canEdit = isOwner || access === "editor";
  const canComment = canEdit || access === "commenter";
  const canSuggest = canEdit;
  const adapter = useMemo(() => {
    const a = new FirebaseAdapter(
      contentConfig(docId, tabId),
      person.uid,
      person.color,
    );
    a.commitDelayMs = 400;
    a.presenceThrottleMs = 250;
    a.setName(person.name);
    return a;
  }, [docId, tabId, person.uid, person.color, person.name]);
  useEffect(() => () => void adapter.dispose(), [adapter]);

  const [versions, setVersions] = useState<Version[]>([]);
  const versionsRef = useRef<Version[]>([]);
  versionsRef.current = versions;
  useEffect(() => watchVersions(docId, tabId, setVersions), [docId, tabId]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [listen, setListen] = useState<{
    state: ListenState;
    info: ListenInfo;
    word: Span | null;
  } | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const summaryMode = useRef(false);
  const [blockKind, setBlockKind] = useState<BlockType>("p");
  const onPaneView = useCallback((v: EditorView | null) => {
    viewRef.current = v;
    setView(v);
  }, []);
  const narrator = useMemo(
    () =>
      new Narrator({
        onState: (state) =>
          setListen((l) => (state === "idle" ? null : l && { ...l, state })),
        onWord: (word) =>
          summaryMode.current
            ? setListen((l) => l && { ...l, word })
            : viewRef.current?.dispatch({ effects: setSpoken.of(word) }),
        onError: (m) => props.onNote(m),
      }),
    [],
  );
  useEffect(() => () => narrator.stop(), [narrator]);
  const stopListening = () => {
    narrator.stop();
    viewRef.current?.dispatch({ effects: setSpoken.of(null) });
  };
  useEffect(stopListening, [tabId, docId]);
  const listenToTab = () => {
    const text = assistant.ops.current?.text() ?? "";
    narrator.stop();
    summaryMode.current = false;
    setListen({
      state: "loading",
      info: { label: "Reading this tab", text: null },
      word: null,
    });
    void narrator.speak(text, useMock ? null : ttsModel);
  };
  const listenToSummary = async () => {
    const text = assistant.ops.current?.text() ?? "";
    if (!text.trim()) return props.onNote("There's nothing to summarize.");
    narrator.stop();
    setListen({
      state: "loading",
      info: { label: "Summarizing…", text: null },
      word: null,
    });
    let summary = roughSummary(text);
    if (!useMock)
      try {
        const r = await model.generateContent({
          systemInstruction:
            "Summarize the document in two to four plain spoken sentences. No lists, headings or markdown.",
          contents: [{ role: "user", parts: [{ text }] }],
        });
        summary = r.response.text().trim() || summary;
      } catch {
        props.onNote("Couldn't summarize with Gemini; reading the opening.");
      }
    summaryMode.current = true;
    setListen({
      state: "loading",
      info: { label: "Document summary", text: summary },
      word: null,
    });
    void narrator.speak(summary, useMock ? null : ttsModel);
  };
  const openHistoryRef = useRef<() => void>(() => {});
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.altKey && e.shiftKey && e.code === "KeyH") {
        e.preventDefault();
        openHistoryRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const snapshot = useCallback(
    (text: string, name?: string) => {
      const newest = versionsRef.current[0];
      if (!name && (!text.trim() || newest?.text === text)) return;
      void saveVersion(
        docId,
        tabId,
        { text, by: person.name, name },
        versionsRef.current,
      ).catch(() => {});
    },
    [docId, tabId, person.name],
  );

  const [title, setTitle] = useState(props.title);
  const savedTitle = useRef(props.title);
  const commitTitle = () => {
    if (!isCreator) return;
    const next = title.trim() || DEFAULT_TITLE;
    setTitle(next);
    if (next === savedTitle.current) return;
    savedTitle.current = next;
    void saveSummary(person.uid, docId, { title: next });
  };

  const summaryTimer = useRef<ReturnType<typeof setTimeout>>();
  const versionTimer = useRef<ReturnType<typeof setTimeout>>();
  const unsaved = useRef<string | null>(null);
  const flushVersion = useCallback(() => {
    clearTimeout(versionTimer.current);
    if (unsaved.current !== null) snapshot(unsaved.current);
    unsaved.current = null;
  }, [snapshot]);
  useEffect(() => {
    const hidden = () => document.hidden && flushVersion();
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", flushVersion);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", flushVersion);
      flushVersion();
    };
  }, [flushVersion]);
  useEffect(() => () => clearTimeout(summaryTimer.current), []);
  const onDoc = useCallback(
    (text: string) => {
      if (canEdit) {
        clearTimeout(versionTimer.current);
        unsaved.current = text;
        versionTimer.current = setTimeout(flushVersion, VERSION_IDLE_MS);
      }
      clearTimeout(summaryTimer.current);
      summaryTimer.current = setTimeout(() => {
        const snippet = text.replace(/\s+/g, " ").trim().slice(0, 200);
        if (isCreator)
          void saveSummary(person.uid, docId, { snippet }).catch(() => {});
        if (canEdit) void saveTabSnippet(docId, tabId, snippet).catch(() => {});
      }, 3000);
    },
    [person.uid, docId, tabId, isCreator, canEdit, flushVersion],
  );

  const [config, setConfig] = useState<Config>(loadConfig);
  useEffect(() => {
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    } catch {
      // storage unavailable: settings just won't persist
    }
  }, [config]);
  const settingsKey = (c: Config) =>
    `${c.instructions}\u0000${c.kinds.join(",")}\u0000${c.mode}`;
  const savedKey = useRef<string | null>(null);
  const configNow = useRef(config);
  configNow.current = config;
  useEffect(
    () =>
      watchSettings(docId, (remote) => {
        if (!remote) {
          savedKey.current ??= settingsKey(configNow.current);
          return;
        }
        const key = settingsKey({ ...configNow.current, ...remote });
        if (key === savedKey.current) return;
        savedKey.current = key;
        setConfig((c) => ({ ...c, ...remote }));
      }),
    [docId],
  );
  useEffect(() => {
    if (!isOwner || savedKey.current === null) return;
    const key = settingsKey(config);
    if (key === savedKey.current) return;
    const timer = setTimeout(() => {
      savedKey.current = key;
      void saveSettings(docId, config).catch(() =>
        props.onNote("Couldn't save the instructions."),
      );
    }, 500);
    return () => clearTimeout(timer);
  }, [config, isOwner, docId]);
  const assistant = useAssistant(config, `${docId}:${tabId}`, canSuggest);
  const replyCapture = useRef<string[] | null>(null);
  useEffect(() => {
    assistant.commentSink.current = (c) => {
      if (replyCapture.current) {
        replyCapture.current.push(c.text);
        return;
      }
      void addComment(
        docId,
        tabId,
        {
          by: person.uid,
          name: "Scribe",
          color: "#8430ce",
          text: c.text.slice(0, 2000),
          quote: c.quote,
          from: c.from,
        },
        commentKey(c.quote, c.text),
      ).catch(() => {});
    };
    return () => {
      assistant.commentSink.current = null;
    };
  }, [assistant, docId, tabId, person.uid]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [replies, setReplies] = useState<Record<string, Reply[]>>({});
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [thinking, setThinking] = useState<Set<string>>(new Set());
  const peers = useCollaborators(adapter);
  const [located, setLocated] = useState<Set<string>>(new Set());
  useEffect(() => {
    setComments([]);
    setReplies({});
    setDraft(null);
    setActiveId(null);
    const stops = [
      watchComments(docId, tabId, setComments),
      watchReplies(docId, tabId, setReplies),
    ];
    return () => stops.forEach((stop) => stop());
  }, [docId, tabId]);
  const author = { by: person.uid, name: person.name, color: person.color };
  const [pending, setPending] = useState(0);
  useEffect(() => {
    const sync = () => setPending(assistant.book.list().length);
    sync();
    assistant.book.on("change", sync);
    return () => assistant.book.off("change", sync);
  }, [assistant]);
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

  useEffect(() => {
    if (!view) return;
    view.dispatch({
      effects: setAnchors.of(
        comments.map((c) => ({
          id: c.id,
          quote: c.quote,
          from: c.from,
          resolved: !!c.resolved,
        })),
      ),
    });
    setLocated(
      new Set(
        comments.flatMap((c) => (commentRange(view.state, c.id) ? c.id : [])),
      ),
    );
  }, [view, comments]);
  useEffect(() => {
    view?.dispatch({ effects: setActive.of(activeId) });
  }, [view, activeId]);

  const selectComment = useCallback(
    (id: string) => {
      setActiveId(id);
      const range = view && commentRange(view.state, id);
      if (view && range)
        view.dispatch({
          effects: EditorView.scrollIntoView(range.from, { y: "center" }),
        });
    },
    [view],
  );
  const pickComment = useCallback((id: string) => {
    setCommentsOpen(true);
    setActiveId(id);
  }, []);
  const startComment = () => {
    if (!canComment || !view) return;
    const { from, to } = view.state.selection.main;
    setDraft({ quote: view.state.sliceDoc(from, to), from });
    setCommentsOpen(true);
  };
  const startCommentRef = useRef(startComment);
  startCommentRef.current = startComment;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.altKey && e.code === "KeyM") {
        e.preventDefault();
        startCommentRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  const askScribe = async (
    commentId: string,
    text: string,
    quote: string,
    hint: number,
  ) => {
    if (!view || !canEdit || !SCRIBE.test(text)) return;
    const doc = view.state.doc.toString();
    let from = 0;
    let to = doc.length;
    if (quote) {
      let best = -1;
      for (
        let at = doc.indexOf(quote);
        at !== -1;
        at = doc.indexOf(quote, at + 1)
      )
        if (best === -1 || Math.abs(at - hint) < Math.abs(best - hint))
          best = at;
      if (best !== -1) {
        from = best;
        to = best + quote.length;
      }
    }
    const request =
      text.replace(/@scribe\b[:,]?/gi, "").trim() || "Improve this text.";
    setThinking((t) => new Set(t).add(commentId));
    let answer: string;
    try {
      const remarks: string[] = [];
      replyCapture.current = remarks;
      let placed: Suggestion[];
      try {
        placed = await assistant.analyzer.ask({ from, to }, request, KINDS);
      } finally {
        replyCapture.current = null;
      }
      const note = placed.length
        ? ` (I also suggested ${placed.length} ${placed.length === 1 ? "change" : "changes"} in the margin.)`
        : "";
      answer = remarks.length
        ? `${remarks.join("\n\n")}${note}`
        : placed.length
          ? `Suggested ${placed.length} ${placed.length === 1 ? "change" : "changes"} ${quote ? "for this text" : "across the document"}. Review ${placed.length === 1 ? "it" : "them"} in the margin.`
          : assistant.book.list().some((x) => x.from < to && x.to > from)
            ? "The changes I'd make are already in the margin."
            : "I didn't find anything to change.";
    } catch {
      answer = "I couldn't get a response just now. Try again.";
    }
    setThinking((t) => {
      const next = new Set(t);
      next.delete(commentId);
      return next;
    });
    await addReply(docId, tabId, commentId, {
      by: "scribe",
      name: "Scribe",
      color: "#8430ce",
      text: answer,
    }).catch(() => {});
  };
  const openComments = comments.filter((c) => !c.resolved).length;

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
        if (!isOwner) return "Only an Owner can change the instructions.";
        setConfig((c) => ({
          ...c,
          instructions: cmd.instructions,
          kinds: [...KINDS],
        }));
        return "Instructions updated. Scribe will review the tab again.";
      case "write": {
        if (!ops || !canSuggest)
          return "You don't have permission to edit here.";
        const doc = ops.text();
        const at = Math.min(ops.cursor(), doc.length);
        let text: string;
        try {
          text = await draftText(cmd.request, useMock ? null : model, {
            instructions: config.instructions,
            before: doc.slice(0, at),
            after: doc.slice(at),
          });
        } catch {
          return "I couldn't get a response just now. Try again.";
        }
        if (!text) return "I didn't come up with anything to write.";
        const lead = at > 0 && doc[at - 1] !== "\n" ? "\n\n" : "";
        const placed = assistant.analyzer.insert(
          at,
          lead + text,
          `Written from your request: ${cmd.request.slice(0, 80)}`,
          "style",
        );
        return placed
          ? "Suggested new text. Accept it in the margin to add it."
          : "I couldn't place that text here.";
      }
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
  const openHistory = () => {
    if (canEdit) {
      clearTimeout(versionTimer.current);
      unsaved.current = null;
      snapshot(docText());
    }
    setHistoryOpen(true);
  };
  openHistoryRef.current = openHistory;
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
      disabled: !isCreator,
      onSelect: () => {
        titleRef.current?.focus();
        titleRef.current?.select();
      },
    },
    {
      label: "Download as Markdown (.md)",
      onSelect: () => {
        const url = URL.createObjectURL(
          new Blob([docText()], { type: "text/markdown" }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = `${title.trim() || DEFAULT_TITLE}.md`;
        a.click();
        URL.revokeObjectURL(url);
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
      disabled: !isCreator,
      onSelect: () => {
        if (!window.confirm(`Delete "${title}"? This can't be undone.`)) return;
        void deleteDocument(person.uid, docId).then(() => go("/"));
      },
    },
    "separator",
    {
      label: "Name current version",
      disabled: !canEdit,
      onSelect: () => {
        const name = window.prompt("Name this version");
        if (name?.trim()) snapshot(docText(), name.trim().slice(0, 80));
      },
    },
    {
      label: "See version history",
      shortcut: "⌘⌥⇧H",
      onSelect: openHistory,
    },
    "separator",
    { label: "Print", shortcut: "⌘P", onSelect: () => window.print() },
  ];
  const pendingCount = pending;
  const toolsMenu = (): MenuItem[] => [
    { label: "Listen to this tab", onSelect: listenToTab },
    {
      label: "Listen to document summary",
      onSelect: () => void listenToSummary(),
    },
  ];
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
      label: "Copy as Markdown",
      onSelect: () => {
        const sel = view?.state.selection.main;
        const md =
          view && sel && !sel.empty
            ? view.state.sliceDoc(sel.from, sel.to)
            : docText();
        navigator.clipboard?.writeText(md).then(
          () =>
            props.onNote(
              sel && !sel.empty
                ? "Copied the selection as Markdown."
                : "Copied the tab as Markdown.",
            ),
          () => props.onNote("Couldn't copy to the clipboard."),
        );
      },
    },
    {
      label: "Paste from Markdown",
      disabled: !canEdit,
      onSelect: () => {
        navigator.clipboard?.readText().then(
          (text) => {
            if (!view || !text) return;
            view.dispatch({
              ...view.state.replaceSelection(text.replace(/\r\n?/g, "\n")),
              userEvent: "input.paste",
              scrollIntoView: true,
            });
            view.focus();
          },
          () => props.onNote("Allow clipboard access to paste, or press ⌘V."),
        );
      },
    },
    {
      label: "Insert code block",
      disabled: !canEdit,
      onSelect: () => view && insertCodeBlock(view),
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
    PRESETS.find(
      (p) =>
        p.instructions === config.instructions &&
        (p.mode ?? "suggest") === config.mode,
    )?.label ?? "Custom";

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
            readOnly={!isCreator}
            spellCheck={false}
          />
          {peers.length > 0 ? (
            <div className="sg-peers" aria-label="People here now">
              {peers.slice(0, 5).map((c) => (
                <span
                  key={c.userId}
                  className="sg-peer"
                  style={{ background: c.color }}
                  title={c.name ?? "Guest"}
                >
                  {(c.name ?? "Guest").slice(0, 1).toUpperCase()}
                </span>
              ))}
              {peers.length > 5 ? (
                <span className="sg-peer sg-peer-more">
                  +{peers.length - 5}
                </span>
              ) : null}
            </div>
          ) : null}
          {props.share}
          <AccountMenu person={person} />
        </div>
        <MenuBar
          menus={[
            { label: "File", items: fileMenu },
            { label: "Edit", items: editMenu },
            { label: "Tools", items: toolsMenu },
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
              aria-label="Text type"
              disabled={!canEdit}
              value={blockKind}
              onChange={(e) => {
                if (view) setBlockType(view, e.target.value as BlockType);
              }}
            >
              <option value="p">Normal text</option>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={`h${n}`}>
                  Heading {n}
                </option>
              ))}
              <option value="code">Code block</option>
            </select>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path fill="currentColor" d="M7 10l5 5 5-5z" />
            </svg>
          </span>
          <span className="sg-sep" />
          <span className="sg-select-wrap">
            <select
              className="sg-select"
              aria-label="Assistant"
              disabled={!isOwner}
              value={preset}
              onChange={(e) => {
                const p = PRESETS.find((x) => x.label === e.target.value);
                if (p)
                  setConfig((c) => ({
                    ...c,
                    instructions: p.instructions,
                    kinds: p.kinds,
                    mode: p.mode ?? "suggest",
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
          <span className="sg-sep" />
          <button
            type="button"
            className="sg-tool sg-btn"
            title="Add comment (⌘⌥M)"
            disabled={!canComment}
            onMouseDown={(e) => e.preventDefault()}
            onClick={startComment}
          >
            Add comment
          </button>
          <button
            type="button"
            className="sg-tool sg-btn"
            aria-expanded={commentsOpen}
            onClick={() => setCommentsOpen((v) => !v)}
          >
            Comments{openComments ? ` (${openComments})` : ""}
          </button>
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
              readOnly={!isOwner}
              value={config.instructions}
              onChange={(e) =>
                setConfig((c) => ({
                  ...c,
                  instructions: e.target.value,
                  kinds: [...KINDS],
                }))
              }
            />
            <label htmlFor="sg-mode">How should it respond?</label>
            <select
              id="sg-mode"
              className="sg-select"
              disabled={!isOwner}
              value={config.mode}
              onChange={(e) =>
                setConfig((c) => ({ ...c, mode: e.target.value as Mode }))
              }
            >
              {MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            {isOwner ? null : (
              <small className="sg-pop-note">
                Only an Owner can change the instructions.
              </small>
            )}
          </div>
        ) : null}
      </header>
      {historyOpen ? (
        <VersionHistory
          tabTitle={title}
          currentText={docText()}
          versions={versions}
          canRestore={canEdit}
          onClose={() => setHistoryOpen(false)}
          onRestore={(text) => {
            if (!view) return;
            snapshot(docText());
            view.dispatch({
              changes: { from: 0, to: view.state.doc.length, insert: text },
              userEvent: "input",
            });
          }}
        />
      ) : null}
      <div className="sg-body">
        {props.tabs}
        <main className="sg-canvas">
          {listen ? (
            <ListenBar
              {...listen}
              onToggle={() => narrator.toggle()}
              onStop={stopListening}
            />
          ) : null}
          <Pane
            adapter={adapter}
            person={person}
            defaultText={props.seed ?? SAMPLE}
            assistant={assistant}
            onView={onPaneView}
            onBlockType={setBlockKind}
            onHistory={onHistory}
            onDoc={onDoc}
            canEdit={canEdit}
            canSuggest={canSuggest}
            onPickComment={pickComment}
          />
        </main>
        {commentsOpen ? (
          <CommentsPanel
            person={person}
            comments={comments}
            replies={replies}
            located={located}
            draft={draft}
            activeId={activeId}
            canComment={canComment}
            canModerate={canEdit}
            thinking={thinking}
            onDraft={(text) => {
              if (!draft) return;
              const { quote, from } = draft;
              void addComment(docId, tabId, { ...author, text, quote, from })
                .then((id) => {
                  setDraft(null);
                  void askScribe(id, text, quote, from);
                })
                .catch(() => props.onNote("Couldn't add that comment."));
            }}
            onCancelDraft={() => setDraft(null)}
            onSelect={selectComment}
            onReply={(id, text) => {
              const c = comments.find((x) => x.id === id);
              void addReply(docId, tabId, id, { ...author, text })
                .then(() => askScribe(id, text, c?.quote ?? "", c?.from ?? 0))
                .catch(() => props.onNote("Couldn't send that reply."));
            }}
            onResolve={(id, value) =>
              void setResolved(docId, tabId, id, value).catch(() => {})
            }
            onDelete={(id) =>
              void deleteComment(docId, tabId, id).catch(() => {})
            }
            onDeleteReply={(id, rid) =>
              void deleteReply(docId, tabId, id, rid).catch(() => {})
            }
            onClose={() => setCommentsOpen(false)}
          />
        ) : null}
        {canEdit ? (
          <Composer
            onSubmit={runCommand}
            pending={pending}
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
        creator={meta.ownerId === person.uid}
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
          creator={meta.ownerId === person.uid}
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
