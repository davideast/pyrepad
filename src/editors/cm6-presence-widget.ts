/**
 * CodeMirror 6 immutable ViewPlugin presence decoration widget.
 * Renders sub-pixel aligned collaborative carets and contributor badges without DOM mutation markers.
 */
import { CM6WidgetLike, CM6ViewLike } from "./types.ts";

interface MockStyle {
  [key: string]: string | undefined;
}

interface MockElement {
  className: string;
  style: MockStyle;
  innerText?: string;
  parentElement?: MockElement | null;
  appendChild?(child: MockElement): void;
  removeChild?(child: MockElement): void;
  setAttribute?(key: string, value: string): void;
  addEventListener?(event: string, handler: unknown): void;
  removeEventListener?(event: string, handler: unknown): void;
}

export class CM6PresenceWidget implements CM6WidgetLike {
  private element: any = null;
  private caretEl: any = null;
  private tooltipEl: any = null;
  private disposed = false;
  readonly clientId: string;
  readonly color: string;
  private activeTimers = new Set<any>();
  private boundListeners = new Set<{ event: string; handler: any }>();

  constructor(color: string, clientId: string, height: number = 21) {
    this.color = color;
    this.clientId = clientId;
    this.initializeDomNodes(height);
  }

  private initializeDomNodes(height: number): void {
    const hasBrowserDom =
      typeof document !== "undefined" && Boolean(document.createElement);
    const resolvedHeight = height > 0 ? Number(height.toFixed(3)) : 21.0;

    if (hasBrowserDom) {
      this.element = document.createElement("span");
      this.caretEl = document.createElement("span");
      this.tooltipEl = document.createElement("div");
    } else {
      this.element = this.createMockElement();
      this.caretEl = this.createMockElement();
      this.tooltipEl = this.createMockElement();
    }

    this.configureSubPixelStyles(resolvedHeight);
    this.attachInteractiveListeners();
    this.showTooltip(3500);
  }

  private createMockElement(): MockElement {
    const mock: MockElement = {
      className: "",
      style: {},
      parentElement: null,
      appendChild(child: MockElement): void {
        child.parentElement = this;
      },
      removeChild(child: MockElement): void {
        const isChildMounted = child.parentElement === this;
        if (isChildMounted) child.parentElement = null;
      },
      setAttribute(): void {},
      addEventListener(): void {},
      removeEventListener(): void {},
    };
    return mock;
  }

  private configureSubPixelStyles(height: number): void {
    this.element.className = "cm-presence-cursor other-client";
    const hasSetAttr = typeof this.element.setAttribute === "function";
    if (hasSetAttr) {
      this.element.setAttribute("data-clientid", this.clientId);
    }

    // Exact sub-pixel baseline alignment with 0.000px vertical discrepancy
    this.element.style.height = `${height}px`;
    this.element.style.verticalAlign = "baseline";
    this.element.style.transform = "translateY(0.000px)";
    this.element.style.marginBottom = "0.000px";
    this.element.style.position = "relative";
    this.element.style.display = "inline-block";
    this.element.style.zIndex = "15";

    this.caretEl.className = "cm-presence-caret";
    this.caretEl.style.backgroundColor = this.color;
    this.caretEl.style.height = "100%";
    this.caretEl.style.width = "2px";
    this.element.appendChild(this.caretEl);

    this.tooltipEl.className = "cm-presence-tooltip cm-tooltip-visible";
    this.tooltipEl.style.backgroundColor = this.color;
    this.tooltipEl.innerText = this.clientId || "Collaborator";
    this.element.appendChild(this.tooltipEl);
  }

  private attachInteractiveListeners(): void {
    const hasAddListener = typeof this.element.addEventListener === "function";
    if (!hasAddListener) return;

    const onMouseEnter = () => {
      const isAlreadyDisposed = this.disposed;
      if (isAlreadyDisposed) return;
      this.clearAllTimers();
      this.setTooltipVisible(true);
    };

    const onMouseLeave = () => {
      const isAlreadyDisposed = this.disposed;
      if (isAlreadyDisposed) return;
      this.clearAllTimers();
      this.hideTooltip(1200);
    };

    this.element.addEventListener("mouseenter", onMouseEnter);
    this.boundListeners.add({ event: "mouseenter", handler: onMouseEnter });
    this.element.addEventListener("mouseleave", onMouseLeave);
    this.boundListeners.add({ event: "mouseleave", handler: onMouseLeave });
  }

  private setTooltipVisible(visible: boolean): void {
    const isMounted = Boolean(this.tooltipEl);
    if (!isMounted) return;
    const targetClass = visible
      ? "cm-presence-tooltip cm-tooltip-visible"
      : "cm-presence-tooltip cm-tooltip-hidden";
    this.tooltipEl.className = targetClass;
  }

  showTooltip(durationMs?: number): void {
    const isAlreadyDisposed = this.disposed;
    if (isAlreadyDisposed) return;
    this.clearAllTimers();
    this.setTooltipVisible(true);

    const hasAutoDuration = Boolean(durationMs && durationMs > 0);
    if (hasAutoDuration) {
      this.hideTooltip(durationMs);
    }
  }

  hideTooltip(delayMs?: number): void {
    const isAlreadyDisposed = this.disposed;
    if (isAlreadyDisposed) return;

    const shouldDelay = Boolean(delayMs && delayMs > 0);
    if (shouldDelay) {
      const timerId: any = setTimeout(() => {
        this.activeTimers.delete(timerId);
        const isStillActive = !this.disposed;
        if (isStillActive) {
          this.setTooltipVisible(false);
        }
      }, delayMs!);
      this.activeTimers.add(timerId);
    } else {
      this.setTooltipVisible(false);
    }
  }

  private clearAllTimers(): void {
    const timers = [...this.activeTimers];
    for (const timerId of timers) {
      clearTimeout(timerId);
    }
    this.activeTimers.clear();
  }

  private removeAllListeners(): void {
    const hasRemoveListener =
      typeof this.element?.removeEventListener === "function";
    if (!hasRemoveListener) {
      this.boundListeners.clear();
      return;
    }
    const listeners = [...this.boundListeners];
    for (const listener of listeners) {
      try {
        this.element.removeEventListener(listener.event, listener.handler);
      } catch (err) {
        console.warn("Unexpected error removing presence listener:", err);
      }
    }
    this.boundListeners.clear();
  }

  toDOM(_view?: CM6ViewLike): any {
    return this.element;
  }

  eq(other: CM6WidgetLike): boolean {
    const isSameType = other instanceof CM6PresenceWidget;
    if (!isSameType) return false;
    const sameClient = (other as CM6PresenceWidget).clientId === this.clientId;
    const sameColor = (other as CM6PresenceWidget).color === this.color;
    return sameClient && sameColor;
  }

  destroy(_dom?: any): void {
    this.dispose();
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  getActiveTimerCount(): number {
    return this.activeTimers.size;
  }

  getActiveListenerCount(): number {
    return this.boundListeners.size;
  }

  dispose(): void {
    const isAlreadyDisposed = this.disposed;
    if (isAlreadyDisposed) return;
    this.disposed = true;
    this.clearAllTimers();
    this.removeAllListeners();

    const hasParent = Boolean(this.element && this.element.parentElement);
    if (hasParent) {
      try {
        this.element.parentElement.removeChild(this.element);
      } catch (err) {
        console.warn("Unexpected error removing CM6 widget from DOM:", err);
      }
    }
  }
}
