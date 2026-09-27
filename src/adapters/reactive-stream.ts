/**
 * Type-safe reactive event stream implementing async iterable observation.
 */
export class ReactiveStream<T> implements AsyncIterable<T> {
  private listeners: ((event: T) => void)[] = [];

  subscribe(listener: (event: T) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  push(event: T): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error("SyncSeam stream subscriber error:", err);
      }
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    const queue: T[] = [];
    let resolveNext: ((value: IteratorResult<T>) => void) | null = null;
    let finished = false;
    const unsubscribe = this.subscribe((evt: T) => {
      const hasPendingResolver = resolveNext !== null;
      if (hasPendingResolver) {
        const resolver = resolveNext!;
        resolveNext = null;
        resolver({ value: evt, done: false });
      } else {
        queue.push(evt);
      }
    });
    const doneResult = (): IteratorResult<T> => ({
      value: undefined,
      done: true,
    });

    return {
      next(): Promise<IteratorResult<T>> {
        const hasQueuedItems = queue.length > 0;
        if (hasQueuedItems) {
          const nextItem = queue.shift()!;
          return Promise.resolve({ value: nextItem, done: false });
        }
        if (finished) return Promise.resolve(doneResult());
        return new Promise<IteratorResult<T>>((resolve) => {
          resolveNext = resolve;
        });
      },
      return(): Promise<IteratorResult<T>> {
        finished = true;
        unsubscribe();
        queue.length = 0;
        const pending = resolveNext;
        resolveNext = null;
        if (pending) pending(doneResult());
        return Promise.resolve(doneResult());
      },
    };
  }
}
