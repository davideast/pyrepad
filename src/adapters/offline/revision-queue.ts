/**
 * Persistent offline revision queue backed by asynchronous storage engines.
 * Buffers local collaborative typing edits during network drops and across browser session reboots.
 */
import { StorageEngineSeam } from "./storage-engine.ts";
import { toSafeJSON } from "../types.ts";

export interface PendingRevisionRecord {
  id: string;
  docId: string;
  revision: number;
  author: string;
  operationJSON: unknown;
  timestamp: number;
}

export class OfflineRevisionQueue {
  readonly docId: string;
  private storage: StorageEngineSeam;
  private disposed = false;

  constructor(docId: string, storage: StorageEngineSeam) {
    this.docId = docId || "default_doc";
    this.storage = storage;
  }

  async enqueue(
    revision: number,
    op: unknown,
    author: string,
  ): Promise<string> {
    const isDisposed = this.disposed;
    if (isDisposed) throw new Error("OfflineRevisionQueue is disposed");

    const ts = Date.now();
    const rand = Math.random().toString(36).substring(2, 8);
    const recordId = `${this.docId}:rev:${ts}:${rand}`;

    const record: PendingRevisionRecord = {
      id: recordId,
      docId: this.docId,
      revision: revision,
      author: author || "offline_user",
      operationJSON: toSafeJSON(op),
      timestamp: ts,
    };

    await this.storage.put(recordId, record);
    return recordId;
  }

  async dequeue(id: string): Promise<void> {
    const isDisposed = this.disposed;
    if (isDisposed) return;
    const hasId = Boolean(id && id.trim().length > 0);
    if (hasId) {
      await this.storage.delete(id);
    }
  }

  async getPendingRevisions(): Promise<PendingRevisionRecord[]> {
    const isDisposed = this.disposed;
    if (isDisposed) return [];

    const allRecords = await this.storage.getAll();
    const keys = Object.keys(allRecords);
    const results: PendingRevisionRecord[] = [];

    for (const key of keys) {
      const val = allRecords[key] as PendingRevisionRecord;
      const isValidRecord =
        typeof val === "object" && val !== null && val.docId === this.docId;
      if (isValidRecord) {
        results.push(val);
      }
    }

    results.sort((a, b) => {
      const diffTimestamp = a.timestamp - b.timestamp;
      const isSameTime = diffTimestamp === 0;
      if (isSameTime) {
        return a.revision - b.revision;
      }
      return diffTimestamp;
    });

    return results;
  }

  async count(): Promise<number> {
    const pending = await this.getPendingRevisions();
    return pending.length;
  }

  async clear(): Promise<void> {
    const isDisposed = this.disposed;
    if (isDisposed) return;
    const pending = await this.getPendingRevisions();
    for (const item of pending) {
      await this.dequeue(item.id);
    }
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  dispose(): void {
    const isAlreadyDisposed = this.disposed;
    if (isAlreadyDisposed) return;
    this.disposed = true;
  }
}
