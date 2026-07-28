/**
 * CodeMirror 5 collaborative text change driver module.
 * Separated cleanly from collaborative UI cursor decoration rendering.
 */
import {
  EditorDriverSeam,
  CodeMirrorLike,
  CursorLike,
  BookmarkLike,
  TextMarkerLike,
  RemoteCursorData,
} from "./types.ts";
import { PresenceDecorationManager } from "./presence-decoration-manager.ts";
import { TextOperation } from "../core/index.ts";

type Callback = (...args: any[]) => void;

export class CodeMirror5Adapter implements EditorDriverSeam {
  private cm: any;
  private rtcm: any;
  readonly decorations: PresenceDecorationManager;
  private callbacks: Record<string, Callback[]> = {};
  private disposed = false;
  private changeHandler: any;
  private cursorActivityHandler: any;
  private focusHandler: any;
  private blurHandler: any;

  constructor(rtcmOrCm: any) {
    const hasGetCodeMirror = typeof rtcmOrCm.getCodeMirror === "function";
    if (hasGetCodeMirror) {
      this.rtcm = rtcmOrCm;
      this.cm = rtcmOrCm.getCodeMirror();
    } else {
      this.cm = rtcmOrCm;
      this.rtcm = null;
    }

    this.decorations = new PresenceDecorationManager();
    this.bindCodeMirrorEvents();
  }

  private bindCodeMirrorEvents(): void {
    const hasOnMethod = Boolean(this.cm && typeof this.cm.on === "function");
    if (!hasOnMethod) return;

    this.changeHandler = (_: unknown, changes: unknown) =>
      this.onChange(_, changes);
    this.cursorActivityHandler = () => this.onCursorActivity();
    this.focusHandler = () => this.onFocus();
    this.blurHandler = () => this.onBlur();

    const hasRtcm = Boolean(this.rtcm && typeof this.rtcm.on === "function");
    if (hasRtcm) {
      this.rtcm.on("change", this.changeHandler);
      this.rtcm.on("attributesChange", this.changeHandler);
    } else {
      this.cm.on("change", this.changeHandler);
    }

    this.cm.on("cursorActivity", this.cursorActivityHandler);
    this.cm.on("focus", this.focusHandler);
    this.cm.on("blur", this.blurHandler);
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

  onChange(_: unknown, changes: unknown): void {
    const isAlreadyDisposed = this.disposed;
    if (isAlreadyDisposed) return;

    const op = this.convertChangesToOperation(changes);
    const hasOperation = Boolean(op);
    if (hasOperation) {
      this.trigger("change", op!, op!);
    }
  }

  private convertChangesToOperation(changes: any): TextOperation | null {
    const isRemoteOrigin = changes && changes.origin === "remote";
    if (isRemoteOrigin) return null;

    const isArrayChanges = Array.isArray(changes);
    if (isArrayChanges && changes.length > 0) {
      const hasFromProp = typeof changes[0].from === "object";
      if (hasFromProp) return this.translateCodeMirrorChangeObject(changes[0]);
      return TextOperation.fromJSON(changes);
    }
    const hasToOperation = typeof changes?.toOperation === "function";
    if (hasToOperation) return changes.toOperation();

    const isSingleChangeObj =
      typeof changes?.from === "object" && typeof changes?.to === "object";
    if (isSingleChangeObj) return this.translateCodeMirrorChangeObject(changes);

    const text = this.getValue();
    return new TextOperation().retain(text.length);
  }

  private translateCodeMirrorChangeObject(change: any): TextOperation | null {
    const hasIndexMethod = typeof this.cm?.indexFromPos === "function";
    if (!hasIndexMethod) return null;

    const startIdx = this.cm.indexFromPos(change.from);
    const removedText = Array.isArray(change.removed)
      ? change.removed.join("\n")
      : "";
    const insertedText = Array.isArray(change.text)
      ? change.text.join("\n")
      : "";
    const docText = this.getValue();

    const preEditTotal =
      docText.length - insertedText.length + removedText.length;
    const trailingLen = preEditTotal - startIdx - removedText.length;

    const op = new TextOperation();
    const hasPrefix = startIdx > 0;
    if (hasPrefix) op.retain(startIdx);
    const hasRemoved = removedText.length > 0;
    if (hasRemoved) op.delete(removedText.length);
    const hasInserted = insertedText.length > 0;
    if (hasInserted) op.insert(insertedText);
    const hasSuffix = trailingLen > 0;
    if (hasSuffix) op.retain(trailingLen);
    return op;
  }

  applyOperation(operation: unknown): void {
    const isAlreadyDisposed = this.disposed || !this.cm;
    if (isAlreadyDisposed) return;
    const isTextOp = typeof (operation as any).ops !== "undefined";
    if (!isTextOp) return;

    const op = operation as { ops: Array<any> };
    const hasReplaceRange = typeof this.cm.replaceRange === "function";
    if (!hasReplaceRange) return;

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
        const fromPos = this.cm.posFromIndex(index);
        this.cm.replaceRange(text, fromPos, fromPos, "remote");
        index += text.length;
        continue;
      }

      const hasDeleteFn = typeof step.isDelete === "function";
      const isDeleteNumber = typeof step === "number" && step < 0;
      const isDelete = hasDeleteFn ? step.isDelete() : isDeleteNumber;
      if (isDelete) {
        const chars =
          typeof step.chars === "number" ? step.chars : Math.abs(Number(step));
        const fromPos = this.cm.posFromIndex(index);
        const toPos = this.cm.posFromIndex(index + chars);
        this.cm.replaceRange("", fromPos, toPos, "remote");
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

  getValue(): string {
    const hasGetValue = Boolean(
      this.cm && typeof this.cm.getValue === "function",
    );
    if (hasGetValue) return this.cm.getValue();
    return "";
  }

  getCursor(): CursorLike | null {
    const hasGetCursor = Boolean(
      this.cm && typeof this.cm.getCursor === "function",
    );
    if (!hasGetCursor) return null;
    const pos = this.cm.getCursor();
    const hasIndexFromPos = typeof this.cm.indexFromPos === "function";
    const idx = hasIndexFromPos ? this.cm.indexFromPos(pos) : 0;
    return { position: idx, selectionEnd: idx };
  }

  setOtherCursor(
    data: RemoteCursorData,
  ): BookmarkLike | TextMarkerLike | undefined {
    const isAlreadyDisposed = this.disposed;
    if (isAlreadyDisposed) return undefined;

    const docLength = this.getValue().length;
    return this.decorations.setOtherCursor(data, this.cm, docLength);
  }

  clearCursor(clientId: string): void {
    this.decorations.clearCursor(clientId);
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
    this.decorations.dispose();
    this.callbacks = {};

    const hasOffMethod = Boolean(this.cm && typeof this.cm.off === "function");
    if (!hasOffMethod) return;

    const hasRtcm = Boolean(this.rtcm && typeof this.rtcm.off === "function");
    if (hasRtcm) {
      try {
        this.rtcm.off("change", this.changeHandler);
      } catch (err) {
        console.warn("Error unbinding rtcm change:", err);
      }
      try {
        this.rtcm.off("attributesChange", this.changeHandler);
      } catch (err) {
        console.warn("Error unbinding rtcm attributesChange:", err);
      }
    } else {
      try {
        this.cm.off("change", this.changeHandler);
      } catch (err) {
        console.warn("Error unbinding cm change:", err);
      }
    }

    try {
      this.cm.off("cursorActivity", this.cursorActivityHandler);
    } catch (err) {
      console.warn("Error unbinding cm cursorActivity:", err);
    }
    try {
      this.cm.off("focus", this.focusHandler);
    } catch (err) {
      console.warn("Error unbinding cm focus:", err);
    }
    try {
      this.cm.off("blur", this.blurHandler);
    } catch (err) {
      console.warn("Error unbinding cm blur:", err);
    }
  }
}
