/**
 * @pyric/pad/editors types and interfaces.
 */

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

export interface RemoteCursorData {
  cursor: CursorLike;
  color: string;
  clientId: string;
}

export interface DecorationManagerSeam {
  setOtherCursor(
    data: RemoteCursorData,
    cm: CodeMirrorLike,
    maxDocIndex?: number,
  ): BookmarkLike | TextMarkerLike | undefined;
  clearCursor(clientId: string): void;
  dispose(): void;
  isDisposed(): boolean;
  getActiveWidgetCount(): number;
}

export interface EditorDriverSeam {
  onChange(editor: unknown, changes: unknown): void;
  applyOperation(operation: unknown): void;
  onCursorActivity(): void;
  onFocus(): void;
  onBlur(): void;
  detach(): void;
  dispose(): void;
}

export interface CM6ChangeSetLike {
  iterChanges(fn: (fromA: number, toA: number, ...rest: any[]) => void): void;
  length?: number;
}

export interface CM6TransactionLike {
  changes: CM6ChangeSetLike;
  startState: { doc: { length: number; toString(): string } };
  state: { doc: { length: number; toString(): string } };
  annotation(key: unknown): unknown;
  docChanged: boolean;
  selection?: { main: { head: number; anchor: number } };
}

export interface CM6ViewLike {
  state: { doc: { length: number; toString(): string } };
  dispatch(specs: {
    changes?: Array<{ from: number; to?: number; insert?: string }>;
    annotations?: unknown | unknown[];
    effects?: unknown;
  }): void;
  requestMeasure?(request: unknown): void;
}

export interface CM6WidgetLike {
  toDOM(view?: CM6ViewLike): any;
  eq(other: CM6WidgetLike): boolean;
  destroy(dom?: any): void;
  dispose(): void;
  isDisposed(): boolean;
}

export interface CM6PluginSeam {
  setOtherCursor(data: RemoteCursorData, view: CM6ViewLike): void;
  clearCursor(clientId: string, view?: CM6ViewLike): void;
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
