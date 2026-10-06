/**
 * OfflineDurableAdapter: a SyncSeam that keeps unsaved edits across reloads.
 *
 * It runs the OT client (`ClientSyncAdapter`) over a network adapter, so live
 * edits converge exactly as without it, and persists the client's unsaved
 * edits (with the revision they are based on) whenever they change. After a
 * reload it reads the history written since, rebases those edits onto it,
 * delivers them on `operations` and commits them. `whenReady` resolves once
 * that replay is done; subscribe to `operations` before awaiting it.
 */
import { TextOperation } from "../../core/index.js";
import { ReactiveStream } from "../reactive-stream.js";
import { ClientSyncAdapter } from "../client-sync-adapter.js";
import type { AbstractSyncAdapter } from "../base-adapter.js";
import type {
  AgentivePresenceEvent,
  CommitAck,
  SyncError,
  SyncSeam,
  TextOperationEvent,
} from "../types.js";
import { IndexedDBStorageEngine, StorageEngineSeam } from "./storage-engine.js";
import { rebaseUnsaved, UnsavedSnapshot } from "./unsaved-snapshot.js";

type Listener = (...args: never[]) => void;

export class OfflineDurableAdapter implements SyncSeam {
  readonly operations = new ReactiveStream<TextOperationEvent>();
  readonly errors = new ReactiveStream<SyncError>();
  readonly client: ClientSyncAdapter;
  private readonly storage: StorageEngineSeam;
  private readonly key: string;
  private readonly ready: Promise<void>;
  private readonly stops: (() => void)[];
  private writes: Promise<void> = Promise.resolve();
  private persistQueued = false;
  /** Snapshots wait for the restore, so the saved edits aren't overwritten first. */
  private restored = false;
  private disposed = false;

  constructor(
    readonly network: AbstractSyncAdapter,
    storage: StorageEngineSeam = new IndexedDBStorageEngine(),
    readonly docId: string = "default_doc",
  ) {
    this.storage = storage;
    this.key = `${docId}:unsaved`;
    this.client = new ClientSyncAdapter(network);
    this.stops = [
      this.client.operations.subscribe((event) => {
        this.operations.push(event);
        this.persist();
      }),
      this.client.errors.subscribe((error) => this.errors.push(error)),
    ];
    this.ready = network
      .whenReady()
      .then(() => this.restore())
      .finally(() => {
        this.restored = true;
        this.persist();
      });
    this.ready.catch(() => {});
  }

  get presence() {
    return this.client.presence;
  }
  get agentive() {
    return this.client.agentive;
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  isHistoryEmpty(): boolean {
    return this.client.isHistoryEmpty();
  }

  commitOperation(operation: unknown, _author?: string): Promise<CommitAck> {
    const ack = this.client.commitOperation(operation);
    this.persist();
    ack.then(this.persist, this.persist);
    return ack;
  }

  /** Resolves once every snapshot taken so far has been written to storage. */
  async flush(): Promise<void> {
    await Promise.resolve();
    await this.writes;
  }

  broadcastPresence(cursor: unknown): Promise<void> {
    return this.client.broadcastPresence(cursor);
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
    if (typeof eventOrAgentId === "object")
      return this.client.broadcastAgentive(eventOrAgentId);
    return this.client.broadcastAgentive(
      eventOrAgentId,
      status!,
      ghostDiff,
      explanation,
    );
  }

  /** The network's own events ("ready", "operation", ...). */
  on(event: string, listener: Listener): void {
    this.network.on(event as never, listener);
  }
  once(event: string, listener: Listener): void {
    this.network.once(event as never, listener);
  }
  off(event: string, listener?: Listener): void {
    this.network.off(event as never, listener);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const stop of this.stops) stop();
    await this.writes;
    await this.client.dispose();
  }

  /** Coalesces snapshot writes: one per microtask turn, latest state wins. */
  private persist = (): void => {
    if (this.persistQueued || this.disposed || !this.restored) return;
    this.persistQueued = true;
    queueMicrotask(() => {
      this.persistQueued = false;
      const snap = this.client.snapshot();
      if (snap === undefined) return;
      const record: UnsavedSnapshot | null = snap && {
        docId: this.docId,
        revision: snap.revision,
        baseLength: snap.baseLength,
        sent: snap.sent ? (snap.sent.toJSON() as unknown[]) : null,
        rest: snap.rest ? (snap.rest.toJSON() as unknown[]) : null,
        savedAt: Date.now(),
      };
      this.writes = this.writes
        .then(() =>
          record
            ? this.storage.put(this.key, record)
            : this.storage.delete(this.key),
        )
        .catch((cause) =>
          this.report("Unsaved edits could not be stored offline.", cause),
        );
    });
  };

  /** Replays the edits a previous session left unsaved. */
  private async restore(): Promise<void> {
    const saved = (await this.storage.get(this.key)) as UnsavedSnapshot | null;
    if (!saved || this.disposed) return;
    try {
      const op = await this.rebase(saved);
      if (this.disposed) return;
      if (op) {
        this.client.replay(op).then(this.persist, this.persist);
      } else {
        await this.storage.delete(this.key);
      }
    } catch (cause) {
      this.report("Edits saved offline could not be restored.", cause, saved);
    }
  }

  private async rebase(saved: UnsavedSnapshot): Promise<TextOperation | null> {
    // Read until the stored history covers every revision the client has applied.
    for (;;) {
      const head = this.client.revision;
      if (saved.revision > head)
        throw new Error("The saved edits are newer than the document.");
      const { entries, userId } = await this.network.historySince(
        saved.revision,
      );
      if (this.client.revision !== head) continue;
      const needed = head - saved.revision;
      if (entries.length < needed)
        throw new Error("The document history is incomplete.");
      return rebaseUnsaved(saved, entries.slice(0, needed), userId).op;
    }
  }

  private report(
    message: string,
    cause: unknown,
    saved?: UnsavedSnapshot,
  ): void {
    this.errors.push({
      kind: "reconcile-failed",
      message,
      cause,
      revision: saved?.revision,
      operation: saved ? { sent: saved.sent, rest: saved.rest } : undefined,
    });
  }
}

export type IndexedDBAdapter = OfflineDurableAdapter;
export const IndexedDBAdapter = OfflineDurableAdapter;
