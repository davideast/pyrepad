/**
 * usePyrepadEditor: binds an editor to a SyncSeam.
 *
 * - remote `operations` events -> `editor.applyOperation` (echoes of this
 *   hook's own commits, matched by author, are skipped)
 * - editor "change" -> `adapter.commitOperation(op, userId)`
 * - editor "cursor" -> `adapter.broadcastPresence(cursor)`
 * - `presence` events -> `editor.setOtherCursor` / `editor.clearCursor`
 * - `defaultText` seeds the shared document once, when the adapter is ready
 *   and its history is empty.
 *
 * The binding lives in an effect and refs, so edits never cause a React render.
 */
import { useEffect, useRef, useState, useContext } from "react";
import { SyncSeam, PresenceEvent } from "../adapters/types.ts";
import { EditorSeam, PresenceState, CursorLike } from "../editors/types.ts";
import { CodeMirror5Adapter } from "../editors/codemirror-adapter.ts";
import { CodeMirror6Adapter } from "../editors/codemirror6-adapter.ts";
import { TextOperation } from "../core/index.ts";
import { PyrepadContext, useResolvedAdapter } from "./context.tsx";
import { consumeStream } from "./consume-stream.ts";

export interface UsePyrepadEditorOptions {
  adapter?: SyncSeam | null;
  /**
   * A CodeMirror 5 instance, a CodeMirror 6 `EditorView`, or an editor adapter
   * you built yourself (anything with `applyOperation` and `on`). A
   * caller-built adapter is not disposed on unmount.
   *
   * `dbRef` was removed: the SyncSeam adapter already owns the database ref.
   */
  editor?: unknown | null;
  /** Seeds an empty shared document once, when the adapter becomes ready. */
  defaultText?: string;
  type?: "cm5" | "cm6";
  /**
   * Author id for commits; `operations` events with this author are treated
   * as echoes. Defaults to a random id per hook instance.
   */
  userId?: string;
  /** Unused by the hook: the adapter owns the presence colour. */
  userColor?: string;
}

export interface UsePyrepadEditorResult {
  editorAdapter: unknown | null;
  renderCount: number;
  isReady: boolean;
}

/** What the hook drives beyond EditorSeam; both CodeMirror adapters provide it. */
type BindableEditor = EditorSeam & {
  on(event: string, fn: (...args: any[]) => void): void;
  setOtherCursor(data: PresenceState): unknown;
  clearCursor(clientId: string): void;
};

/** Readiness is not part of SyncSeam; AbstractSyncAdapter and the offline adapter expose it. */
interface ReadinessAware {
  once(event: "ready", callback: () => void): void;
  isHistoryEmpty(): boolean;
}

interface Binding {
  adapter: SyncSeam;
  seam: BindableEditor;
  authorId: string;
  editor: unknown;
  getDefaultText(): string | undefined;
}

function isBindableEditor(editor: unknown): editor is BindableEditor {
  const candidate = editor as Partial<BindableEditor>;
  return (
    typeof candidate.applyOperation === "function" &&
    typeof candidate.on === "function"
  );
}

function resolveEditorSeam(
  editor: unknown,
  type: "cm5" | "cm6" | undefined,
): { seam: BindableEditor; owned: boolean } {
  if (isBindableEditor(editor)) return { seam: editor, owned: false };
  const seam =
    type === "cm6"
      ? new CodeMirror6Adapter(
          editor as ConstructorParameters<typeof CodeMirror6Adapter>[0],
        )
      : new CodeMirror5Adapter(editor);
  return { seam, owned: true };
}

function isReadinessAware(
  adapter: SyncSeam,
): adapter is SyncSeam & ReadinessAware {
  const candidate = adapter as Partial<ReadinessAware>;
  return (
    typeof candidate.once === "function" &&
    typeof candidate.isHistoryEmpty === "function"
  );
}

/** Calls back with `isHistoryEmpty()` once the adapter is ready (now or later). */
function whenReady(
  adapter: SyncSeam,
  callback: (historyEmpty: boolean) => void,
): () => void {
  if (!isReadinessAware(adapter)) return () => {};
  let cancelled = false;
  const check = () => {
    if (!cancelled) callback(adapter.isHistoryEmpty());
  };
  let alreadyReady = true;
  try {
    adapter.isHistoryEmpty();
  } catch {
    alreadyReady = false;
  }
  if (alreadyReady) check();
  else adapter.once("ready", check);
  return () => {
    cancelled = true;
  };
}

function isEditorEmpty(editor: unknown): boolean {
  const e = editor as {
    getValue?: () => string;
    state?: { doc?: { length: number } };
  };
  if (typeof e.getValue === "function") return e.getValue() === "";
  if (e.state && e.state.doc) return e.state.doc.length === 0;
  return true;
}

function commit(adapter: SyncSeam, op: unknown, authorId: string): void {
  adapter
    .commitOperation(op, authorId)
    .catch((err) => console.warn("usePyrepadEditor commit failed:", err));
}

function applyPresence(seam: BindableEditor, event: PresenceEvent): void {
  const cursor = event.cursor as CursorLike | null;
  const isGone =
    event.state === "disconnected" ||
    !cursor ||
    typeof cursor.position !== "number";
  if (isGone) {
    seam.clearCursor(event.userId);
    return;
  }
  seam.setOtherCursor({
    cursor: { position: cursor.position, selectionEnd: cursor.selectionEnd },
    color: event.color,
    clientId: event.userId,
  });
}

function seedDefaultText(binding: Binding, historyEmpty: boolean): void {
  const text = binding.getDefaultText();
  const shouldSeed =
    historyEmpty && Boolean(text) && isEditorEmpty(binding.editor);
  if (!shouldSeed) return;
  const op = new TextOperation().insert(text!);
  binding.seam.applyOperation(op);
  commit(binding.adapter, op, binding.authorId);
}

function bindEditorToSeam(binding: Binding): () => void {
  const { adapter, seam, authorId } = binding;
  let bound = true;

  // EditorSeam has no `off`; the `bound` flag makes these inert after cleanup.
  seam.on("change", (op: unknown) => {
    if (bound) commit(adapter, op, authorId);
  });
  seam.on("cursor", (cursor: unknown) => {
    if (!bound || !cursor) return;
    adapter
      .broadcastPresence(cursor)
      .catch((err) => console.warn("usePyrepadEditor presence failed:", err));
  });

  const stopOperations = consumeStream(adapter.operations, (event) => {
    if (event.author !== authorId) seam.applyOperation(event.operation);
  });
  const stopPresence = consumeStream(adapter.presence, (event) =>
    applyPresence(seam, event),
  );
  const cancelSeed = whenReady(adapter, (historyEmpty) =>
    seedDefaultText(binding, historyEmpty),
  );

  return () => {
    bound = false;
    stopOperations();
    stopPresence();
    cancelSeed();
  };
}

export function usePyrepadEditor(
  options: UsePyrepadEditorOptions,
): UsePyrepadEditorResult {
  const { adapter: customAdapter, editor, type, userId, defaultText } = options;
  const adapter = useResolvedAdapter(customAdapter);
  const { setEditorAdapter } = useContext(PyrepadContext);
  const [fallbackId] = useState(
    () => "react-" + Math.random().toString(36).substring(2, 8),
  );
  const authorId = userId || fallbackId;

  const defaultTextRef = useRef<string | undefined>(defaultText);
  defaultTextRef.current = defaultText;
  const renderCountRef = useRef<number>(0);
  const editorAdapterRef = useRef<unknown | null>(null);
  const [isReady, setIsReady] = useState<boolean>(false);

  renderCountRef.current += 1;

  useEffect(() => {
    if (!adapter || !editor) {
      editorAdapterRef.current = null;
      return;
    }

    const { seam, owned } = resolveEditorSeam(editor, type);
    editorAdapterRef.current = seam;
    setEditorAdapter(seam);
    const unbind = bindEditorToSeam({
      adapter,
      seam,
      authorId,
      editor,
      getDefaultText: () => defaultTextRef.current,
    });
    setIsReady(true);

    return () => {
      unbind();
      if (owned) seam.dispose();
      editorAdapterRef.current = null;
      setEditorAdapter(null);
      setIsReady(false);
    };
  }, [adapter, editor, type, authorId, setEditorAdapter]);

  return {
    editorAdapter: editorAdapterRef.current,
    renderCount: renderCountRef.current,
    isReady: isReady,
  };
}
