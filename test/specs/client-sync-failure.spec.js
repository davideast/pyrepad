import { describe, expect, test } from "bun:test";
import { ClientSyncAdapter } from "../../src/adapters/client-sync-adapter.ts";
import { ReactiveStream } from "../../src/adapters/reactive-stream.ts";
import { Emitter } from "../../src/core/emitter.ts";
import { TextOperation } from "../../src/core/index.ts";

class FakeInner extends Emitter {
  operations = new ReactiveStream();
  commitDelayMs = 0;
  sent = [];
  sendOperation(op, callback) {
    this.sent.push({ op, callback });
  }
  whenReady() {
    return Promise.resolve();
  }
  isHistoryEmpty() {
    return false;
  }
  /** A revision written by someone else (or the composed initial document). */
  remote(op, revision) {
    this.operations.push({
      revision,
      operation: op,
      author: "peer",
      timestamp: 0,
    });
    this.trigger("operation", op);
  }
}

const insertAt = (pos, len, text) => {
  const op = new TextOperation();
  if (pos) op.retain(pos);
  op.insert(text);
  if (len - pos) op.retain(len - pos);
  return op;
};
const deleteAt = (pos, count, len) => {
  const op = new TextOperation();
  if (pos) op.retain(pos);
  op.delete(count);
  if (len - pos - count) op.retain(len - pos - count);
  return op;
};

/** Mirrors what an editor bound to `client` would show. */
function editor(client, initial = "") {
  const view = { text: initial };
  client.operations.subscribe((e) => {
    view.text = e.operation.apply(view.text);
  });
  return view;
}

describe("ClientSyncAdapter when a write fails", () => {
  test("rolls the editor back to the last server text, including buffered edits", async () => {
    const inner = new FakeInner();
    const client = new ClientSyncAdapter(inner);
    const view = editor(client);
    inner.remote(insertAt(0, 0, "ABC"), 1);
    expect(view.text).toBe("ABC");

    const local = (op) => {
      view.text = op.apply(view.text);
      return client.commitOperation(op);
    };
    const first = local(insertAt(0, 3, "X")); // "XABC", in flight
    const second = local(deleteAt(1, 2, 4)); // "XC", buffered
    expect(view.text).toBe("XC");

    inner.sent[0].callback(new Error("permission_denied"));
    await expect(first).rejects.toThrow("permission_denied");
    await expect(second).rejects.toThrow("permission_denied");
    expect(view.text).toBe("ABC");
  });

  test("reports the failure on `errors` with the dropped operation", async () => {
    const inner = new FakeInner();
    const client = new ClientSyncAdapter(inner);
    const view = editor(client);
    const errors = [];
    client.errors.subscribe((e) => errors.push(e));
    inner.remote(insertAt(0, 0, "AB"), 1);

    view.text = "ABZ";
    const commit = client.commitOperation(insertAt(2, 2, "Z"));
    inner.sent[0].callback(new Error("permission_denied"));
    await expect(commit).rejects.toThrow();

    expect(errors).toHaveLength(1);
    expect(errors[0].kind).toBe("commit-failed");
    expect(errors[0].cause.message).toBe("permission_denied");
    expect(errors[0].operation.apply("AB")).toBe("ABZ");
  });

  test("later edits are based on the server text again", async () => {
    const inner = new FakeInner();
    const client = new ClientSyncAdapter(inner);
    const view = editor(client);
    inner.remote(insertAt(0, 0, "AB"), 1);
    view.text = "XAB";
    const failed = client.commitOperation(insertAt(0, 2, "X"));
    inner.sent[0].callback(new Error("denied"));
    await expect(failed).rejects.toThrow();

    view.text = insertAt(2, 2, "!").apply(view.text);
    void client.commitOperation(insertAt(2, 2, "!"));
    expect(view.text).toBe("AB!");
    expect(inner.sent[1].op.apply("AB")).toBe("AB!");
  });

  test("a remote op that lands before the failure is kept", async () => {
    const inner = new FakeInner();
    const client = new ClientSyncAdapter(inner);
    const view = editor(client);
    inner.remote(insertAt(0, 0, "AB"), 1);
    view.text = "ABx";
    const failed = client.commitOperation(insertAt(2, 2, "x"));
    inner.remote(insertAt(0, 2, ">"), 2);
    expect(view.text).toBe(">ABx");
    inner.sent[0].callback(new Error("denied"));
    await expect(failed).rejects.toThrow();
    expect(view.text).toBe(">AB");
  });
});
