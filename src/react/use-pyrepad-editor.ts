/**
 * Single-file custom reactive hook: usePyrepadEditor.
 * Synchronizes CodeMirror editor instances with SyncSeam network drivers and ES Module engines
 * without triggering Virtual DOM re-renders during rapid 60fps typing bursts.
 */
import { useEffect, useRef, useState, useTransition, useContext } from "react";
import { SyncSeam } from "../adapters/types.ts";
import { CodeMirror5Adapter } from "../editors/codemirror-adapter.ts";
import { CodeMirror6Adapter } from "../editors/codemirror6-driver.ts";
import { PyrepadContext, useResolvedAdapter } from "./context.tsx";

export interface UsePyrepadEditorOptions {
  adapter?: SyncSeam | null;
  editor?: unknown | null;
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

function createEditorAdapter(
  editor: unknown,
  adapter: SyncSeam | null,
  options: UsePyrepadEditorOptions,
): unknown {
  const { type, userId, userColor } = options;
  const isCM6 = type === "cm6";
  if (isCM6) {
    const defaultColor = userColor || "#3b82f6";
    const defaultId = userId || "react-user";
    return new CodeMirror6Adapter(editor as any, adapter, {
      userId: defaultId,
      userColor: defaultColor,
    });
  }

  return new CodeMirror5Adapter(editor as any);
}

export function usePyrepadEditor(
  options: UsePyrepadEditorOptions,
): UsePyrepadEditorResult {
  const { adapter: customAdapter, editor, type, userId, userColor } = options;
  const adapter = useResolvedAdapter(customAdapter);
  const ctx = useContext(PyrepadContext);

  const renderCountRef = useRef<number>(0);
  const editorAdapterRef = useRef<unknown | null>(null);
  const [isReady, setIsReady] = useState<boolean>(false);
  const [_, startTransition] = useTransition();

  renderCountRef.current += 1;

  useEffect(() => {
    const hasAdapter = Boolean(adapter);
    const hasEditor = Boolean(editor);
    const isReadyToBind = hasAdapter && hasEditor;

    if (!isReadyToBind) {
      editorAdapterRef.current = null;
      return;
    }

    const created = createEditorAdapter(editor, adapter, options);
    editorAdapterRef.current = created;

    const hasContext = Boolean(
      ctx && typeof ctx.setEditorAdapter === "function",
    );
    if (hasContext) {
      ctx.setEditorAdapter(created);
    }

    startTransition(() => setIsReady(true));

    return () => {
      const hasCreatedAdapter = Boolean(editorAdapterRef.current);
      if (hasCreatedAdapter) {
        try {
          const disposable = editorAdapterRef.current as {
            dispose?: () => unknown;
          };
          const canDispose = typeof disposable.dispose === "function";
          if (canDispose) {
            disposable.dispose!();
          }
        } catch (err) {
          console.warn(
            "Unexpected error during usePyrepadEditor unmount disposal:",
            err,
          );
        }
        editorAdapterRef.current = null;
      }

      if (hasContext) {
        ctx.setEditorAdapter(null);
      }
      setIsReady(false);
    };
  }, [adapter, editor, type, userId, userColor, ctx]);

  return {
    editorAdapter: editorAdapterRef.current,
    renderCount: renderCountRef.current,
    isReady: isReady,
  };
}
