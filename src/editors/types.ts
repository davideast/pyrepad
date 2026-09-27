/**
 * @pyric/pad/editors types and interfaces.
 */
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { TextOperation } from "../core/index.ts";
import type { Listener } from "../core/emitter.ts";

export interface CursorLike {
  position: number;
  selectionEnd: number;
}

export interface BookmarkLike {
  clear(): void;
}

export interface TextMarkerLike {
  clear(): void;
}

export interface CodeMirrorLike {
  posFromIndex(index: number): unknown;
  indexFromPos?(pos: unknown): number;
  cursorCoords(pos: unknown): { top: number; bottom: number; left?: number };
  defaultTextHeight?(): number;
  setBookmark(
    pos: unknown,
    options?: { widget?: unknown; insertLeft?: boolean },
  ): BookmarkLike;
  markText(
    from: unknown,
    to: unknown,
    options?: { className?: string; css?: string },
  ): TextMarkerLike;
  on(event: string, handler: unknown): void;
  off(event: string, handler: unknown): void;
  getValue(): string;
  setValue?(content: string): void;
  replaceRange?(
    text: string,
    from: unknown,
    to?: unknown,
    origin?: string,
  ): void;
}

export interface CursorWidgetSeam {
  getElement(): unknown;
  updateColor(color: string): void;
  updateTooltip(text: string): void;
  showTooltip(durationMs?: number): void;
  hideTooltip(delayMs?: number): void;
  getVerticalDiscrepancy(): number;
  dispose(): void;
  isDisposed(): boolean;
  getActiveTimerCount(): number;
  getActiveListenerCount(): number;
}

export interface PresenceState {
  cursor: CursorLike;
  color: string;
  clientId: string;
}

export interface DecorationManagerSeam {
  setOtherCursor(
    data: PresenceState,
    cm: CodeMirrorLike,
    maxDocIndex?: number,
  ): BookmarkLike | TextMarkerLike | undefined;
  clearCursor(clientId: string): void;
  dispose(): void;
  isDisposed(): boolean;
  getActiveWidgetCount(): number;
}

/** Listener argument tuples for the events the editor adapters trigger. */
export type EditorEvents = {
  change: [operation: TextOperation, inverse: TextOperation];
  cursor: [cursor: CursorLike | null];
  focus: [];
  blur: [];
};

export interface EditorSeam {
  on<K extends keyof EditorEvents>(
    event: K,
    fn: Listener<EditorEvents[K]>,
  ): void;
  off<K extends keyof EditorEvents>(
    event: K,
    fn?: Listener<EditorEvents[K]>,
  ): void;
  setOtherCursor(data: PresenceState): unknown;
  clearCursor(clientId: string): void;
  onChange(editor: unknown, changes: unknown): void;
  applyOperation(operation: unknown): void;
  onCursorActivity(): void;
  onFocus(): void;
  onBlur(): void;
  detach(): void;
  dispose(): void;
}

export interface CM6WidgetLike {
  toDOM(view?: EditorView): HTMLElement;
  eq(other: object): boolean;
  destroy(dom?: HTMLElement): void;
  dispose(): void;
  isDisposed(): boolean;
}

export interface CM6PluginSeam {
  readonly extension: Extension;
  setOtherCursor(data: PresenceState, view: EditorView): void;
  clearCursor(clientId: string, view?: EditorView): void;
  getDecorations(): Array<{
    from: number;
    to: number;
    widget?: CM6WidgetLike;
    className?: string;
    clientId: string;
  }>;
  dispose(): void;
  isDisposed(): boolean;
  getActiveWidgetCount(): number;
}
