import { describe, it, expect } from "bun:test";
import {
  HistoryStreamHandler,
  revisionToId,
} from "../../src/adapters/streams/history-stream.ts";
import { TextOperation } from "../../src/core/index.ts";

// Minimal fake ref: supports child('history'), on/off('child_added'),
// child(key).transaction (commits then emits child_added), once('value').
function createFakeRef() {
  const store = {};
  let listeners = [];

  function snap(key, val) {
    return {
      key: key,
      val: function () {
        return val;
      },
    };
  }

  function emit(key) {
    listeners.slice().forEach(function (fn) {
      fn(snap(key, store[key]));
    });
  }

  const historyRef = {
    on: function (event, fn) {
      if (event === "child_added") listeners.push(fn);
    },
    off: function () {
      listeners = [];
    },
    once: function (event, fn) {
      fn(snap("history", Object.assign({}, store)));
    },
    child: function (key) {
      return {
        transaction: function (update, onComplete) {
          const next = update(store[key] === undefined ? null : store[key]);
          if (next === undefined) {
            onComplete(null, false);
            return;
          }
          store[key] = next;
          onComplete(null, true);
          emit(key);
        },
      };
    },
  };

  return {
    store: store,
    // Simulates another client's write that lands first and is delivered later.
    seedSilently: function (key, val) {
      store[key] = val;
    },
    deliver: emit,
    child: function (name) {
      if (name === "history") return historyRef;
      throw new Error("unexpected child " + name);
    },
  };
}

function createHarness(ref, userId) {
  const calls = { operation: [], ack: 0, retry: 0 };
  const handler = new HistoryStreamHandler(ref, {
    onOperation: function (op) {
      calls.operation.push(op);
    },
    onAck: function () {
      calls.ack++;
    },
    onRetry: function () {
      calls.retry++;
    },
    getUserId: function () {
      return userId;
    },
    isReady: function () {
      return true;
    },
  });
  return { handler: handler, calls: calls };
}

describe("HistoryStreamHandler ack (C2)", function () {
  it("acks the client's own committed operation instead of echoing it as remote", function () {
    const ref = createFakeRef();
    const h = createHarness(ref, "me");
    h.handler.startMonitoring();

    let committed = null;
    h.handler.sendOperation(
      new TextOperation().insert("hello"),
      "me",
      function (err, ok) {
        committed = ok;
      },
    );

    expect(committed).toBe(true);
    expect(h.calls.ack).toBe(1);
    expect(h.calls.operation.length).toBe(0);
    expect(h.calls.retry).toBe(0);
    expect(h.handler.getRevision()).toBe(1);
  });

  it("acks consecutive own operations at successive revisions", function () {
    const ref = createFakeRef();
    const h = createHarness(ref, "me");
    h.handler.startMonitoring();

    h.handler.sendOperation(new TextOperation().insert("a"), "me");
    h.handler.sendOperation(new TextOperation().retain(1).insert("b"), "me");

    expect(h.calls.ack).toBe(2);
    expect(h.calls.operation.length).toBe(0);
    expect(h.handler.getRevision()).toBe(2);
  });

  it("does not ack a remote operation that wins the same revision", function () {
    const ref = createFakeRef();
    const h = createHarness(ref, "me");
    h.handler.startMonitoring();

    const remoteOp = new TextOperation().insert("remote");
    ref.seedSilently(revisionToId(0), {
      a: "other",
      o: remoteOp.toJSON(),
      t: 1,
    });

    let committed = null;
    h.handler.sendOperation(
      new TextOperation().insert("mine"),
      "me",
      function (err, ok) {
        committed = ok;
      },
    );
    expect(committed).toBe(false);

    ref.deliver(revisionToId(0));

    expect(h.calls.ack).toBe(0);
    expect(h.calls.operation.length).toBe(1);
    expect(h.calls.operation[0].equals(remoteOp)).toBe(true);
    expect(h.calls.retry).toBe(1);
    expect(h.handler.getRevision()).toBe(1);
  });

  it("composes startup history once, then acks the next own operation", function () {
    const ref = createFakeRef();
    const h = createHarness(ref, "me");
    const first = new TextOperation().insert("seed");
    const second = new TextOperation().retain(4).insert("!");
    ref.seedSilently(revisionToId(0), { a: "seed", o: first.toJSON(), t: 1 });
    ref.seedSilently(revisionToId(1), { a: "seed", o: second.toJSON(), t: 2 });

    const pushes = [];
    h.handler.stream.subscribe(function (ev) {
      pushes.push(ev);
    });

    ref.child("history").once("value", function (snap) {
      h.handler.composeInitialRevisions(snap);
    });
    h.handler.startMonitoring();

    const startupPushes = pushes.filter(function (ev) {
      return ev.author === "atomic-startup";
    });
    expect(startupPushes.length).toBe(1);
    expect(h.calls.operation.length).toBe(1);
    expect(h.handler.getRevision()).toBe(2);

    h.handler.sendOperation(new TextOperation().retain(5).insert("?"), "me");

    expect(h.calls.ack).toBe(1);
    expect(h.calls.operation.length).toBe(1);
    expect(h.handler.getRevision()).toBe(3);
  });
});

describe("HistoryStreamHandler rejects malformed history (item 3)", function () {
  const ins = (text, retain = 0) => {
    const op = new TextOperation();
    if (retain) op.retain(retain);
    return op.insert(text);
  };
  function errorsOf(handler) {
    const errors = [];
    handler.errors.subscribe(function (e) {
      errors.push(e);
    });
    return errors;
  }

  it("skips an undecodable live entry, reports it, and keeps applying later ones", function () {
    const ref = createFakeRef();
    const h = createHarness(ref, "me");
    const errors = errorsOf(h.handler);
    h.handler.startMonitoring();
    ref.seedSilently(revisionToId(0), { a: "peer", o: ins("AB").toJSON() });
    ref.deliver(revisionToId(0));
    ref.seedSilently(revisionToId(1), { a: "evil", o: ["not", "an", "op"] });
    expect(function () {
      ref.deliver(revisionToId(1));
    }).not.toThrow();
    ref.seedSilently(revisionToId(2), { a: "peer", o: ins("C", 2).toJSON() });
    ref.deliver(revisionToId(2));

    expect(
      h.calls.operation.map(function (op) {
        return op.toJSON();
      }),
    ).toEqual([ins("AB").toJSON(), ins("C", 2).toJSON()]);
    expect(h.handler.getRevision()).toBe(3);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ kind: "invalid-operation", revision: 1 });
  });

  it("skips a live entry whose base length does not match the document", function () {
    const ref = createFakeRef();
    const h = createHarness(ref, "me");
    const errors = errorsOf(h.handler);
    h.handler.startMonitoring();
    ref.seedSilently(revisionToId(0), { a: "peer", o: ins("AB").toJSON() });
    ref.deliver(revisionToId(0));
    ref.seedSilently(revisionToId(1), { a: "evil", o: ins("X", 10).toJSON() });
    ref.deliver(revisionToId(1));

    expect(h.calls.operation).toHaveLength(1);
    expect(errors[0]).toMatchObject({ kind: "invalid-operation", revision: 1 });
  });

  it("skips a malformed entry in the initial history and reports it", function () {
    const ref = createFakeRef();
    const h = createHarness(ref, "me");
    const errors = errorsOf(h.handler);
    ref.seedSilently(revisionToId(0), { a: "peer", o: ins("AB").toJSON() });
    ref.seedSilently(revisionToId(1), { a: "evil", o: ins("X", 10).toJSON() });
    ref.seedSilently(revisionToId(2), { a: "peer", o: ins("C", 2).toJSON() });
    ref.child("history").once("value", function (snap) {
      h.handler.composeInitialRevisions(snap);
    });

    expect(h.calls.operation).toHaveLength(1);
    expect(h.calls.operation[0].apply("")).toBe("ABC");
    expect(h.handler.getRevision()).toBe(3);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ kind: "invalid-operation", revision: 1 });
  });

  it("treats an invalid entry at its own revision as a lost race, not a remote op", function () {
    const ref = createFakeRef();
    const h = createHarness(ref, "me");
    h.handler.startMonitoring();
    ref.seedSilently(revisionToId(0), { a: "evil", o: ins("X", 10).toJSON() });
    h.handler.sendOperation(ins("me"), "me");
    ref.deliver(revisionToId(0));

    expect(h.calls.retry).toBe(1);
    expect(h.calls.operation).toHaveLength(0);
  });
});
