/**
 * "conflict" event raised by OfflineDurableAdapter when a queued offline op cannot be
 * rebased onto the canonical history and is dropped from the queue.
 */
export interface OfflineConflictEvent {
  recordId: string;
  author: string;
  revision: number;
  operation: unknown;
  error: Error;
}

type ConflictListener = (evt: OfflineConflictEvent) => void;

/** Listeners for the adapter's own "conflict" event; never forwarded to the network. */
export class ConflictListeners {
  private listeners: ConflictListener[] = [];

  on(callback: ConflictListener): void {
    this.listeners.push(callback);
  }

  once(callback: ConflictListener): void {
    const wrapper: ConflictListener = (evt) => {
      this.off(wrapper);
      callback(evt);
    };
    this.on(wrapper);
  }

  off(callback?: ConflictListener): void {
    this.listeners = callback
      ? this.listeners.filter((cb) => cb !== callback)
      : [];
  }

  emit(evt: OfflineConflictEvent): void {
    for (const cb of [...this.listeners]) cb(evt);
  }
}
