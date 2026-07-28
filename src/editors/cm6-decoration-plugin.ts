/**
 * CodeMirror 6 immutable ViewPlugin presence decoration coordinator.
 * Manages remote collaborator caret widgets and selection highlight ranges without mutating DOM buffers.
 */
import {
  CM6PluginSeam,
  CM6ViewLike,
  RemoteCursorData,
  CM6WidgetLike,
} from "./types.ts";
import { CM6PresenceWidget } from "./cm6-presence-widget.ts";

interface RangeSpec {
  from: number;
  to: number;
  clientId: string;
  isCaret: boolean;
  className?: string;
  widget?: CM6PresenceWidget;
}

export class CM6PresencePlugin implements CM6PluginSeam {
  private remoteWidgets: Record<string, CM6PresenceWidget> = {};
  private remoteRanges: Record<string, RangeSpec> = {};
  private disposed = false;

  constructor() {
    this.remoteWidgets = {};
    this.remoteRanges = {};
  }

  setOtherCursor(data: RemoteCursorData, view: CM6ViewLike): void {
    const isAlreadyDisposed = this.disposed;
    if (isAlreadyDisposed) return;

    const { cursor, color, clientId } = data;
    const isValidColor = typeof color === "string" && color.trim().length > 0;
    if (!isValidColor) return;

    const isValidCursor =
      typeof cursor === "object" &&
      cursor !== null &&
      typeof cursor.position === "number" &&
      typeof cursor.selectionEnd === "number";
    if (!isValidCursor) return;

    const docLength = this.getDocLength(view);
    const isOutOfBounds =
      cursor.position < 0 ||
      cursor.position > docLength ||
      cursor.selectionEnd < 0 ||
      cursor.selectionEnd > docLength;
    if (isOutOfBounds) return;

    this.clearCursor(clientId, view);

    const isCollapsed = cursor.position === cursor.selectionEnd;
    if (isCollapsed) {
      this.mountCaretDecoration(data);
    } else {
      this.mountSelectionDecoration(data);
    }

    this.notifyViewUpdate(view);
  }

  private getDocLength(view: CM6ViewLike): number {
    const hasStateDoc = Boolean(
      view &&
      view.state &&
      view.state.doc &&
      typeof view.state.doc.length === "number",
    );
    if (hasStateDoc) return view.state.doc.length;
    return Infinity;
  }

  private mountCaretDecoration(data: RemoteCursorData): void {
    const { cursor, color, clientId } = data;
    const pos = cursor.position;
    const widget = new CM6PresenceWidget(color, clientId, 21);
    this.remoteWidgets[clientId] = widget;

    const spec: RangeSpec = {
      from: pos,
      to: pos,
      clientId: clientId,
      isCaret: true,
      widget: widget,
    };
    this.remoteRanges[clientId] = spec;
  }

  private mountSelectionDecoration(data: RemoteCursorData): void {
    const { cursor, clientId } = data;
    const posA = cursor.position;
    const posB = cursor.selectionEnd;
    const isForward = posB > posA;
    const from = isForward ? posA : posB;
    const to = isForward ? posB : posA;

    const spec: RangeSpec = {
      from: from,
      to: to,
      clientId: clientId,
      isCaret: false,
      className: "cm-presence-selection",
    };
    this.remoteRanges[clientId] = spec;
  }

  private notifyViewUpdate(view?: CM6ViewLike): void {
    const hasDispatch = Boolean(view && typeof view.dispatch === "function");
    if (!hasDispatch) return;
    try {
      view!.dispatch({});
    } catch (err) {
      console.warn(
        "Unexpected error dispatching CM6 view decoration update:",
        err,
      );
    }
  }

  getDecorations(): Array<{
    from: number;
    to: number;
    widget?: CM6WidgetLike;
    className?: string;
    clientId: string;
  }> {
    const results: Array<{
      from: number;
      to: number;
      widget?: CM6WidgetLike;
      className?: string;
      clientId: string;
    }> = [];

    const keys = Object.keys(this.remoteRanges);
    for (const key of keys) {
      const item = this.remoteRanges[key];
      const hasItem = Boolean(item);
      if (!hasItem) continue;

      if (item.isCaret) {
        results.push({
          from: item.from,
          to: item.to,
          widget: item.widget,
          clientId: item.clientId,
        });
      } else {
        results.push({
          from: item.from,
          to: item.to,
          className: item.className,
          clientId: item.clientId,
        });
      }
    }
    return results;
  }

  clearCursor(clientId: string, view?: CM6ViewLike): void {
    const widget = this.remoteWidgets[clientId];
    const hasWidget = Boolean(widget);
    if (hasWidget) {
      widget.dispose();
      delete this.remoteWidgets[clientId];
    }
    const hasRange = Boolean(this.remoteRanges[clientId]);
    if (hasRange) {
      delete this.remoteRanges[clientId];
      this.notifyViewUpdate(view);
    }
  }

  getActiveWidgetCount(): number {
    return Object.keys(this.remoteWidgets).length;
  }

  getWidget(clientId: string): CM6PresenceWidget | undefined {
    return this.remoteWidgets[clientId];
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  dispose(): void {
    const isAlreadyDisposed = this.disposed;
    if (isAlreadyDisposed) return;
    this.disposed = true;

    const clientIds = Object.keys(this.remoteRanges).concat(
      Object.keys(this.remoteWidgets),
    );
    const uniqueIds = Array.from(new Set(clientIds));
    for (const id of uniqueIds) {
      this.clearCursor(id);
    }
    this.remoteWidgets = {};
    this.remoteRanges = {};
  }
}
