/**
 * CodeMirror 6 remote presence decorations. `extension` is a ViewPlugin that
 * provides the `decorations` facet; setOtherCursor/clearCursor update the
 * ranges and dispatch a refresh effect so the view re-renders them.
 */
import {
  StateEffect,
  type ChangeDesc,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import { CM6PluginSeam, PresenceState, CM6WidgetLike } from "./types.js";
import { CM6PresenceWidget } from "./cm6-presence-widget.js";

interface RangeSpec {
  from: number;
  to: number;
  clientId: string;
  isCaret: boolean;
  className?: string;
  color?: string;
  widget?: CM6PresenceWidget;
}

const presenceRefresh = StateEffect.define<null>();

export class CM6PresencePlugin implements CM6PluginSeam {
  readonly extension: Extension;
  private remoteWidgets: Record<string, CM6PresenceWidget> = {};
  private remoteRanges: Record<string, RangeSpec> = {};
  private disposed = false;

  constructor() {
    const owner = this;
    this.extension = ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor() {
          this.decorations = owner.buildDecorations();
        }
        update(update: ViewUpdate) {
          if (update.docChanged) owner.mapRanges(update.changes);
          const isRefresh = update.transactions.some((tr) =>
            tr.effects.some((e) => e.is(presenceRefresh)),
          );
          if (update.docChanged || isRefresh) {
            this.decorations = owner.buildDecorations();
          }
        }
      },
      { decorations: (plugin) => plugin.decorations },
    );
  }

  setOtherCursor(data: PresenceState, view: EditorView): void {
    if (this.disposed) return;

    const { cursor, color, clientId } = data;
    const isValidColor = typeof color === "string" && color.trim().length > 0;
    if (!isValidColor) return;

    const isValidCursor =
      typeof cursor === "object" &&
      cursor !== null &&
      typeof cursor.position === "number" &&
      typeof cursor.selectionEnd === "number";
    if (!isValidCursor) return;

    const docLength = view.state.doc.length;
    const isOutOfBounds =
      cursor.position < 0 ||
      cursor.position > docLength ||
      cursor.selectionEnd < 0 ||
      cursor.selectionEnd > docLength;
    if (isOutOfBounds) return;

    const previous = this.remoteWidgets[clientId];
    delete this.remoteWidgets[clientId];

    const isCollapsed = cursor.position === cursor.selectionEnd;
    if (isCollapsed) {
      this.mountCaretDecoration(data);
    } else {
      this.mountSelectionDecoration(data);
    }

    this.notifyViewUpdate(view);
    // Dispose only after the view has dropped the old widget's DOM.
    previous?.dispose();
  }

  private mountCaretDecoration(data: PresenceState): void {
    const { cursor, color, clientId } = data;
    const pos = cursor.position;
    const widget = new CM6PresenceWidget(color, clientId, 21);
    if (data.name) widget.updateTooltip(data.name);
    this.remoteWidgets[clientId] = widget;
    this.remoteRanges[clientId] = {
      from: pos,
      to: pos,
      clientId,
      isCaret: true,
      widget,
    };
  }

  private mountSelectionDecoration(data: PresenceState): void {
    const { cursor, clientId } = data;
    const from = Math.min(cursor.position, cursor.selectionEnd);
    const to = Math.max(cursor.position, cursor.selectionEnd);
    this.remoteRanges[clientId] = {
      from,
      to,
      clientId,
      isCaret: false,
      className: "cm-presence-selection",
      color: data.color,
    };
  }

  private mapRanges(changes: ChangeDesc): void {
    for (const range of Object.values(this.remoteRanges)) {
      range.from = changes.mapPos(range.from);
      range.to = range.isCaret ? range.from : changes.mapPos(range.to);
    }
  }

  private buildDecorations(): DecorationSet {
    const ranges = Object.values(this.remoteRanges)
      .filter((item) => item.isCaret || item.to > item.from)
      .map((item) =>
        item.isCaret
          ? Decoration.widget({ widget: item.widget!, side: 1 }).range(
              item.from,
            )
          : Decoration.mark({
              class: item.className,
              attributes: {
                "data-clientid": item.clientId,
                ...(item.color && /^#[0-9a-f]{6}$/i.test(item.color)
                  ? { style: `background-color: ${item.color}40` }
                  : {}),
              },
            }).range(item.from, item.to),
      );
    return Decoration.set(ranges, true);
  }

  private notifyViewUpdate(view?: EditorView): void {
    if (!view) return;
    try {
      view.dispatch({ effects: presenceRefresh.of(null) });
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
    return Object.values(this.remoteRanges).map((item) =>
      item.isCaret
        ? {
            from: item.from,
            to: item.to,
            widget: item.widget,
            clientId: item.clientId,
          }
        : {
            from: item.from,
            to: item.to,
            className: item.className,
            clientId: item.clientId,
          },
    );
  }

  clearCursor(clientId: string, view?: EditorView): void {
    const widget = this.remoteWidgets[clientId];
    delete this.remoteWidgets[clientId];
    const hasRange = Boolean(this.remoteRanges[clientId]);
    if (hasRange) {
      delete this.remoteRanges[clientId];
      this.notifyViewUpdate(view);
    }
    // Dispose only after the view has dropped the widget's DOM.
    widget?.dispose();
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
    if (this.disposed) return;
    this.disposed = true;
    for (const widget of Object.values(this.remoteWidgets)) {
      widget.dispose();
    }
    this.remoteWidgets = {};
    this.remoteRanges = {};
  }
}
