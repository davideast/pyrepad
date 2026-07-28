/**
 * Offline durable collaborative adapter decorator implementing SyncSeam.
 * Protects un-transmitted edits with IndexedDB buffering and automatic OT rebase resolution.
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
  }

  private bindNetworkEvents(): void {
    const hasOnMethod = typeof (this.network as any).on === "function";
    if (!hasOnMethod) return;
    (this.network as any).on("operation", (op: any) => {
      this.currentRevision++;
    });
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
      // Network disconnected or offline transit; edit remains durable in IndexedDB
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
    const remotes = canonicalRemoteOps || [];

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
    remotes: unknown[],
  ): Promise<boolean> {
    let localOp = this.parseTextOp(item.operationJSON);
    const hasRemotes = remotes.length > 0;
    if (hasRemotes && localOp) {
      for (const remoteRaw of remotes) {
        const remoteOp = this.parseTextOp(remoteRaw);
        const canTransform = Boolean(remoteOp);
        if (canTransform) {
          try {
            const transformed = TextOperation.transform(localOp!, remoteOp!);
            localOp = transformed[0];
          } catch (err) {
            console.warn(
              "Unexpected Operational Transform rebase discrepancy during reconcile:",
              err,
            );
          }
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

  broadcastPresence(cursor: unknown): Promise<void> {
    return this.network.broadcastPresence(cursor);
  }

  broadcastAgentive(
    agentId: string,
    status: string,
    ghostDiff?: unknown,
    explanation?: string,
  ): Promise<void> {
    return this.network.broadcastAgentive(
      agentId,
      status,
      ghostDiff,
      explanation,
    );
  }

  on(event: string, callback: EventCallback): void {
    const hasOnMethod = typeof (this.network as any).on === "function";
    if (hasOnMethod) (this.network as any).on(event, callback);
  }

  once(event: string, callback: EventCallback): void {
    const hasOnceMethod = typeof (this.network as any).once === "function";
    if (hasOnceMethod) (this.network as any).once(event, callback);
  }

  off(event: string, callback?: EventCallback): void {
    const hasOffMethod = typeof (this.network as any).off === "function";
    if (hasOffMethod) (this.network as any).off(event, callback);
  }

  trigger(event: string, ...args: unknown[]): void {
    const hasTriggerMethod =
      typeof (this.network as any).trigger === "function";
    if (hasTriggerMethod) (this.network as any).trigger(event, ...args);
  }

  registerCallbacks(callbacks: AdapterCallbacks): void {
    this.callbacks = callbacks || {};
    const hasReg =
      typeof (this.network as any).registerCallbacks === "function";
    if (hasReg) (this.network as any).registerCallbacks(callbacks);
  }

  sendOperation(
    operation: TextOperation,
    callback?: (err: Error | null, committed?: boolean) => void,
    author?: string,
  ): void {
    this.commitOperation(operation, author)
      .then((ack) => {
        const hasCb = typeof callback === "function";
        if (hasCb) callback!(null, ack.committed);
      })
      .catch((err) => {
        const hasCb = typeof callback === "function";
        if (hasCb) callback!(err, false);
      });
  }

  sendCursor(cursor: unknown): void {
    const hasSendCursor =
      typeof (this.network as any).sendCursor === "function";
    if (hasSendCursor) (this.network as any).sendCursor(cursor);
  }

  isHistoryEmpty(): boolean {
    const hasEmptyCheck =
      typeof (this.network as any).isHistoryEmpty === "function";
    if (hasEmptyCheck) return (this.network as any).isHistoryEmpty();
    return this.currentRevision === 0;
  }

  setColor(color: string): void {
    const hasSetColor = typeof (this.network as any).setColor === "function";
    if (hasSetColor) (this.network as any).setColor(color);
  }

  setUserId(id: string): void {
    const hasSetId = typeof (this.network as any).setUserId === "function";
    if (hasSetId) (this.network as any).setUserId(id);
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  async dispose(): Promise<void> {
    const isAlreadyDisposed = this.disposed;
    if (isAlreadyDisposed) return;
    this.disposed = true;

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
