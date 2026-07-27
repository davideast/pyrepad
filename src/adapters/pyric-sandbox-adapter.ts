/**
 * Pyric Sandbox collaborative editing adapter implementing SyncSeam.
 */
import { TextOperation } from "../core/index.ts";
import {
  SyncSeam,
  RefLike,
  SnapLike,
  CommitAck,
  AdapterCallbacks,
} from "./types.ts";
import { HistoryStreamHandler } from "./streams/history-stream.ts";
import { PresenceStreamHandler } from "./streams/presence-stream.ts";
import { AgentiveStreamHandler } from "./streams/agentive-stream.ts";

type EventCallback = (...args: any[]) => void;

export class PyricSandboxAdapter implements SyncSeam {
  private ref: RefLike | null;
  private userId: string;
  private userColor: string;
  private ready = false;
  private disposed = false;
  private listeners: Record<string, EventCallback[]> = {};
  public callbacks: AdapterCallbacks = {};

  private historyHandler: HistoryStreamHandler;
  private presenceHandler: PresenceStreamHandler;
  private agentiveHandler: AgentiveStreamHandler;

  constructor(ref: RefLike | null, userId?: string, userColor?: string) {
    this.ref = ref;
    this.userId =
      userId || "sandbox-" + Math.random().toString(36).substring(2, 6);
    this.userColor = userColor || "#0000ff";

    this.historyHandler = new HistoryStreamHandler(this.ref, {
      onOperation: (op) => this.trigger("operation", op),
      onAck: () => {
        this.trigger("ack");
      },
      onRetry: () => {
        this.trigger("retry");
      },
      getUserId: () => this.userId,
      isReady: () => this.ready,
    });

    this.presenceHandler = new PresenceStreamHandler(
      this.ref,
      () => this.userId,
      () => this.userColor,
      (id, cursor, color) => this.trigger("cursor", id, cursor, color),
    );

    this.agentiveHandler = new AgentiveStreamHandler(this.ref);

    this.initializeConnection();
  }

  get operations() {
    return this.historyHandler.stream;
  }
  get presence() {
    return this.presenceHandler.stream;
  }
  get agentive() {
    return this.agentiveHandler.stream;
  }

  private initializeConnection(): void {
    const hasChildMethod =
      this.ref !== null && typeof this.ref.child === "function";
    if (hasChildMethod) {
      setTimeout(() => {
        const isStillActive = !this.disposed;
        if (isStillActive) this.startDatabaseConnection();
      }, 0);
    } else {
      setTimeout(() => {
        const isStillActive = !this.disposed;
        if (isStillActive) {
          this.ready = true;
          this.trigger("ready");
        }
      }, 0);
    }
  }

  private startDatabaseConnection(): void {
    const isDisconnectedOrReady = this.disposed || this.ready;
    if (isDisconnectedOrReady) return;

    const connRef = this.ref!.root
      ? this.ref!.root.child(".info/connected")
      : this.ref!.child(".info/connected");
    connRef.on("value", (snap: SnapLike) => {
      const isStillPending = !this.disposed && !this.ready;
      const isConnected = snap.val() === true;
      if (isStillPending && isConnected) {
        this.presenceHandler.startMonitoring();
        this.agentiveHandler.startMonitoring();
        this.ref!.child("history").once("value", (historySnap: SnapLike) => {
          const canCompose = !this.disposed && !this.ready;
          if (canCompose) {
            this.historyHandler.composeInitialRevisions(historySnap);
            this.markReadyAndDrain();
          }
        });
        this.historyHandler.startMonitoring();
      }
    });
  }

  private markReadyAndDrain(): void {
    this.ready = true;
    setTimeout(() => {
      this.trigger("ready");
      this.historyHandler.drainPendingRevisions();
    }, 0);
  }

  on(event: string, callback: EventCallback): void {
    const isNewEvent = !this.listeners[event];
    if (isNewEvent) this.listeners[event] = [];
    this.listeners[event].push(callback);
  }

  once(event: string, callback: EventCallback): void {
    const onceWrapper: EventCallback = (...args: unknown[]) => {
      this.off(event, onceWrapper);
      callback(...args);
    };
    this.on(event, onceWrapper);
  }

  off(event: string, callback?: EventCallback): void {
    const hasEvent = Boolean(this.listeners[event]);
    if (!hasEvent) return;
    if (!callback) {
      delete this.listeners[event];
    } else {
      this.listeners[event] = this.listeners[event].filter(
        (cb) => cb !== callback,
      );
    }
  }

  trigger(event: string, ...args: unknown[]): void {
    const callbacks = this.listeners[event];
    const hasListeners = Boolean(callbacks && callbacks.length > 0);
    if (hasListeners) {
      for (const cb of [...callbacks]) {
        cb(...args);
      }
    }
    const registered = this.callbacks as Record<
      string,
      ((...a: unknown[]) => void) | undefined
    >;
    const handler = registered[event];
    const hasRegisteredHandler = typeof handler === "function";
    if (hasRegisteredHandler) {
      handler!(...args);
    }
  }

  registerCallbacks(callbacks: AdapterCallbacks): void {
    this.callbacks = callbacks || {};
  }

  sendOperation(
    operation: TextOperation,
    callback?: (err: Error | null, committed?: boolean) => void,
    author?: string,
  ): void {
    const isNotReady = !this.ready;
    if (isNotReady) {
      this.once("ready", () => this.sendOperation(operation, callback, author));
      return;
    }
    const actualAuthor = author || this.userId;
    this.historyHandler.sendOperation(operation, actualAuthor, callback);
  }

  commitOperation(operation: unknown, author?: string): Promise<CommitAck> {
    return new Promise((resolve, reject) => {
      const tryCommit = (op: unknown) => {
        this.sendOperation(
          op as TextOperation,
          (err: Error | null, committed?: boolean) => {
            if (committed) {
              resolve({
                revision: this.historyHandler.getRevision(),
                committed: true,
              });
            } else if (err) {
              reject(err);
            } else {
              this.once("retry", () => tryCommit(op));
            }
          },
          author,
        );
      };
      tryCommit(operation);
    });
  }

  sendCursor(cursor: unknown): void {
    this.presenceHandler.broadcastPresence(cursor);
  }

  broadcastPresence(cursor: unknown): Promise<void> {
    return this.presenceHandler.broadcastPresence(cursor);
  }

  broadcastAgentive(
    agentId: string,
    status: string,
    ghostDiff?: unknown,
    explanation?: string,
  ): Promise<void> {
    return this.agentiveHandler.broadcastAgentive(
      agentId,
      status,
      ghostDiff,
      explanation,
    );
  }

  isHistoryEmpty(): boolean {
    const isNotReady = !this.ready;
    if (isNotReady) throw new Error("not ready");
    return this.historyHandler.getRevision() === 0;
  }

  setColor(color: string): void {
    this.userColor = color;
  }
  setUserId(id: string): void {
    this.userId = id;
  }

  dispose(): Promise<void> {
    this.disposed = true;
    this.ready = false;
    this.callbacks = {};
    this.listeners = {};

    if (this.ref && typeof this.ref.child === "function") {
      try {
        const connRef = this.ref.root
          ? this.ref.root.child(".info/connected")
          : this.ref.child(".info/connected");
        connRef.off();
      } catch (err) {
        console.warn(
          "Unexpected error during adapter connection teardown:",
          err,
        );
      }
    }

    this.historyHandler.dispose();
    this.presenceHandler.dispose();
    this.agentiveHandler.dispose();

    return Promise.resolve();
  }
}
