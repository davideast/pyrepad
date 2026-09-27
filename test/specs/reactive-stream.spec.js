import { describe, it, expect } from "bun:test";
import { ReactiveStream } from "../../src/adapters/reactive-stream.ts";

const TIMEOUT = Symbol("timeout");
function withTimeout(promise, ms = 200) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(TIMEOUT), ms)),
  ]);
}

describe("ReactiveStream async iteration (P6)", function () {
  it("return() resolves a pending next() with done: true", async function () {
    const stream = new ReactiveStream();
    const iterator = stream[Symbol.asyncIterator]();
    const pending = iterator.next();
    await iterator.return();
    const result = await withTimeout(pending);
    expect(result).not.toBe(TIMEOUT);
    expect(result).toEqual({ value: undefined, done: true });
  });

  it("next() after return() resolves done: true instead of hanging", async function () {
    const stream = new ReactiveStream();
    const iterator = stream[Symbol.asyncIterator]();
    await iterator.return();
    stream.push(1);
    const result = await withTimeout(iterator.next());
    expect(result).toEqual({ value: undefined, done: true });
  });

  it("return() unsubscribes the iterator from the stream", async function () {
    const stream = new ReactiveStream();
    const iterator = stream[Symbol.asyncIterator]();
    await iterator.return();
    expect(stream.listeners.length).toBe(0);
  });

  it("a consumer awaiting next() is released when another party ends the iteration", async function () {
    const stream = new ReactiveStream();
    const seen = [];
    const iterator = stream[Symbol.asyncIterator]();
    const loop = (async () => {
      for (;;) {
        const { value, done } = await iterator.next();
        if (done) return "done";
        seen.push(value);
      }
    })();
    stream.push("a");
    await Promise.resolve();
    setTimeout(() => iterator.return(), 10);
    const outcome = await withTimeout(loop);
    expect(outcome).toBe("done");
    expect(seen).toEqual(["a"]);
  });

  it("a for-await loop that breaks terminates", async function () {
    const stream = new ReactiveStream();
    const seen = [];
    const loop = (async () => {
      for await (const evt of stream) {
        seen.push(evt);
        if (seen.length === 2) break;
      }
      return "done";
    })();
    await Promise.resolve();
    stream.push("a");
    stream.push("b");
    expect(await withTimeout(loop)).toBe("done");
    expect(seen).toEqual(["a", "b"]);
    expect(stream.listeners.length).toBe(0);
  });

  it("delivers queued events in order before the pending resolver", async function () {
    const stream = new ReactiveStream();
    const iterator = stream[Symbol.asyncIterator]();
    stream.push(1);
    stream.push(2);
    expect(await iterator.next()).toEqual({ value: 1, done: false });
    expect(await iterator.next()).toEqual({ value: 2, done: false });
    const pending = iterator.next();
    stream.push(3);
    expect(await pending).toEqual({ value: 3, done: false });
    await iterator.return();
  });
});
