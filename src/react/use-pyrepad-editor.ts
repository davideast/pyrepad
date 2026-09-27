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
import { SyncSeam, PresenceEvent } from "../adapters/types.js";
import { EditorSeam, CursorLike } from "../editors/types.js";
import { CodeMirror5Adapter } from "../editors/codemirror-adapter.js";
import { CodeMirror6Adapter } from "../editors/codemirror6-adapter.js";
import { TextOperation } from "../core/index.js";
import { PyrepadContext, useResolvedAdapter } from "./context.js";
import { consumeStream } from "./consume-stream.js";

export interface UsePyrepadEditorOptions {
  adapter?: SyncSeam | null;
  /**
   * A CodeMirror 5 instance, a CodeMirror 6 `EditorView`, or an editor adapter
   * you built yourself (an `EditorSeam`; its listeners are removed on unmount). A
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

interface Binding {
  adapter: SyncSeam;
  seam: EditorSeam;
  authorId: string;
  editor: unknown;
  getDefaultText(): string | undefined;
}

function isEditorSeam(editor: unknown): editor is EditorSeam {
  const candidate = editor as Partial<EditorSeam>;
  return (
    typeof candidate.applyOperation === "function" &&
    typeof candidate.on === "function"
  );
}

function resolveEditorSeam(
  editor: unknown,
  type: "cm5" | "cm6" | undefined,
): { seam: EditorSeam; owned: boolean } {
  if (isEditorSeam(editor)) return { seam: editor, owned: false };
  const seam =
    type === "cm6"
      ? new CodeMirror6Adapter(
          editor as ConstructorParameters<typeof CodeMirror6Adapter>[0],
        )
      : new CodeMirror5Adapter(
          editor as ConstructorParameters<typeof CodeMirror5Adapter>[0],
        );
  return { seam, owned: true };
}

/** Calls back with `isHistoryEmpty()` once the adapter is ready (now or later). */
function whenReady(
  adapter: SyncSeam,
  callback: (historyEmpty: boolean) => void,
): () => void {
  let cancelled = false;
  adapter.whenReady().then(
    () => {
      if (!cancelled) callback(adapter.isHistoryEmpty());
    },
    () => {}, // disposed before ready: nothing to seed
  );
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

function applyPresence(seam: EditorSeam, event: PresenceEvent): void {
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

  const onChange = (op: unknown) => commit(adapter, op, authorId);
  const onCursor = (cursor: unknown) => {
    if (!cursor) return;
    adapter
      .broadcastPresence(cursor)
      .catch((err) => console.warn("usePyrepadEditor presence failed:", err));
  };
  seam.on("change", onChange);
  seam.on("cursor", onCursor);

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
    seam.off("change", onChange);
    seam.off("cursor", onCursor);
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
