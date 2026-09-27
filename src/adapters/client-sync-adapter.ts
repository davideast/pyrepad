/**
 * ClientSyncAdapter: a SyncSeam that runs the OT client (ot-client.ts) over an
 * AbstractSyncAdapter, so its consumers see a converged document.
 *
 * - `commitOperation` goes through `OTClient.applyClient`: one op in flight,
 *   later edits buffered until the ack. Revisions are authored by the wrapped
 *   adapter's own user id (that is how its history stream recognises the ack),
 *   so the `author` argument is ignored.
 * - `operations` carries remote ops only, already transformed against the
 *   local ops in flight; the echo of an own op is consumed as its ack.
 * - A lost revision race ("retry") re-sends the outstanding op transformed
 *   against the winning remote revision, instead of the base adapter's
 *   re-send of the original op.
 * - `seedIfEmpty` commits a seed as a compare-and-set on revision 0: if a peer
 *   claims revision 0 first, the seed is undone locally and never re-sent.
 */
import { TextOperation } from "../core/index.js";
import type { AbstractSyncAdapter } from "./base-adapter.js";
import { ReactiveStream } from "./reactive-stream.js";
import { OTClient, Synchronized } from "./ot-client.js";
import type {
  AgentivePresenceEvent,
  CommitAck,
  SyncSeam,
  TextOperationEvent,
} from "./types.js";

type CommitSettle = { resolve(a: CommitAck): void; reject(e: Error): void };

export class ClientSyncAdapter implements SyncSeam {
  readonly operations = new ReactiveStream<TextOperationEvent>();
  private client: OTClient;
  private lastEvent: TextOperationEvent | null = null;
  private inFlight: CommitSettle[] = [];
  private buffered: CommitSettle[] = [];
  private detached = false;
  private seeding = false;
  private readonly stopRaw: () => void;

  constructor(private readonly inner: AbstractSyncAdapter) {
    this.client = this.createClient();
    this.stopRaw = inner.operations.subscribe((event) => {
      this.lastEvent = event;
    });
    inner.on("operation", this.onRemote);
    inner.on("ack", this.onAck);
    inner.on("retry", this.onRetry);
  }

  get presence() {
    return this.inner.presence;
  }
  get agentive() {
    return this.inner.agentive;
  }

  whenReady(): Promise<void> {
    return this.inner.whenReady();
  }

  isHistoryEmpty(): boolean {
    return this.inner.isHistoryEmpty();
  }

  commitOperation(operation: unknown, _author?: string): Promise<CommitAck> {
    if (this.detached) {
      return Promise.reject(new Error("Adapter is disposed"));
    }
    return new Promise<CommitAck>((resolve, reject) => {
      this.buffered.push({ resolve, reject });
      this.client.applyClient(operation as TextOperation);
    });
  }

  /**
   * Applies `seed` locally (via `applyLocally`) and commits it, but only while
   * the history is empty and nothing is in flight; otherwise does nothing and
   * resolves `committed: false`. A seed that loses revision 0 to a peer is
   * dropped: `operations` delivers its undo and the ack says `committed: false`.
   * `seed` must only insert.
   */
  seedIfEmpty(
    seed: TextOperation,
    applyLocally: (op: TextOperation) => void,
  ): Promise<CommitAck> {
    const canSeed =
      !this.detached && this.isIdle() && this.inner.isHistoryEmpty();
    if (!canSeed) return Promise.resolve({ revision: 0, committed: false });
    applyLocally(seed);
    this.seeding = true;
    return this.commitOperation(seed);
  }

  broadcastPresence(cursor: unknown): Promise<void> {
    return this.inner.broadcastPresence(cursor);
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
    if (typeof eventOrAgentId === "object") {
      return this.inner.broadcastAgentive(eventOrAgentId);
    }
    return this.inner.broadcastAgentive(
      eventOrAgentId,
      status!,
      ghostDiff,
      explanation,
    );
  }

  /** Stops listening to the wrapped adapter and rejects unsettled commits; leaves it running. */
  detach(): void {
    if (this.detached) return;
    this.detached = true;
    this.stopRaw();
    this.inner.off("operation", this.onRemote);
    this.inner.off("ack", this.onAck);
    this.inner.off("retry", this.onRetry);
    this.rejectAll(new Error("Adapter disposed before commit settled"));
  }

  dispose(): Promise<void> {
    this.detach();
    return this.inner.dispose();
  }

  private createClient(): OTClient {
    return new OTClient({
      sendOperation: (op) => this.send(op),
      applyOperation: (op) => this.emitRemote(op),
    });
  }

  private send(op: TextOperation): void {
    // Whatever was buffered is now part of the op in flight.
    this.inFlight.push(...this.buffered);
    this.buffered = [];
    this.inner.sendOperation(op, (err) => {
      // A lost race (no error, not committed) is resolved by the "retry" event.
      if (err && !this.detached) this.failInFlight(err);
    });
  }

  /** The op could not be written: drop it and every buffered edit behind it. */
  private failInFlight(err: Error): void {
    this.seeding = false;
    this.rejectAll(err);
    this.client = this.createClient();
  }

  private rejectAll(err: Error): void {
    const settles = [...this.inFlight, ...this.buffered];
    this.inFlight = [];
    this.buffered = [];
    for (const settle of settles) settle.reject(err);
  }

  private emitRemote(op: TextOperation): void {
    const source = this.lastEvent;
    this.operations.push({
      revision: source ? source.revision : 0,
      operation: op,
      author: source ? source.author : "unknown",
      timestamp: source ? source.timestamp : Date.now(),
    });
  }

  private onRemote = (op: unknown): void => {
    // `lastEvent` is the raw history event this op was pushed with.
    const isTracked = this.lastEvent && this.lastEvent.operation === op;
    if (!isTracked) this.lastEvent = null;
    this.client.applyServer(op as TextOperation);
  };

  // An ack or retry with nothing in flight belongs to a commit made on the
  // wrapped adapter directly (or to an op already dropped by failInFlight).
  private isIdle(): boolean {
    return this.client.state instanceof Synchronized;
  }

  private onAck = (): void => {
    if (this.isIdle()) return;
    this.seeding = false;
    const acked = this.inFlight;
    this.inFlight = [];
    const revision = this.lastEvent ? this.lastEvent.revision : 0;
    this.client.serverAck();
    for (const settle of acked) settle.resolve({ revision, committed: true });
  };

  private onRetry = (): void => {
    if (this.isIdle()) return;
    if (!this.seeding) return this.client.serverRetry();
    // A peer seeded first; its content (already applied) wins.
    this.seeding = false;
    const dropped = this.inFlight;
    this.inFlight = [];
    const revision = this.lastEvent ? this.lastEvent.revision : 0;
    this.client.dropOutstanding();
    for (const settle of dropped)
      settle.resolve({ revision, committed: false });
  };
}
