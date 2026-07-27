/**
 * Collaborative UI decoration management module responsible for coordinating remote cursors, selections, and badges.
 */
import {
  DecorationManagerSeam,
  RemoteCursorData,
  CodeMirrorLike,
  BookmarkLike,
  TextMarkerLike,
} from "./types.ts";
import { FigmaCursorWidget } from "./figma-cursor-widget.ts";

export class FigmaDecorationManager implements DecorationManagerSeam {
  private activeWidgets: Record<string, FigmaCursorWidget> = {};
  private activeBookmarks: Record<string, BookmarkLike | TextMarkerLike> = {};
  private disposed = false;

  constructor() {
    this.activeWidgets = {};
  }

  setOtherCursor(
    data: RemoteCursorData,
    cm: CodeMirrorLike,
    maxDocIndex?: number,
  ): BookmarkLike | TextMarkerLike | undefined {
    const isAlreadyDisposed = this.disposed;
    if (isAlreadyDisposed) return undefined;

    const { cursor, color, clientId } = data;
    const isValidColor =
      typeof color === "string" && Boolean(color.match(/^#[a-fA-F0-9]{3,6}$/));
    if (!isValidColor) return undefined;

    const isValidCursor =
      typeof cursor === "object" &&
      cursor !== null &&
      typeof cursor.position === "number" &&
      typeof cursor.selectionEnd === "number";
    if (!isValidCursor) return undefined;

    const limit = maxDocIndex !== undefined ? maxDocIndex : Infinity;
    const isOutOfBounds =
      cursor.position < 0 ||
      cursor.position > limit ||
      cursor.selectionEnd < 0 ||
      cursor.selectionEnd > limit;
    if (isOutOfBounds) return undefined;

    this.clearCursor(clientId);

    const isCollapsed = cursor.position === cursor.selectionEnd;
    if (isCollapsed) {
      return this.mountCaretWidget(data, cm);
    }
    return this.mountSelectionRange(data, cm);
  }

  private mountCaretWidget(
    data: RemoteCursorData,
    cm: CodeMirrorLike,
  ): BookmarkLike {
    const { cursor, color, clientId } = data;
    const pos = cm.posFromIndex(cursor.position);
    const coords = cm.cursorCoords(pos);
    const hasCoords = typeof coords === "object" && coords !== null;
    const hasDefaultHeight = typeof cm.defaultTextHeight === "function";
    let height = hasDefaultHeight ? cm.defaultTextHeight!() : 21;

    if (hasCoords) {
      const exactHeight = coords.bottom - coords.top;
      const isPositiveHeight = exactHeight > 0;
      if (isPositiveHeight) height = exactHeight;
    }

    const widget = new FigmaCursorWidget(color, clientId, height);
    this.activeWidgets[clientId] = widget;

    const bookmark = cm.setBookmark(pos, {
      widget: widget.getElement(),
      insertLeft: true,
    });
    this.activeBookmarks[clientId] = bookmark;
    return bookmark;
  }

  private mountSelectionRange(
    data: RemoteCursorData,
    cm: CodeMirrorLike,
  ): TextMarkerLike {
    const { cursor } = data;
    const className = "other-client-selection";
    const posA = cursor.position;
    const posB = cursor.selectionEnd;
    const isForward = posB > posA;
    const fromIdx = isForward ? posA : posB;
    const toIdx = isForward ? posB : posA;

    const fromPos = cm.posFromIndex(fromIdx);
    const toPos = cm.posFromIndex(toIdx);

    const marker = cm.markText(fromPos, toPos, { className: className });
    this.activeBookmarks[data.clientId] = marker;
    return marker;
  }

  clearCursor(clientId: string): void {
    const widget = this.activeWidgets[clientId];
    const hasWidget = Boolean(widget);
    if (hasWidget) {
      widget!.dispose();
      delete this.activeWidgets[clientId];
    }

    const bookmark = this.activeBookmarks[clientId];
    const hasBookmark = Boolean(bookmark);
    if (hasBookmark) {
      const hasClearMethod = typeof bookmark!.clear === "function";
      if (hasClearMethod) {
        try {
          bookmark!.clear();
        } catch (err) {
          console.warn("Error clearing bookmark marker:", err);
        }
      }
      delete this.activeBookmarks[clientId];
    }
  }

  getActiveWidgetCount(): number {
    return Object.keys(this.activeWidgets).length;
  }

  getActiveBookmarkCount(): number {
    return Object.keys(this.activeBookmarks).length;
  }

  getWidget(clientId: string): FigmaCursorWidget | undefined {
    return this.activeWidgets[clientId];
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  dispose(): void {
    const isAlreadyDisposed = this.disposed;
    if (isAlreadyDisposed) return;

    this.disposed = true;
    const clientIds = Object.keys(this.activeBookmarks).concat(
      Object.keys(this.activeWidgets),
    );
    const uniqueIds = Array.from(new Set(clientIds));
    for (const id of uniqueIds) {
      this.clearCursor(id);
    }
    this.activeWidgets = {};
    this.activeBookmarks = {};
  }
}
