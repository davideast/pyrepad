/**
 * CodeMirror 6 editor adapter. Maps local CM6 transactions to TextOperations
 * (via an installed EditorView.updateListener) and applies remote
 * TextOperations as transactions tagged with the `remoteOrigin` annotation,
 * which the listener skips so remote edits are not echoed back.
 */
import {
  Annotation,
  Compartment,
  StateEffect,
  Transaction,
  type AnnotationType,
  type Text,
} from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import {
  EditorSeam,
  EditorEvents,
  PresenceState,
  CursorLike,
} from "./types.js";
import { CM6PresencePlugin } from "./cm6-decoration-plugin.js";
import { TextOperation } from "../core/index.js";
import { Emitter } from "../core/emitter.js";

type Callback = (...args: any[]) => void;

export class CodeMirror6Adapter
  extends Emitter<EditorEvents>
  implements EditorSeam
{
  private view: EditorView | null;
  readonly presencePlugin: CM6PresencePlugin;
  readonly remoteOrigin: AnnotationType<boolean> = Annotation.define<boolean>();
  private readonly compartment = new Compartment();
  private disposed = false;
  private wired = false;

  constructor(view: EditorView) {
    super();
    this.view = view;
    this.presencePlugin = new CM6PresencePlugin();
    const listener = EditorView.updateListener.of((update: ViewUpdate) => {
      for (const tr of update.transactions) this.onTransaction(tr);
    });
    // Tolerates a non-view (e.g. a stub editor in react-hooks.spec.js): nothing
    // is wired and the adapter stays inert.
    if (typeof view?.dispatch !== "function") return;
    view.dispatch({
      effects: StateEffect.appendConfig.of(
        this.compartment.of([listener, this.presencePlugin.extension]),
      ),
    });
    this.wired = true;
  }

  registerCallbacks(callbacks: Record<string, Callback>): void {
    const isObject = typeof callbacks === "object" && callbacks !== null;
    if (!isObject) return;
    for (const key of Object.keys(callbacks)) {
      const fn = callbacks[key];
      const isFn = typeof fn === "function";
      if (isFn) {
        this.on(key as keyof EditorEvents, fn!);
      }
    }
  }

  onTransaction(tr: Transaction): void {
    const isAlreadyDisposed = this.disposed || !this.view;
    if (isAlreadyDisposed) return;

    const isRemoteOrigin = tr.annotation(this.remoteOrigin) === true;
    if (isRemoteOrigin) return;

    if (tr.docChanged) {
      const op = this.convertTransactionToOperation(tr);
      this.trigger("change", op, op);
    }

    const isSelectionChanged = Boolean(tr.selection);
    if (isSelectionChanged) {
      this.onCursorActivity();
    }
  }

  onChange(_editor: unknown, changes: unknown): void {
    const isAlreadyDisposed = this.disposed;
    if (isAlreadyDisposed) return;
    if (changes instanceof Transaction) {
      this.onTransaction(changes);
    }
  }

  convertTransactionToOperation(tr: Transaction): TextOperation {
    const op = new TextOperation();
    let currentIdx = 0;

    tr.changes.iterChanges(
      (fromA: number, toA: number, ...rest: [number, number, Text]) => {
        const inserted = rest[2];
        if (fromA > currentIdx) op.retain(fromA - currentIdx);
        if (toA > fromA) op.delete(toA - fromA);
        const insertStr = inserted.toString();
        if (insertStr.length > 0) op.insert(insertStr);
        currentIdx = toA;
      },
    );

    const trailingLen = tr.startState.doc.length - currentIdx;
    if (trailingLen > 0) op.retain(trailingLen);

    return op;
  }

  applyOperation(operation: unknown): void {
    const view = this.view;
    const isAlreadyDisposed = this.disposed || !view;
    if (isAlreadyDisposed) return;
    const isTextOp = typeof (operation as any).ops !== "undefined";
    if (!isTextOp) return;

    const op = operation as { ops: Array<any> };
    const changes: Array<{ from: number; to?: number; insert?: string }> = [];
    let index = 0;

    for (const step of op.ops) {
      const hasRetainFn = typeof step.isRetain === "function";
      const isRetainNumber = typeof step === "number" && step > 0;
      const isRetain = hasRetainFn ? step.isRetain() : isRetainNumber;
      if (isRetain) {
        const chars =
          typeof step.chars === "number" ? step.chars : Number(step);
        index += chars;
        continue;
      }

      const hasInsertFn = typeof step.isInsert === "function";
      const isInsertString = typeof step === "string";
      const isInsert = hasInsertFn ? step.isInsert() : isInsertString;
      if (isInsert) {
        const text = typeof step.text === "string" ? step.text : String(step);
        changes.push({ from: index, to: index, insert: text });
        continue;
      }

      const hasDeleteFn = typeof step.isDelete === "function";
      const isDeleteNumber = typeof step === "number" && step < 0;
      const isDelete = hasDeleteFn ? step.isDelete() : isDeleteNumber;
      if (isDelete) {
        const chars =
          typeof step.chars === "number" ? step.chars : Math.abs(Number(step));
        changes.push({ from: index, to: index + chars });
        index += chars;
      }
    }

    if (changes.length > 0) {
      try {
        view.dispatch({
          changes: changes,
          annotations: this.remoteOrigin.of(true),
        });
      } catch (err) {
        console.warn("Unexpected error dispatching CM6 changes:", err);
      }
    }
  }

  onCursorActivity(): void {
    const isAlreadyDisposed = this.disposed;
    if (isAlreadyDisposed) return;
    this.trigger("cursor", this.getCursor());
  }

  onFocus(): void {
    const isAlreadyDisposed = this.disposed;
    if (isAlreadyDisposed) return;
    this.trigger("focus");
  }

  onBlur(): void {
    const isAlreadyDisposed = this.disposed;
    if (isAlreadyDisposed) return;
    this.trigger("blur");
  }

  getCursor(): CursorLike | null {
    const isDisposed = this.disposed || !this.view;
    if (isDisposed) return null;

    const selection = this.view?.state?.selection?.main;
    const hasSelection = Boolean(
      selection &&
      typeof selection.head === "number" &&
      typeof selection.anchor === "number",
    );
    if (hasSelection) {
      return { position: selection!.head, selectionEnd: selection!.anchor };
    }

    const docLen = this.view?.state?.doc?.length ?? 0;
    return { position: docLen, selectionEnd: docLen };
  }

  setOtherCursor(data: PresenceState): void {
    const isDisposed = this.disposed || !this.view;
    if (isDisposed) return;
    this.presencePlugin.setOtherCursor(data, this.view!);
  }

  clearCursor(clientId: string): void {
    const isDisposed = this.disposed || !this.view;
    if (isDisposed) return;
    this.presencePlugin.clearCursor(clientId, this.view!);
  }

  detach(): void {
    this.dispose();
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  dispose(): void {
    const isAlreadyDisposed = this.disposed;
    if (isAlreadyDisposed) return;
    this.disposed = true;
    if (this.wired) {
      try {
        this.view?.dispatch({ effects: this.compartment.reconfigure([]) });
      } catch (err) {
        console.warn("Unexpected error removing CM6 adapter extensions:", err);
      }
    }
    this.presencePlugin.dispose();
    this.off();
    this.view = null;
  }
}
