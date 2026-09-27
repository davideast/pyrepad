/**
 * Offline durable collaborative adapter decorator implementing SyncSeam.
 * Protects un-transmitted edits with IndexedDB buffering, automatic recovery triggers,
 * and multi-revision Operational Transform rebase and rollback resolution.
 */
import { TextOperation } from "../../core/index.ts";
import { Emitter } from "../../core/emitter.ts";
import {
  SyncSeam,
  CommitAck,
  AdapterCallbacks,
  AdapterEvents,
  TextOperationEvent,
  PresenceEvent,
  AgentivePresenceEvent,
  OfflineConflictEvent,
} from "../types.ts";
import type { AbstractSyncAdapter } from "../base-adapter.ts";
import { StorageEngineSeam, IndexedDBStorageEngine } from "./storage-engine.ts";
import {
  OfflineRevisionQueue,
  PendingRevisionRecord,
} from "./revision-queue.ts";

export type { OfflineConflictEvent } from "../types.ts";

/** Any network adapter: the rest of AbstractSyncAdapter's API is optional (JS networks may omit it). */
export type DurableNetwork = SyncSeam &
  Partial<Omit<AbstractSyncAdapter, keyof SyncSeam>>;

type AnyListener = (...args: any[]) => void;

export class OfflineDurableAdapter implements SyncSeam {
  readonly network: DurableNetwork;
  readonly queue: OfflineRevisionQueue;
  private disposed = false;
  private currentRevision = 0;
  private onlineHandler: (() => void) | null = null;
  private inFlight: Promise<Map<string, CommitAck>> | null = null;
  private conflicts = new Emitter<{ conflict: [OfflineConflictEvent] }>();
  public callbacks: AdapterCallbacks = {};

  constructor(
    network: DurableNetwork,
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
    const hasOnMethod = typeof this.network.on === "function";
    if (!hasOnMethod) return;

    this.network.on("operation", () => {
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

    this.network.on("ready", triggerReconcile);
    this.network.on("worker_sync", triggerReconcile);
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

    // Every op is enqueued and only ever sent by the single-flight drain, so a
    // record cannot be committed both directly and by a reconnect replay.
    const opAuthor = author || "offline-client";
    const recordId = await this.queue.enqueue(
      this.currentRevision,
      operation,
      opAuthor,
    );

    let outcome = await this.awaitInFlightOutcome(recordId);
    if (!outcome && !this.disposed) {
      outcome = (await this.drainLatched()).get(recordId);
    }
    return outcome || { revision: this.currentRevision, committed: false };
  }

  private async awaitInFlightOutcome(
    recordId: string,
  ): Promise<CommitAck | undefined> {
    // A drain that started before our enqueue may or may not include the record.
    while (this.inFlight) {
      const outcomes = await this.inFlight;
      const outcome = outcomes.get(recordId);
      if (outcome) return outcome;
    }
    return undefined;
  }

  async reconcile(canonicalRemoteOps?: unknown[]): Promise<number> {
    const outcomes = await this.drainLatched(canonicalRemoteOps);
    let reconciledCount = 0;
    for (const ack of outcomes.values()) {
      if (ack.committed) reconciledCount++;
    }
    return reconciledCount;
  }

  /** Single-flight latch: concurrent callers join the drain already running. */
  private drainLatched(
    canonicalRemoteOps?: unknown[],
  ): Promise<Map<string, CommitAck>> {
    if (this.inFlight) return this.inFlight;
    const run = this.drain(canonicalRemoteOps).finally(() => {
      if (this.inFlight === run) this.inFlight = null;
    });
    this.inFlight = run;
    return run;
  }

  private async drain(
    canonicalRemoteOps?: unknown[],
  ): Promise<Map<string, CommitAck>> {
    const outcomes = new Map<string, CommitAck>();
    if (this.disposed) return outcomes;

    const pending = await this.queue.getPendingRevisions();
    // A malformed canonical op rejects the drain rather than rebasing on partial history.
    const remotes = (canonicalRemoteOps || []).map((raw) =>
      this.parseTextOp(raw),
    );

    for (const item of pending) {
      if (this.disposed) break;
      const ack = await this.reconcileRecord(item, remotes);
      outcomes.set(item.id, ack);
    }

    return outcomes;
  }

  private async reconcileRecord(
    item: PendingRevisionRecord,
    remotes: TextOperation[],
  ): Promise<CommitAck> {
    const notCommitted = { revision: this.currentRevision, committed: false };
    let localOp: TextOperation;
    try {
      localOp = this.parseTextOp(item.operationJSON);
      for (let i = 0; i < remotes.length; i++) {
        const transformed = TextOperation.transform(localOp, remotes[i]);
        localOp = transformed[0];
        remotes[i] = transformed[1];
      }
    } catch (err) {
      // Unresolvable: roll the record back and hand the dropped op to the caller.
      await this.queue.dequeue(item.id);
      this.conflicts.trigger("conflict", {
        recordId: item.id,
        author: item.author,
        revision: item.revision,
        operation: item.operationJSON,
        error: err instanceof Error ? err : new Error(String(err)),
      });
      return notCommitted;
    }

    try {
      const ack = await this.network.commitOperation(localOp, item.author);
      const isCommitted = Boolean(ack && ack.committed);
      if (isCommitted) {
        await this.queue.dequeue(item.id);
        this.currentRevision = ack.revision;
        return ack;
      }
      return notCommitted;
    } catch (_networkError) {
      // Offline or disposed: the record stays buffered for the next reconcile.
      return notCommitted;
    }
  }

  private parseTextOp(payload: unknown): TextOperation {
    if (payload instanceof TextOperation) return payload;
    return TextOperation.fromJSON(payload as any[]);
  }

  broadcastPresence(cursor: unknown): Promise<void> {
    return this.network.broadcastPresence(cursor);
  }

  broadcastAgentive(event: AgentivePresenceEvent): Promise<void>;
  /** @deprecated Pass a single `AgentivePresenceEvent` instead. */
  broadcastAgentive(
    agentId: string,
    status: string,
    ghostDiff?: unknown,
    explanation?: string,
  ): Promise<void>;
  broadcastAgentive(
    eventOrAgentId: AgentivePresenceEvent | string,
    status?: string,
    ghostDiff?: unknown,
    explanation?: string,
  ): Promise<void> {
    const net = this.network;
    return typeof eventOrAgentId === "object"
      ? net.broadcastAgentive(eventOrAgentId)
      : net.broadcastAgentive(eventOrAgentId, status, ghostDiff, explanation);
  }

  whenReady(): Promise<void> {
    // A JS network written before `whenReady` existed is treated as ready.
    return this.network.whenReady?.() ?? Promise.resolve();
  }

  // "conflict" is this adapter's own event; every other event is the network's.
  on(event: keyof AdapterEvents | "conflict", callback: AnyListener): void {
    if (event === "conflict") this.conflicts.on(event, callback);
    else this.network.on?.(event, callback);
  }
  once(event: keyof AdapterEvents | "conflict", callback: AnyListener): void {
    if (event === "conflict") this.conflicts.once(event, callback);
    else this.network.once?.(event, callback);
  }
  off(event: keyof AdapterEvents | "conflict", callback?: AnyListener): void {
    if (event === "conflict") this.conflicts.off(event, callback);
    else this.network.off?.(event, callback);
  }
  trigger<K extends keyof AdapterEvents>(
    event: K,
    ...args: AdapterEvents[K]
  ): void {
    this.network.trigger?.(event, ...args);
  }

  registerCallbacks(callbacks: AdapterCallbacks): void {
    this.callbacks = callbacks || {};
    this.network.registerCallbacks?.(callbacks);
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
    this.network.sendCursor?.(cursor);
  }

  isHistoryEmpty(): boolean {
    // A JS network without `isHistoryEmpty` falls back to the revisions seen here.
    const res = this.network.isHistoryEmpty?.();
    if (res !== undefined && res !== null) return Boolean(res);
    return this.currentRevision === 0;
  }

  setColor(color: string): void {
    this.network.setColor?.(color);
  }
  setUserId(id: string): void {
    this.network.setUserId?.(id);
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  async dispose(): Promise<void> {
    const isAlreadyDisposed = this.disposed;
    if (isAlreadyDisposed) return;
    this.disposed = true;
    this.conflicts.off();

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
