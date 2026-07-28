/**
 * Abstract synchronization adapter implementing common SyncSeam boilerplate.
 * Coordinates modular stream handlers well within all complexity guardrails.
 */
import { TextOperation } from "../core/index.ts";
import {
  SyncSeam,
  RefLike,
  SnapLike,
  CommitAck,
  AdapterCallbacks,
  isValidRef,
} from "./types.ts";
import { HistoryStreamHandler } from "./streams/history-stream.ts";
import { PresenceStreamHandler } from "./streams/presence-stream.ts";
import { AgentiveStreamHandler } from "./streams/agentive-stream.ts";

type EventCallback = (...args: any[]) => void;

export abstract class AbstractSyncAdapter implements SyncSeam {
  protected ref: RefLike | null = null;
  protected userId: string = "";
  protected userColor: string = "#000000";
  protected ready = false;
  protected disposed = false;
  protected listeners: Record<string, EventCallback[]> = {};
  public callbacks: AdapterCallbacks = {};

  protected historyHandler!: HistoryStreamHandler;
  protected presenceHandler!: PresenceStreamHandler;
  protected agentiveHandler!: AgentiveStreamHandler;

  protected setupStreams(
    ref: RefLike | null,
    prefix: string,
    color: string,
    customId?: string,
  ): void {
    this.ref = ref;
    const hasCustomId = Boolean(customId && customId.trim().length > 0);
    this.userId = hasCustomId
      ? customId!
      : prefix + "-" + Math.random().toString(36).substring(2, 6);
    this.userColor = color;

    this.historyHandler = new HistoryStreamHandler(this.ref, {
      onOperation: (op) => this.trigger("operation", op),
      onAck: () => this.trigger("ack"),
      onRetry: () => this.trigger("retry"),
      getUserId: () => this.userId,
      isReady: () => this.ready,
    });

    this.presenceHandler = new PresenceStreamHandler(
      this.ref,
      () => this.userId,
      () => this.userColor,
      (id, cursor, c) => this.trigger("cursor", id, cursor, c),
    );

    this.agentiveHandler = new AgentiveStreamHandler(this.ref);
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

  protected initializeConnection(): void {
    const refValid = isValidRef(this.ref);
    if (refValid) {
      queueMicrotask(() => {
        const isStillActive = !this.disposed;
        if (isStillActive) this.startDatabaseConnection();
      });
    } else {
      queueMicrotask(() => {
        const isStillActive = !this.disposed;
        if (isStillActive) {
          this.ready = true;
          this.trigger("ready");
        }
      });
    }
  }

  private startDatabaseConnection(): void {
    const isDisconnectedOrReady = this.disposed || this.ready;
    if (isDisconnectedOrReady) return;

    const hasRoot = Boolean(this.ref!.root);
    const connRef = hasRoot
      ? this.ref!.root!.child(".info/connected")
      : this.ref!.child(".info/connected");
    const hasOnMethod = Boolean(connRef && typeof connRef.on === "function");
    if (hasOnMethod) {
      connRef.on("value", (snap: SnapLike) =>
        this.handleConnectionChange(snap),
      );
    }
  }

  private handleConnectionChange(snap: SnapLike): void {
    const isStillPending = !this.disposed && !this.ready;
    const isConnected = snap.val() === true;
    const shouldInitialize = isStillPending && isConnected;
    if (!shouldInitialize) return;

    this.presenceHandler.startMonitoring();
    this.agentiveHandler.startMonitoring();
    this.ref!.child("history").once("value", (snapHistory: SnapLike) =>
      this.completeInitialHistorySync(snapHistory),
    );
    this.historyHandler.startMonitoring();
  }

  private completeInitialHistorySync(snapHistory: SnapLike): void {
    const canCompose = !this.disposed && !this.ready;
    if (canCompose) {
      this.historyHandler.composeInitialRevisions(snapHistory);
      this.ready = true;
      queueMicrotask(() => {
        this.trigger("ready");
        this.historyHandler.drainPendingRevisions();
      });
    }
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
    const reg = this.callbacks as Record<
      string,
      ((...a: unknown[]) => void) | undefined
    >;
    const handler = reg[event];
    if (typeof handler === "function") {
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
    this.historyHandler.sendOperation(
      operation,
      author || this.userId,
      callback,
    );
  }

  commitOperation(operation: unknown, author?: string): Promise<CommitAck> {
    return new Promise<CommitAck>((resolve, reject) => {
      this.executeCommitAttempt(
        operation as TextOperation,
        resolve,
        reject,
        author,
      );
    });
  }

  protected executeCommitAttempt(
    op: TextOperation,
    resolve: (ack: CommitAck) => void,
    reject: (err: Error) => void,
    author?: string,
  ): void {
    this.sendOperation(
      op,
      (err: Error | null, committed?: boolean) => {
        const isSuccessful = Boolean(committed);
        if (isSuccessful) {
          this.onCommitSuccess(author || this.userId);
          resolve({
            revision: this.historyHandler.getRevision(),
            committed: true,
          });
          return;
        }
        const hasError = Boolean(err);
        if (hasError) {
          reject(err!);
          return;
        }
        this.once("retry", () =>
          this.executeCommitAttempt(op, resolve, reject, author),
        );
      },
      author,
    );
  }

  protected onCommitSuccess(_author: string): void {}

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
    const isAlreadyDisposed = this.disposed;
    if (isAlreadyDisposed) return Promise.resolve();
    this.disposed = true;
    this.ready = false;
    this.callbacks = {};
    this.listeners = {};

    const refValid = isValidRef(this.ref);
    if (refValid) {
      try {
        const hasRoot = Boolean(this.ref!.root);
        const connRef = hasRoot
          ? this.ref!.root!.child(".info/connected")
          : this.ref!.child(".info/connected");
        connRef.off();
      } catch (err) {
        console.warn(
          "Unexpected error during adapter connection teardown:",
          err,
        );
      }
    }

    this.historyHandler?.dispose();
    this.presenceHandler?.dispose();
    this.agentiveHandler?.dispose();
    return Promise.resolve();
  }
}
