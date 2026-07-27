/**
 * Independent protocol stream handler for document history and operational transformations.
 */
import { TextOperation } from "../../core/index.ts";
import {
  RefLike,
  SnapLike,
  TextOperationEvent,
  getSnapKey,
  getSnapVal,
  isValidRef,
  toSafeJSON,
} from "../types.ts";
import { ReactiveStream } from "../reactive-stream.ts";

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

interface SentState {
  id: string;
  op: TextOperation;
}

export class HistoryStreamHandler {
  readonly stream = new ReactiveStream<TextOperationEvent>();
  private ref: RefLike | null;
  private ctx: HistoryStreamContext;
  private pendingRevisions: Record<string, unknown> = {};
  private revision = 0;
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
      const data = combined[revId] as {
        o?: Record<string, unknown>;
        a?: string;
        t?: number;
      };
      delete this.pendingRevisions[revId];

      const hasOpData = Boolean(data && data.o);
      if (hasOpData) {
        try {
          const op = TextOperation.fromJSON(data.o!);
          doc = doc.compose(op);
          hasRevisions = true;
        } catch (err) {
          console.warn(`Skipping operation at revision ${revId}:`, err);
        }
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
      } catch (err) {
        console.warn("Failed to apply initial composed document:", err);
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
      const data = pending[revId] as {
        o?: Record<string, unknown>;
        a?: string;
        t?: number;
      };
      delete pending[revId];

      const hasOpData = Boolean(data && data.o);
      if (hasOpData) {
        this.processPendingOperation(data.o!, data.a, data.t, (retry) => {
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
    rawOp: Record<string, unknown>,
    author?: string,
    timestamp?: number,
    onNeedRetry?: (retry: boolean) => void,
  ): void {
    const op = TextOperation.fromJSON(rawOp);
    const revStr = revisionToId(this.revision);
    const actualAuthor = author || "unknown";
    this.stream.push({
      revision: this.revision,
      operation: op,
      author: actualAuthor,
      timestamp: timestamp || Date.now(),
    });

    const hasMatchingSent = Boolean(
      this.sent && revisionToId(this.revision) === this.sent.id,
    );
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
    const isTransactionUnsupported =
      typeof historyRef.transaction !== "function";
    if (isTransactionUnsupported) {
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
