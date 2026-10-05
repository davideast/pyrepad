import { describe, expect, test } from "bun:test";
import { ClientSyncAdapter } from "../../src/adapters/client-sync-adapter.ts";
import { ReactiveStream } from "../../src/adapters/reactive-stream.ts";
import { Emitter } from "../../src/core/emitter.ts";
import { TextOperation } from "../../src/core/index.ts";

class FakeInner extends Emitter {
  operations = new ReactiveStream();
  commitDelayMs = 20;
  sent = [];
  sendOperation(op) {
    this.sent.push(op);
  }
  whenReady() {
    return Promise.resolve();
  }
  isHistoryEmpty() {
    return false;
  }
}

const insertAt = (pos, len, text) => {
  const op = new TextOperation();
  if (pos) op.retain(pos);
  op.insert(text);
  if (len - pos) op.retain(len - pos);
  return op;
};

describe("ClientSyncAdapter commit batching", () => {
  test("composes edits within the delay into a single send", async () => {
    const inner = new FakeInner();
    const client = new ClientSyncAdapter(inner);
    const a = client.commitOperation(insertAt(0, 0, "a"));
    const b = client.commitOperation(insertAt(1, 1, "b"));
    expect(inner.sent.length).toBe(0);
    await new Promise((r) => setTimeout(r, 50));
    expect(inner.sent.length).toBe(1);
    expect(inner.sent[0].apply("")).toBe("ab");
    inner.trigger("ack");
    expect(await a).toMatchObject({ committed: true });
    expect(await b).toMatchObject({ committed: true });
  });

  test("a remote op arriving mid-batch is transformed against the held edits", async () => {
    const inner = new FakeInner();
    const client = new ClientSyncAdapter(inner);
    const seen = [];
    client.operations.subscribe((e) => seen.push(e.operation));
    void client.commitOperation(insertAt(0, 3, "X"));
    inner.trigger("operation", insertAt(3, 3, "Y"));
    expect(seen[0].apply("XABC")).toBe("XABCY");
    await new Promise((r) => setTimeout(r, 50));
    expect(inner.sent[0].apply("ABCY")).toBe("XABCY");
  });
});
