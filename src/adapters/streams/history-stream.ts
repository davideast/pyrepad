/**
 * Independent protocol stream handler for document history and operational transformations.
 */
import { TextOperation } from "../../core/index.js";
import {
  RefLike,
  SnapLike,
  SyncError,
  TextOperationEvent,
  getSnapKey,
  getSnapVal,
  isValidRef,
  toSafeJSON,
} from "../types.js";
import { ReactiveStream } from "../reactive-stream.js";

export function revisionToId(rev: number): string {
  return "A" + rev.toString(36);
}

export interface HistoryStreamContext {
  onOperation(op: unknown): void;
  onAck(): void;
  onRetry(): void;
  getUserId(): string;
  isReady(): boolean;
}

interface HistoryEntry {
  o?: unknown[];
  a?: string;
  t?: number;
}

interface SentState {
  id: string;
  op: TextOperation;
}

export class HistoryStreamHandler {
  readonly stream = new ReactiveStream<TextOperationEvent>();
  readonly errors = new ReactiveStream<SyncError>();
  private ref: RefLike | null;
  private ctx: HistoryStreamContext;
  private pendingRevisions: Record<string, unknown> = {};
  private revision = 0;
  /** Length of the document after every accepted revision. */
  private docLength = 0;
  private sent: SentState | null = null;

  constructor(ref: RefLike | null, ctx: HistoryStreamContext) {
    this.ref = ref;
    this.ctx = ctx;
  }

  getRevision(): number {
    return this.revision;
  }

  startMonitoring(): void {
    const refValid = isValidRef(this.ref);
    if (!refValid) return;

    const historyRef = this.ref!.child("history");
    historyRef.on("child_added", (snap: SnapLike) => {
      const revId = getSnapKey(snap);
      const isMissingKey = !revId;
      if (isMissingKey) return;

      this.pendingRevisions[revId!] = getSnapVal(snap);
      const isAdapterReady = this.ctx.isReady();
      if (isAdapterReady) {
        this.drainPendingRevisions();
      }
    });
  }

  /**
   * The op stored at revision `index`, or null when it can't be decoded or does
   * not fit the document. Every client rejects the same entries, so skipping
   * them keeps everyone converged; each one is reported on `errors`.
   */
  private decode(index: number, data: HistoryEntry): TextOperation | null {
    try {
      const op = TextOperation.fromJSON(data.o!);
      if (op.baseLength !== this.docLength)
        throw new Error(
          `expects a document of length ${op.baseLength}, not ${this.docLength}`,
        );
      this.docLength = op.targetLength;
      return op;
    } catch (cause) {
      this.errors.push({
        kind: "invalid-operation",
        message: `Skipped history revision ${index}: ${cause instanceof Error ? cause.message : String(cause)}`,
        cause,
        revision: index,
        operation: data.o,
      });
      return null;
    }
  }

  composeInitialRevisions(snap: SnapLike): void {
    let rawVal = getSnapVal(snap);
    const isObjectVal = typeof rawVal === "object" && rawVal !== null;
    if (!isObjectVal) rawVal = {};

    const combined: Record<string, unknown> = {
      ...(rawVal as Record<string, unknown>),
      ...this.pendingRevisions,
    };
    let doc = new TextOperation();
    let hasRevisions = false;

    let revId = revisionToId(this.revision);
    let hasNextRevision =
      combined[revId] !== undefined && combined[revId] !== null;

    while (hasNextRevision) {
      const data = combined[revId] as HistoryEntry;
      delete this.pendingRevisions[revId];

      const op = data && data.o ? this.decode(this.revision, data) : null;
      if (op) {
        doc = doc.compose(op);
        hasRevisions = true;
      }
      this.revision++;
      revId = revisionToId(this.revision);
      hasNextRevision =
        combined[revId] !== undefined && combined[revId] !== null;
    }

    if (hasRevisions) {
      try {
        this.stream.push({
          revision: this.revision,
          operation: doc,
          author: "atomic-startup",
          timestamp: Date.now(),
        });
        this.ctx.onOperation(doc);
      } catch (cause) {
        this.errors.push({
          kind: "apply-failed",
          message: "The initial document could not be applied.",
          cause,
          revision: this.revision,
        });
      }
    }
  }

  drainPendingRevisions(): void {
    let triggerRetry = false;
    let revId = revisionToId(this.revision);
    const pending = this.pendingRevisions;
    let hasNextPending =
      pending[revId] !== undefined && pending[revId] !== null;

    while (hasNextPending) {
      this.revision++;
      const data = pending[revId] as HistoryEntry;
      delete pending[revId];

      const hasOpData = Boolean(data && data.o);
      if (hasOpData) {
        this.processPendingOperation(revId, data, (retry) => {
          if (retry) triggerRetry = true;
        });
      }
      revId = revisionToId(this.revision);
      hasNextPending = pending[revId] !== undefined && pending[revId] !== null;
    }

    if (triggerRetry) {
      this.sent = null;
      this.ctx.onRetry();
    }
  }

  private processPendingOperation(
    revId: string,
    data: HistoryEntry,
    onNeedRetry?: (retry: boolean) => void,
  ): void {
    const op = this.decode(this.revision - 1, data);
    if (!op) {
      // Our write lost this revision to an entry nobody can apply.
      if (this.sent && revId === this.sent.id) onNeedRetry?.(true);
      return;
    }
    const actualAuthor = data.a || "unknown";
    this.stream.push({
      revision: this.revision,
      operation: op,
      author: actualAuthor,
      timestamp: data.t || Date.now(),
    });

    const hasMatchingSent = Boolean(this.sent && revId === this.sent.id);
    if (!hasMatchingSent) {
      this.ctx.onOperation(op);
      return;
    }

    const isSelfAuthor = actualAuthor === this.ctx.getUserId();
    const hasEqualsMethod = typeof this.sent!.op.equals === "function";
    const isOpEqual = hasEqualsMethod ? this.sent!.op.equals(op) : true;
    const isAuthoritativeMatch = isSelfAuthor && isOpEqual;

    if (isAuthoritativeMatch) {
      this.sent = null;
      this.ctx.onAck();
    } else {
      if (onNeedRetry) onNeedRetry(true);
      this.ctx.onOperation(op);
    }
  }

  /** The stored history from revision `from` on, and the id this client writes as. */
  readSince(
    from: number,
  ): Promise<{ entries: { author: string; op: unknown }[]; userId: string }> {
    const userId = this.ctx.getUserId();
    if (!isValidRef(this.ref)) return Promise.resolve({ entries: [], userId });
    return new Promise((resolve) => {
      this.ref!.child("history").once("value", (snap: SnapLike) => {
        const all = (getSnapVal(snap) ?? {}) as Record<string, HistoryEntry>;
        const entries: { author: string; op: unknown }[] = [];
        for (let rev = from; all[revisionToId(rev)]; rev++) {
          const data = all[revisionToId(rev)]!;
          entries.push({ author: data.a ?? "unknown", op: data.o });
        }
        resolve({ entries, userId });
      });
    });
  }

  sendOperation(
    operation: TextOperation,
    author: string,
    callback?: (err: Error | null, committed?: boolean) => void,
  ): void {
    const refValid = isValidRef(this.ref);
    if (!refValid) {
      callback?.(
        new Error("Database reference is uninitialized or destroyed"),
        false,
      );
      return;
    }

    const revStr = revisionToId(this.revision);
    const userId = this.ctx.getUserId();
    const isSelfAuthor = author === userId;
    if (isSelfAuthor) {
      this.sent = { id: revStr, op: operation };
    }

    const historyRef = this.ref!.child("history").child(revStr);
    if (typeof historyRef.transaction !== "function") {
      callback?.(new Error("Transaction unsupported"), false);
      return;
    }

    historyRef.transaction(
      (current: unknown) => {
        const isAlreadyClaimed = current !== null && current !== undefined;
        if (isAlreadyClaimed) return undefined;

        return {
          a: author,
          o: toSafeJSON(operation),
          t: Date.now(),
        };
      },
      (err: Error | null, committed: boolean) => {
        callback?.(err, committed);
      },
    );
  }

  dispose(): void {
    const refValid = isValidRef(this.ref);
    if (refValid) {
      try {
        this.ref!.child("history").off();
      } catch (err) {
        console.warn("Unexpected error during history stream teardown:", err);
      }
    }
  }
}
