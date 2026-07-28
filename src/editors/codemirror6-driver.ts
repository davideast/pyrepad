/**
 * CodeMirror 6 transactional collaborative editor driver module.
 * Maps immutable CM6 StateField modifications (Transaction.changes) directly to Pyrepad TextOperations.
 */
import {
  EditorDriverSeam,
  CM6ViewLike,
  CM6TransactionLike,
  RemoteCursorData,
  CursorLike,
} from "./types.ts";
import { CM6PresencePlugin } from "./cm6-decoration-plugin.ts";
import { TextOperation } from "../core/index.ts";

type Callback = (...args: any[]) => void;

export class CodeMirror6Adapter implements EditorDriverSeam {
  private view: CM6ViewLike | null;
  readonly presencePlugin: CM6PresencePlugin;
  readonly remoteOrigin: symbol = Symbol("pyrepad.remote.cm6");
  private callbacks: Record<string, Callback[]> = {};
  private disposed = false;

  constructor(view: CM6ViewLike) {
    this.view = view;
    this.presencePlugin = new CM6PresencePlugin();
  }

  registerCallbacks(callbacks: Record<string, Callback>): void {
    const isObject = typeof callbacks === "object" && callbacks !== null;
    if (!isObject) return;
    for (const key of Object.keys(callbacks)) {
      const fn = callbacks[key];
      const isFn = typeof fn === "function";
      if (isFn) {
        this.on(key, fn!);
      }
    }
  }

  on(event: string, fn: Callback): void {
    const isNewEvent = !this.callbacks[event];
    if (isNewEvent) this.callbacks[event] = [];
    this.callbacks[event].push(fn);
  }

  trigger(event: string, ...args: unknown[]): void {
    const handlers = this.callbacks[event];
    const hasHandlers = Boolean(handlers && handlers.length > 0);
    if (hasHandlers) {
      for (const fn of [...handlers]) {
        fn(...args);
      }
    }
  }

  onTransaction(tr: CM6TransactionLike): void {
    const isAlreadyDisposed = this.disposed || !this.view;
    if (isAlreadyDisposed) return;

    const annotation =
      typeof tr.annotation === "function"
        ? tr.annotation(this.remoteOrigin)
        : null;
    const isRemoteOrigin = Boolean(annotation) || annotation === "remote";
    if (isRemoteOrigin) return;

    const isDocChanged = Boolean(tr.docChanged && tr.changes);
    if (isDocChanged) {
      const op = this.convertTransactionToOperation(tr);
      const hasOp = Boolean(op);
      if (hasOp) {
        this.trigger("change", op!, op!);
      }
    }

    const isSelectionChanged = Boolean(tr.selection);
    if (isSelectionChanged) {
      this.onCursorActivity();
    }
  }

  onChange(_editor: unknown, changes: unknown): void {
    const isAlreadyDisposed = this.disposed;
    if (isAlreadyDisposed) return;
    const isTrLike = Boolean(
      changes &&
      typeof (changes as CM6TransactionLike).annotation === "function",
    );
    if (isTrLike) {
      this.onTransaction(changes as CM6TransactionLike);
    }
  }

  convertTransactionToOperation(tr: CM6TransactionLike): TextOperation | null {
    const docA = tr.startState?.doc ? tr.startState.doc.toString() : "";
    const op = new TextOperation();
    let currentIdx = 0;

    const hasIterChanges = Boolean(
      tr.changes && typeof tr.changes.iterChanges === "function",
    );
    if (!hasIterChanges) {
      const fallbackLen = docA.length || (this.view?.state?.doc?.length ?? 0);
      return new TextOperation().retain(fallbackLen);
    }

    tr.changes.iterChanges((fromA: number, toA: number, ...rest: any[]) => {
      const inserted = rest.length >= 3 ? rest[2] : rest[rest.length - 1];
      const retainLen = fromA - currentIdx;
      const hasPrefixRetain = retainLen > 0;
      if (hasPrefixRetain) {
        op.retain(retainLen);
      }

      const deleteLen = toA - fromA;
      const hasDeletedChars = deleteLen > 0;
      if (hasDeletedChars) {
        op.delete(deleteLen);
      }

      let insertStr = "";
      const isStringInserted = typeof inserted === "string";
      if (isStringInserted) {
        insertStr = inserted;
      } else {
        const hasToString = Boolean(
          inserted && typeof inserted.toString === "function",
        );
        if (hasToString) {
          insertStr = inserted.toString();
        }
      }
      const hasInsertedText = insertStr.length > 0;
      if (hasInsertedText) {
        op.insert(insertStr);
      }

      currentIdx = toA;
    });

    const docLen =
      docA.length || (tr.state?.doc ? tr.state.doc.toString().length : 0);
    const trailingLen = docLen - currentIdx;
    const hasTrailingRetain = trailingLen > 0;
    if (hasTrailingRetain) {
      op.retain(trailingLen);
    }

    return op;
  }

  applyOperation(operation: unknown): void {
    const isAlreadyDisposed = this.disposed || !this.view;
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

    const hasChangesToDispatch =
      changes.length > 0 && typeof this.view.dispatch === "function";
    if (hasChangesToDispatch) {
      try {
        this.view.dispatch({
          changes: changes,
          annotations: [this.remoteOrigin],
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

  setOtherCursor(data: RemoteCursorData): void {
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
    this.presencePlugin.dispose();
    this.callbacks = {};
    this.view = null;
  }
}
