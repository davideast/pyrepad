/**
 * CodeMirror 6 remote presence caret widget, rendered through a
 * `Decoration.widget` by the presence ViewPlugin.
 */
import { WidgetType } from "@codemirror/view";
import { CM6WidgetLike } from "./types.ts";
import { PresenceWidgetBase } from "./presence-widget-base.ts";

export class CM6PresenceWidget extends WidgetType implements CM6WidgetLike {
  readonly clientId: string;
  readonly color: string;
  private readonly base: PresenceWidgetBase;

  constructor(color: string, clientId: string, height: number = 21) {
    super();
    this.color = color;
    this.clientId = clientId;
    this.base = new PresenceWidgetBase(color, clientId, height, {
      root: "cm-presence-cursor other-client",
      caret: "cm-presence-caret",
      tooltip: "cm-presence-tooltip",
      tooltipVisible: "cm-tooltip-visible",
      tooltipHidden: "cm-tooltip-hidden",
    });
  }

  toDOM(): HTMLElement {
    return this.base.getElement();
  }

  // Each instance owns one DOM element (toDOM always returns it), so two
  // instances can never share DOM: equality is identity.
  eq(other: WidgetType): boolean {
    return other === this;
  }

  // CM6 calls destroy() whenever it drops this widget's DOM (including when it
  // re-renders the widget elsewhere), so it must not end the widget's life.
  // CM6PresencePlugin owns disposal via dispose().
  destroy(): void {}

  showTooltip(durationMs?: number): void {
    this.base.showTooltip(durationMs);
  }

  hideTooltip(delayMs?: number): void {
    this.base.hideTooltip(delayMs);
  }

  isDisposed(): boolean {
    return this.base.isDisposed();
  }

  getActiveTimerCount(): number {
    return this.base.getActiveTimerCount();
  }

  getActiveListenerCount(): number {
    return this.base.getActiveListenerCount();
  }

  dispose(): void {
    this.base.dispose();
  }
}
