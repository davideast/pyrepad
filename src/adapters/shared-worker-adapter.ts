/**
 * Pyric SharedWorker cross-tab network adapter implementing SyncSeam.
 * Coordinates multi-window real-time editing over worker ports without browser DOM dependencies.
 */
import { RefLike, isValidRef } from "./types.ts";
import { AbstractSyncAdapter } from "./base-adapter.ts";

export interface MessagePortLike {
  postMessage(message: unknown): void;
  addEventListener?(type: string, handler: unknown): void;
  removeEventListener?(type: string, handler: unknown): void;
  close?(): void;
}

export class SharedWorkerAdapter extends AbstractSyncAdapter {
  private workerPort: MessagePortLike | null;
  private messageHandler: any = null;

  constructor(
    ref: unknown,
    userId?: string,
    userColor?: string,
    workerPort?: unknown,
  ) {
    super();
    const normalized = isValidRef(ref) ? (ref as RefLike) : null;
    this.setupStreams(normalized, "worker", userColor || "#10b981");
    const hasCustomId = Boolean(userId && userId.trim().length > 0);
    if (hasCustomId) {
      this.userId = userId!;
    }
    this.workerPort = (workerPort as MessagePortLike) || null;

    this.bindWorkerEvents();
    this.initializeConnection();
  }

  private bindWorkerEvents(): void {
    const hasPortListener = Boolean(
      this.workerPort && typeof this.workerPort.addEventListener === "function",
    );
    if (!hasPortListener) return;

    this.messageHandler = (evt: any) => {
      const isAlreadyDisposed = this.disposed;
      if (isAlreadyDisposed) return;
      const data = evt && evt.data;
      const hasData = Boolean(data && data.type);
      if (!hasData) return;
      this.handleWorkerMessage(data);
    };

    this.workerPort!.addEventListener!("message", this.messageHandler);
  }

  private handleWorkerMessage(data: { type: string; payload?: any }): void {
    const isCommit = data.type === "PYRIC_WORKER_COMMIT";
    if (isCommit) {
      const hasPayload = Boolean(data.payload);
      if (hasPayload) {
        this.trigger("worker_commit", data.payload);
      }
    }
  }

  protected override onCommitSuccess(author: string): void {
    this.broadcastWorkerMessage({
      type: "PYRIC_WORKER_COMMIT",
      payload: { author: author },
    });
  }

  private broadcastWorkerMessage(msg: unknown): void {
    const hasPostMessage = Boolean(
      this.workerPort && typeof this.workerPort.postMessage === "function",
    );
    if (!hasPostMessage) return;
    try {
      this.workerPort!.postMessage(msg);
    } catch (err) {
      console.warn("Unexpected error sending SharedWorker message:", err);
    }
  }

  override dispose(): Promise<void> {
    const isAlreadyDisposed = this.disposed;
    if (isAlreadyDisposed) return Promise.resolve();

    const hasWorkerListener = Boolean(
      this.workerPort &&
      typeof this.workerPort.removeEventListener === "function" &&
      this.messageHandler,
    );
    if (hasWorkerListener) {
      try {
        this.workerPort!.removeEventListener!("message", this.messageHandler);
      } catch (err) {
        console.warn("Unexpected error removing SharedWorker listener:", err);
      }
    }

    const hasClose = Boolean(
      this.workerPort && typeof this.workerPort.close === "function",
    );
    if (hasClose) {
      try {
        this.workerPort!.close!();
      } catch (err) {
        console.warn("Unexpected error closing SharedWorker port:", err);
      }
    }

    return super.dispose();
  }
}
