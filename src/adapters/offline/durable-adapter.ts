/**
 * Offline durable collaborative adapter decorator implementing SyncSeam.
 * Protects un-transmitted edits with IndexedDB buffering, automatic recovery triggers,
 * and multi-revision Operational Transform rebase and rollback resolution.
 */
import { TextOperation } from "../../core/index.ts";
import {
  SyncSeam,
  CommitAck,
  AdapterCallbacks,
  TextOperationEvent,
  PresenceEvent,
  AgentivePresenceEvent,
} from "../types.ts";
import { StorageEngineSeam, IndexedDBStorageEngine } from "./storage-engine.ts";
import {
  OfflineRevisionQueue,
  PendingRevisionRecord,
} from "./revision-queue.ts";

type EventCallback = (...args: any[]) => void;

export class OfflineDurableAdapter implements SyncSeam {
  readonly network: SyncSeam;
  readonly queue: OfflineRevisionQueue;
  private disposed = false;
  private currentRevision = 0;
  private onlineHandler: (() => void) | null = null;
  public callbacks: AdapterCallbacks = {};

  constructor(
    network: SyncSeam,
    storage?: StorageEngineSeam,
    docId: string = "default_doc",
  ) {
    this.network = network;
    const engine = storage || new IndexedDBStorageEngine();
    this.queue = new OfflineRevisionQueue(docId, engine);
    this.bindNetworkEvents();
    this.bindGlobalOnlineTrigger();
  }

  private bindNetworkEvents(): void {
    const hasOnMethod = typeof (this.network as any).on === "function";
    if (!hasOnMethod) return;

    (this.network as any).on("operation", (_op: any) => {
      this.currentRevision++;
    });

    const triggerReconcile = () => {
      const isActive = !this.disposed;
      if (isActive) {
        this.reconcile().catch((err) =>
          console.warn(
            "Unexpected error during automatic network reconcile:",
            err,
          ),
        );
      }
    };

    (this.network as any).on("ready", triggerReconcile);
    (this.network as any).on("reconnected", triggerReconcile);
    (this.network as any).on("worker_sync", triggerReconcile);
  }

  private bindGlobalOnlineTrigger(): void {
    const hasAddListener =
      typeof globalThis !== "undefined" &&
      typeof (globalThis as any).addEventListener === "function";
    if (!hasAddListener) return;

    this.onlineHandler = () => {
      const isActive = !this.disposed;
      if (isActive) {
        this.reconcile().catch((err) =>
          console.warn("Unexpected error during global online reconcile:", err),
        );
      }
    };
    (globalThis as any).addEventListener("online", this.onlineHandler);
  }

  get operations(): AsyncIterable<TextOperationEvent> {
    return this.network.operations;
  }
  get presence(): AsyncIterable<PresenceEvent> {
    return this.network.presence;
  }
  get agentive(): AsyncIterable<AgentivePresenceEvent> {
    return this.network.agentive;
  }

  async commitOperation(
    operation: unknown,
    author?: string,
  ): Promise<CommitAck> {
    const isDisposed = this.disposed;
    if (isDisposed) throw new Error("OfflineDurableAdapter is disposed");

    const opAuthor = author || "offline-client";
    const recordId = await this.queue.enqueue(
      this.currentRevision,
      operation,
      opAuthor,
    );

    try {
      const ack = await this.network.commitOperation(operation, opAuthor);
      const isCommitted = Boolean(ack && ack.committed);
      if (isCommitted) {
        await this.queue.dequeue(recordId);
        this.currentRevision = ack.revision;
        return ack;
      }
      return { revision: this.currentRevision, committed: false };
    } catch (_networkError) {
      // Network offline disconnect or transit drop; operation remains safely buffered in IndexedDB
      return { revision: this.currentRevision, committed: false };
    }
  }

  async reconcile(canonicalRemoteOps?: unknown[]): Promise<number> {
    const isDisposed = this.disposed;
    if (isDisposed) return 0;

    const pending = await this.queue.getPendingRevisions();
    const hasNoPending = pending.length === 0;
    if (hasNoPending) return 0;

    let reconciledCount = 0;
    const remotes: TextOperation[] = [];

    if (canonicalRemoteOps && canonicalRemoteOps.length > 0) {
      for (const raw of canonicalRemoteOps) {
        const parsed = this.parseTextOp(raw);
        const isValidRemote = Boolean(parsed);
        if (isValidRemote) remotes.push(parsed!);
      }
    }

    for (const item of pending) {
      const success = await this.reconcileRecord(item, remotes);
      if (success) {
        reconciledCount++;
      }
    }

    return reconciledCount;
  }

  private async reconcileRecord(
    item: PendingRevisionRecord,
    remotes: TextOperation[],
  ): Promise<boolean> {
    let localOp = this.parseTextOp(item.operationJSON);
    const hasRemotes = remotes.length > 0;
    const canTransform = hasRemotes && Boolean(localOp);

    if (canTransform) {
      for (let i = 0; i < remotes.length; i++) {
        try {
          const transformed = TextOperation.transform(localOp!, remotes[i]);
          localOp = transformed[0];
          remotes[i] = transformed[1];
        } catch (err) {
          console.warn(
            "Unresolvable OT conflict during reconcile; performing state rollback:",
            err,
          );
          await this.queue.dequeue(item.id);
          return false;
        }
      }
    }

    const opToSubmit = localOp || item.operationJSON;
    try {
      const ack = await this.network.commitOperation(opToSubmit, item.author);
      const isCommitted = Boolean(ack && ack.committed);
      if (isCommitted) {
        await this.queue.dequeue(item.id);
        this.currentRevision = ack.revision;
        return true;
      }
      return false;
    } catch (err) {
      console.warn("Network error during offline revision replay:", err);
      return false;
    }
  }

  private parseTextOp(payload: unknown): TextOperation | null {
    const isAlreadyOp = payload instanceof TextOperation;
    if (isAlreadyOp) return payload as TextOperation;
    const isObject = typeof payload === "object" && payload !== null;
    if (!isObject) return null;
    const hasFromJSON = typeof (TextOperation as any).fromJSON === "function";
    if (hasFromJSON) {
      try {
        return (TextOperation as any).fromJSON(payload);
      } catch (_e) {
        return null;
      }
    }
    return null;
  }

  private delegateToNetwork(method: string, ...args: unknown[]): unknown {
    const fn = (this.network as any)[method];
    const isCallable = typeof fn === "function";
    if (isCallable) {
      return fn.apply(this.network, args);
    }
    return undefined;
  }

  broadcastPresence(cursor: unknown): Promise<void> {
    return this.network.broadcastPresence(cursor);
  }

  broadcastAgentive(
    agentId: string,
    status: string,
    ghostDiff?: unknown,
    exp?: string,
  ): Promise<void> {
    return this.network.broadcastAgentive(agentId, status, ghostDiff, exp);
  }

  on(event: string, callback: EventCallback): void {
    this.delegateToNetwork("on", event, callback);
  }
  once(event: string, callback: EventCallback): void {
    this.delegateToNetwork("once", event, callback);
  }
  off(event: string, callback?: EventCallback): void {
    this.delegateToNetwork("off", event, callback);
  }
  trigger(event: string, ...args: unknown[]): void {
    this.delegateToNetwork("trigger", event, ...args);
  }

  registerCallbacks(callbacks: AdapterCallbacks): void {
    this.callbacks = callbacks || {};
    this.delegateToNetwork("registerCallbacks", callbacks);
  }

  sendOperation(
    op: TextOperation,
    cb?: (err: Error | null, committed?: boolean) => void,
    author?: string,
  ): void {
    this.commitOperation(op, author)
      .then((ack) => {
        const hasCb = typeof cb === "function";
        if (hasCb) cb!(null, ack.committed);
      })
      .catch((err) => {
        const hasCb = typeof cb === "function";
        if (hasCb) cb!(err, false);
      });
  }

  sendCursor(cursor: unknown): void {
    this.delegateToNetwork("sendCursor", cursor);
  }

  isHistoryEmpty(): boolean {
    const res = this.delegateToNetwork("isHistoryEmpty");
    const isDefined = res !== undefined && res !== null;
    if (isDefined) return Boolean(res);
    return this.currentRevision === 0;
  }

  setColor(color: string): void {
    this.delegateToNetwork("setColor", color);
  }
  setUserId(id: string): void {
    this.delegateToNetwork("setUserId", id);
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  async dispose(): Promise<void> {
    const isAlreadyDisposed = this.disposed;
    if (isAlreadyDisposed) return;
    this.disposed = true;

    const hasRemoveListener =
      typeof globalThis !== "undefined" &&
      typeof (globalThis as any).removeEventListener === "function" &&
      this.onlineHandler;
    if (hasRemoveListener) {
      try {
        (globalThis as any).removeEventListener("online", this.onlineHandler!);
      } catch (err) {
        console.warn(
          "Unexpected error removing global online event listener:",
          err,
        );
      }
    }

    try {
      this.queue.dispose();
    } catch (err) {
      console.warn("Unexpected error disposing OfflineRevisionQueue:", err);
    }

    try {
      await this.network.dispose();
    } catch (err) {
      console.warn("Unexpected error disposing wrapped network adapter:", err);
    }
  }
}

export type IndexedDBAdapter = OfflineDurableAdapter;
export const IndexedDBAdapter = OfflineDurableAdapter;
