/**
 * Shared DOM, tooltip-timer and listener lifecycle for remote presence caret
 * widgets. The CM5 widget extends it; the CM6 widget composes it (it must
 * extend CM6's WidgetType).
 */

interface FallbackStyle {
  [key: string]: string | undefined;
}

interface FallbackElement {
  className: string;
  style: FallbackStyle;
  innerText?: string;
  parentElement?: FallbackElement | null;
  appendChild?(child: FallbackElement): void;
  removeChild?(child: FallbackElement): void;
  setAttribute?(key: string, value: string): void;
  addEventListener?(event: string, handler: unknown): void;
  removeEventListener?(event: string, handler: unknown): void;
}

export interface PresenceWidgetClassNames {
  root: string;
  caret: string;
  tooltip: string;
  tooltipVisible: string;
  tooltipHidden: string;
}

const INITIAL_TOOLTIP_MS = 3500;
const HOVER_HIDE_DELAY_MS = 1200;

export class PresenceWidgetBase {
  protected element: any;
  protected caretEl: any;
  protected tooltipEl: any;
  protected disposed = false;
  protected clientId: string;
  protected color: string;
  private readonly classNames: PresenceWidgetClassNames;
  private activeTimers = new Set<any>();
  private boundListeners = new Set<{ event: string; handler: any }>();

  constructor(
    color: string,
    clientId: string,
    height: number,
    classNames: PresenceWidgetClassNames,
  ) {
    this.color = color;
    this.clientId = clientId;
    this.classNames = classNames;
    this.createDomElements(height);
    this.attachEventListeners();
    this.showTooltip(INITIAL_TOOLTIP_MS);
  }

  private createDomElements(height: number): void {
    const hasBrowserDom =
      typeof document !== "undefined" && Boolean(document.createElement);
    const resolvedHeight = height > 0 ? Number(height.toFixed(3)) : 21.0;

    if (hasBrowserDom) {
      this.element = document.createElement("span");
      this.caretEl = document.createElement("span");
      this.tooltipEl = document.createElement("div");
    } else {
      this.element = this.createFallbackElement();
      this.caretEl = this.createFallbackElement();
      this.tooltipEl = this.createFallbackElement();
    }

    this.configureElementStyles(resolvedHeight);
  }

  private createFallbackElement(): FallbackElement {
    const fallback: FallbackElement = {
      className: "",
      style: {},
      parentElement: null,
      appendChild(child: FallbackElement): void {
        child.parentElement = this;
      },
      removeChild(child: FallbackElement): void {
        const isChildMounted = child.parentElement === this;
        if (isChildMounted) child.parentElement = null;
      },
      setAttribute(): void {},
      addEventListener(): void {},
      removeEventListener(): void {},
    };
    return fallback;
  }

  private configureElementStyles(height: number): void {
    this.element.className = this.classNames.root;
    const hasSetAttr = typeof this.element.setAttribute === "function";
    if (hasSetAttr) {
      this.element.setAttribute("data-clientid", this.clientId);
    }

    // Sit on the text baseline with no vertical offset.
    this.element.style.height = `${height}px`;
    this.element.style.verticalAlign = "baseline";
    this.element.style.transform = "translateY(0.000px)";
    this.element.style.marginBottom = "0.000px";
    this.element.style.position = "relative";
    this.element.style.display = "inline-block";
    this.element.style.zIndex = "15";

    this.caretEl.className = this.classNames.caret;
    this.caretEl.style.backgroundColor = this.color;
    this.caretEl.style.height = "100%";
    this.caretEl.style.width = "2px";
    this.element.appendChild(this.caretEl);

    this.tooltipEl.style.backgroundColor = this.color;
    this.tooltipEl.innerText = this.clientId || "Collaborator";
    this.setTooltipVisible(true);
    this.element.appendChild(this.tooltipEl);
  }

  private attachEventListeners(): void {
    const hasAddListener = typeof this.element.addEventListener === "function";
    if (!hasAddListener) return;

    const onMouseEnter = () => {
      if (this.disposed) return;
      this.clearAllTimers();
      this.setTooltipVisible(true);
    };

    const onMouseLeave = () => {
      if (this.disposed) return;
      this.clearAllTimers();
      this.hideTooltip(HOVER_HIDE_DELAY_MS);
    };

    this.element.addEventListener("mouseenter", onMouseEnter);
    this.boundListeners.add({ event: "mouseenter", handler: onMouseEnter });
    this.element.addEventListener("mouseleave", onMouseLeave);
    this.boundListeners.add({ event: "mouseleave", handler: onMouseLeave });
  }

  private setTooltipVisible(visible: boolean): void {
    const isMounted = Boolean(this.tooltipEl);
    if (!isMounted) return;
    const stateClass = visible
      ? this.classNames.tooltipVisible
      : this.classNames.tooltipHidden;
    this.tooltipEl.className = `${this.classNames.tooltip} ${stateClass}`;
  }

  getElement(): any {
    return this.element;
  }

  updateColor(color: string): void {
    this.color = color;
    this.caretEl.style.backgroundColor = color;
    this.tooltipEl.style.backgroundColor = color;
  }

  updateTooltip(text: string): void {
    this.clientId = text;
    this.tooltipEl.innerText = text;
    const hasSetAttr = typeof this.element.setAttribute === "function";
    if (hasSetAttr) {
      this.element.setAttribute("data-clientid", text);
    }
  }

  getVerticalDiscrepancy(): number {
    return 0.0;
  }

  showTooltip(durationMs?: number): void {
    if (this.disposed) return;
    this.clearAllTimers();
    this.setTooltipVisible(true);

    const hasAutoDuration = Boolean(durationMs && durationMs > 0);
    if (hasAutoDuration) {
      this.hideTooltip(durationMs);
    }
  }

  hideTooltip(delayMs?: number): void {
    if (this.disposed) return;

    const shouldDelay = Boolean(delayMs && delayMs > 0);
    if (!shouldDelay) {
      this.setTooltipVisible(false);
      return;
    }
    const timerId: any = setTimeout(() => {
      this.activeTimers.delete(timerId);
      if (!this.disposed) this.setTooltipVisible(false);
    }, delayMs!);
    this.activeTimers.add(timerId);
  }

  private clearAllTimers(): void {
    for (const timerId of this.activeTimers) {
      clearTimeout(timerId);
    }
    this.activeTimers.clear();
  }

  private removeAllListeners(): void {
    const hasRemoveListener =
      typeof this.element?.removeEventListener === "function";
    if (hasRemoveListener) {
      for (const listener of this.boundListeners) {
        try {
          this.element.removeEventListener(listener.event, listener.handler);
        } catch (err) {
          console.warn("Unexpected error removing presence listener:", err);
        }
      }
    }
    this.boundListeners.clear();
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
    if (this.disposed) return;
    this.disposed = true;
    this.clearAllTimers();
    this.removeAllListeners();

    const hasParent = Boolean(this.element && this.element.parentElement);
    if (hasParent) {
      try {
        this.element.parentElement.removeChild(this.element);
      } catch (err) {
        console.warn(
          "Unexpected error removing presence widget from DOM:",
          err,
        );
      }
    }
  }
}
