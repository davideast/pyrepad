/**
 * Single-file custom reactive hook: usePyrepadEditor.
 * Synchronizes CodeMirror editor instances with SyncSeam network drivers and Firepad engines
 * without triggering Virtual DOM re-renders during rapid 60fps typing bursts.
 */
import { useEffect, useRef, useState, useTransition } from "react";
import { SyncSeam } from "../adapters/types.ts";
import { CodeMirror5Adapter } from "../editors/codemirror-adapter.ts";
import { CodeMirror6Adapter } from "../editors/codemirror6-driver.ts";

export interface UsePyrepadEditorOptions {
  adapter: SyncSeam | null;
  editor: unknown | null;
  dbRef?: unknown | null;
  defaultText?: string;
  type?: "cm5" | "cm6";
  userId?: string;
  userColor?: string;
}

export interface UsePyrepadEditorResult {
  editorAdapter: unknown | null;
  renderCount: number;
  isReady: boolean;
}

function createEditorAdapter(options: UsePyrepadEditorOptions): unknown {
  const { adapter, editor, dbRef, defaultText, type, userId, userColor } =
    options;
  const isCM6 = type === "cm6";
  if (isCM6) {
    return new CodeMirror6Adapter(editor as any, adapter, {
      userId: userId || "react-user",
      userColor: userColor || "#3b82f6",
    });
  }

  const globalWin = typeof window !== "undefined" ? (window as any) : {};
  const firepadObj =
    globalWin.Firepad || globalWin.firepad?.Firepad || globalWin.firepad;
  const hasFromCM = Boolean(
    firepadObj && typeof firepadObj.fromCodeMirror === "function",
  );

  if (hasFromCM && adapter) {
    const targetRef =
      dbRef !== undefined && dbRef !== null
        ? dbRef
        : (adapter as any).ref || null;
    return firepadObj.fromCodeMirror(targetRef, editor as any, {
      syncAdapter: adapter,
      userId: userId || "react-user",
      userColor: userColor || "#3b82f6",
      defaultText: defaultText || undefined,
    });
  }

  return new CodeMirror5Adapter(editor as any);
}

export function usePyrepadEditor(
  options: UsePyrepadEditorOptions,
): UsePyrepadEditorResult {
  const { adapter, editor, dbRef, defaultText, type, userId, userColor } =
    options;
  const renderCountRef = useRef<number>(0);
  const editorAdapterRef = useRef<unknown | null>(null);
  const [isReady, setIsReady] = useState<boolean>(false);
  const [_, startTransition] = useTransition();

  renderCountRef.current += 1;

  useEffect(() => {
    const isMissingDeps = !adapter || !editor;
    if (isMissingDeps) {
      editorAdapterRef.current = null;
      return;
    }

    const created = createEditorAdapter({
      adapter,
      editor,
      dbRef,
      defaultText,
      type,
      userId,
      userColor,
    });
    editorAdapterRef.current = created;
    startTransition(() => setIsReady(true));

    return () => {
      const hasAdapter = Boolean(editorAdapterRef.current);
      if (hasAdapter) {
        try {
          const disposable = editorAdapterRef.current as {
            dispose?: () => unknown;
          };
          const canDispose = typeof disposable.dispose === "function";
          if (canDispose) disposable.dispose!();
        } catch (err) {
          console.warn(
            "Unexpected error during usePyrepadEditor unmount disposal:",
            err,
          );
        }
        editorAdapterRef.current = null;
      }
      setIsReady(false);
    };
  }, [adapter, editor, dbRef, defaultText, type, userId, userColor]);

  return {
    editorAdapter: editorAdapterRef.current,
    renderCount: renderCountRef.current,
    isReady: isReady,
  };
}
