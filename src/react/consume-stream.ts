/**
 * Pumps a SyncSeam AsyncIterable into a callback until the returned stop
 * function is called. Stopping calls the iterator's `return()`, which releases
 * the stream subscription and settles any pending `next()`.
 */
export function consumeStream<T>(
  stream: AsyncIterable<T>,
  onEvent: (event: T) => void,
): () => void {
  const iterator = stream[Symbol.asyncIterator]();
  let active = true;

  const pump = async (): Promise<void> => {
    while (active) {
      const result = await iterator.next();
      if (result.done || !active) return;
      try {
        onEvent(result.value);
      } catch (err) {
        console.warn("SyncSeam stream handler failed:", err);
      }
    }
  };
  pump().catch((err) => console.warn("SyncSeam stream ended with error:", err));

  return () => {
    active = false;
    const hasReturn = typeof iterator.return === "function";
    if (hasReturn) void iterator.return!();
  };
}
