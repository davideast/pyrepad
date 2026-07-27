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
