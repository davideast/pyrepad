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
    const hasValidRef =
      this.ref !== null && typeof this.ref.child === "function";
    if (!hasValidRef) return;

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
    while (combined[revId] !== undefined && combined[revId] !== null) {
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
          this.stream.push({
            revision: this.revision + 1,
            operation: op,
            author: data.a || "unknown",
            timestamp: data.t || Date.now(),
          });
          doc = doc.compose(op);
          hasRevisions = true;
        } catch (err) {
          console.warn(`Skipping operation at revision ${revId}:`, err);
        }
      }
      this.revision++;
      revId = revisionToId(this.revision);
    }

    if (hasRevisions) {
      try {
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

    while (pending[revId] !== undefined && pending[revId] !== null) {
      this.revision++;
      const data = pending[revId] as {
        o?: Record<string, unknown>;
        a?: string;
        t?: number;
      };
      delete pending[revId];

      const hasOpData = Boolean(data && data.o);
      if (!hasOpData) {
        revId = revisionToId(this.revision);
        continue;
      }

      const op = TextOperation.fromJSON(data.o!);
      this.stream.push({
        revision: this.revision,
        operation: op,
        author: data.a || "unknown",
        timestamp: data.t || Date.now(),
      });

      const hasMatchingSent = Boolean(this.sent && revId === this.sent.id);
      if (hasMatchingSent) {
        const isSelfAuthor = data.a === this.ctx.getUserId();
        const hasEqualsMethod = typeof this.sent!.op.equals === "function";
        const isOpEqual = hasEqualsMethod ? this.sent!.op.equals(op) : true;
        const isAuthoritativeMatch = isSelfAuthor && isOpEqual;

        if (isAuthoritativeMatch) {
          this.sent = null;
          this.ctx.onAck();
        } else {
          triggerRetry = true;
          this.ctx.onOperation(op);
        }
      } else {
        this.ctx.onOperation(op);
      }
      revId = revisionToId(this.revision);
    }

    if (triggerRetry) {
      this.sent = null;
      this.ctx.onRetry();
    }
  }

  sendOperation(
    operation: TextOperation,
    author: string,
    callback?: (err: Error | null, committed?: boolean) => void,
  ): void {
    const isInvalidRef = !this.ref || typeof this.ref.child !== "function";
    if (isInvalidRef) {
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

        const hasToJSON =
          operation &&
          typeof (operation as Record<string, unknown>).toJSON === "function";
        const opData = hasToJSON
          ? (operation as { toJSON(): unknown }).toJSON()
          : operation;

        return {
          a: author,
          o: opData,
          t: Date.now(),
        };
      },
      (err: Error | null, committed: boolean) => {
        callback?.(err, committed);
      },
    );
  }

  dispose(): void {
    const hasValidRef =
      this.ref !== null && typeof this.ref.child === "function";
    if (hasValidRef) {
      try {
        this.ref!.child("history").off();
      } catch (err) {
        console.warn("Unexpected error during history stream teardown:", err);
      }
    }
  }
}
