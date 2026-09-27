/**
 * CodeMirror 5 collaborative text change driver module.
 * Separated cleanly from collaborative UI cursor decoration rendering.
 */
import {
  EditorSeam,
  EditorEvents,
  CodeMirrorLike,
  RichTextCodeMirrorLike,
  OperationStep,
  CursorLike,
  BookmarkLike,
  TextMarkerLike,
  PresenceState,
} from "./types.js";
import { PresenceDecorationManager } from "./presence-decoration-manager.js";
import { TextOperation } from "../core/index.js";
import { Emitter } from "../core/emitter.js";

// Dispatch boundary: each callback's signature depends on its event name (EditorEvents).
type Callback = (...args: any[]) => void;

/** A CodeMirror 5 change object, or a rich-text change that carries its own operation. */
interface CodeMirrorChange {
  origin?: string;
  from?: unknown;
  to?: unknown;
  text?: string[];
  removed?: string[];
  toOperation?(): TextOperation;
}

function isRichTextCodeMirror(
  editor: CodeMirrorLike | RichTextCodeMirrorLike,
): editor is RichTextCodeMirrorLike {
  const candidate = editor as Partial<RichTextCodeMirrorLike>;
  return typeof candidate.getCodeMirror === "function";
}

export class CodeMirror5Adapter
  extends Emitter<EditorEvents>
  implements EditorSeam
{
  private cm: CodeMirrorLike;
  private rtcm: RichTextCodeMirrorLike | null;
  readonly decorations: PresenceDecorationManager;
  private disposed = false;
  private changeHandler?: (_: unknown, changes: unknown) => void;
  private cursorActivityHandler?: () => void;
  private focusHandler?: () => void;
  private blurHandler?: () => void;

  constructor(rtcmOrCm: CodeMirrorLike | RichTextCodeMirrorLike) {
    super();
    if (isRichTextCodeMirror(rtcmOrCm)) {
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

    if (this.rtcm && typeof this.rtcm.on === "function") {
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
        this.on(key as keyof EditorEvents, fn!);
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

  private convertChangesToOperation(changes: unknown): TextOperation | null {
    // Editor event boundary: CodeMirror 5 ships no types, so fields are probed.
    const change = changes as CodeMirrorChange | null | undefined;
    const isRemoteOrigin = change && change.origin === "remote";
    if (isRemoteOrigin) return null;

    if (Array.isArray(changes) && changes.length > 0) {
      const first = changes[0] as CodeMirrorChange;
      const hasFromProp = typeof first.from === "object";
      if (hasFromProp) return this.translateCodeMirrorChangeObject(first);
      return TextOperation.fromJSON(changes);
    }
    if (typeof change?.toOperation === "function") return change.toOperation();

    const isSingleChangeObj =
      typeof change?.from === "object" && typeof change?.to === "object";
    if (isSingleChangeObj) return this.translateCodeMirrorChangeObject(change!);

    const text = this.getValue();
    return new TextOperation().retain(text.length);
  }

  private translateCodeMirrorChangeObject(
    change: CodeMirrorChange,
  ): TextOperation | null {
    if (typeof this.cm?.indexFromPos !== "function") return null;

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
    // Editor seam boundary: a TextOperation, or any object carrying wire `ops`.
    const isTextOp =
      typeof (operation as { ops?: unknown }).ops !== "undefined";
    if (!isTextOp) return;

    const op = operation as { ops: OperationStep[] };
    if (typeof this.cm.replaceRange !== "function") return;

    let index = 0;
    for (const step of op.ops) {
      const isOp = typeof step === "object";
      const hasRetainFn = isOp && typeof step.isRetain === "function";
      const isRetainNumber = typeof step === "number" && step > 0;
      const isRetain = hasRetainFn ? step.isRetain() : isRetainNumber;
      if (isRetain) {
        const chars =
          isOp && typeof step.chars === "number" ? step.chars : Number(step);
        index += chars;
        continue;
      }

      const hasInsertFn = isOp && typeof step.isInsert === "function";
      const isInsertString = typeof step === "string";
      const isInsert = hasInsertFn ? step.isInsert() : isInsertString;
      if (isInsert) {
        const text =
          isOp && typeof step.text === "string" ? step.text : String(step);
        const fromPos = this.cm.posFromIndex(index);
        this.cm.replaceRange(text, fromPos, fromPos, "remote");
        index += text.length;
        continue;
      }

      const hasDeleteFn = isOp && typeof step.isDelete === "function";
      const isDeleteNumber = typeof step === "number" && step < 0;
      const isDelete = hasDeleteFn ? step.isDelete() : isDeleteNumber;
      if (isDelete) {
        const chars =
          isOp && typeof step.chars === "number"
            ? step.chars
            : Math.abs(Number(step));
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
    if (!this.cm || typeof this.cm.getCursor !== "function") return null;
    const pos = this.cm.getCursor();
    const idx =
      typeof this.cm.indexFromPos === "function"
        ? this.cm.indexFromPos(pos)
        : 0;
    return { position: idx, selectionEnd: idx };
  }

  setOtherCursor(
    data: PresenceState,
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
    this.off();

    const hasOffMethod = Boolean(this.cm && typeof this.cm.off === "function");
    if (!hasOffMethod) return;

    if (this.rtcm && typeof this.rtcm.off === "function") {
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
