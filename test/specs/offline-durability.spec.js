import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  IndexedDBStorageEngine,
  PyricSandboxAdapter,
} from "../../src/adapters/index.ts";
import { TextOperation } from "../../src/core/index.ts";

describe("Implement Offline IndexedDB Revision Queue Durability (Issue #7)", function () {
  beforeEach(function () {
    // Setup simulated browser IndexedDB runtime for test verification
    let storeData = {};
    globalThis.indexedDB = {
      open: function (dbName, version) {
        const req = { onsuccess: null, onerror: null, onupgradeneeded: null };
        queueMicrotask(function () {
          const mockDB = {
            objectStoreNames: { contains: function () { return true; } },
            createObjectStore: function () {},
            transaction: function (stores, mode) {
              const tx = {
                objectStore: function (name) {
                  return {
                    get: function (key) {
                      const r = { result: storeData[key] || null, onsuccess: null };
                      queueMicrotask(function () { if (r.onsuccess) r.onsuccess({ target: r }); });
                      return r;
                    },
                    put: function (val, key) {
                      storeData[key] = val;
                      const r = { onsuccess: null };
                      queueMicrotask(function () { if (r.onsuccess) r.onsuccess({ target: r }); });
                      return r;
                    },
                    delete: function (key) {
                      delete storeData[key];
                      const r = { onsuccess: null };
                      queueMicrotask(function () { if (r.onsuccess) r.onsuccess({ target: r }); });
                      return r;
                    },
                    clear: function () {
                      storeData = {};
                      const r = { onsuccess: null };
                      queueMicrotask(function () { if (r.onsuccess) r.onsuccess({ target: r }); });
                      return r;
                    },
                    getAllKeys: function () {
                      const r = { result: Object.keys(storeData), onsuccess: null };
                      queueMicrotask(function () { if (r.onsuccess) r.onsuccess({ target: r }); });
                      return r;
                    },
                    getAll: function () {
                      const vals = Object.keys(storeData).map(function (k) { return storeData[k]; });
                      const r = { result: vals, onsuccess: null };
                      queueMicrotask(function () { if (r.onsuccess) r.onsuccess({ target: r }); });
                      return r;
                    },
                  };
                },
                oncomplete: null,
                onerror: null,
              };
              queueMicrotask(function () {
                queueMicrotask(function () {
                  if (tx.oncomplete) tx.oncomplete();
                });
              });
              return tx;
            },
          };
          if (req.onupgradeneeded) req.onupgradeneeded({ target: { result: mockDB } });
          if (req.onsuccess) {
            req.onsuccess({ target: { result: mockDB } });
          }
        });
        return req;
      },
    };
  });

  afterEach(function () {
    delete globalThis.indexedDB;
  });

  it("Backs offline snapshots with an asynchronous IndexedDB key-value storage layer", async function () {
    const engine = new IndexedDBStorageEngine("test_idb", "revisions");
    await engine.put("doc:unsaved", { revision: 1, sent: [3, "x"] });
    expect(await engine.get("doc:unsaved")).toEqual({ revision: 1, sent: [3, "x"] });
    expect(Object.keys(await engine.getAll())).toEqual(["doc:unsaved"]);
    await engine.delete("doc:unsaved");
    expect(await engine.get("doc:unsaved")).toBeNull();
  });
});

function makeFakeRef(opts) {
  opts = opts || {};
  const ref = {
    root: null,
    child: function () { return ref; },
    on: function () {},
    once: function () {},
    off: function () {},
    set: async function () {},
    remove: async function () {},
    onDisconnect: function () { return { remove: async function () {} }; },
    transaction: function (update, onComplete) {
      if (opts.onTransaction) opts.onTransaction(update, onComplete);
    },
  };
  return ref;
}

function settledState(promise) {
  let state = "pending";
  promise.then(
    function () { state = "resolved"; },
    function () { state = "rejected"; },
  );
  return function () { return state; };
}

async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe("AbstractSyncAdapter.commitOperation always settles (C5a, A6)", function () {
  it("rejects a commit that is waiting for readiness when the adapter is disposed", async function () {
    const adapter = new PyricSandboxAdapter(makeFakeRef(), "u1");
    const p = adapter.commitOperation(new TextOperation().insert("x"), "u1");
    const state = settledState(p);
    await flush();
    expect(state()).toBe("pending");

    await adapter.dispose();
    await flush();
    expect(state()).toBe("rejected");
    await expect(p).rejects.toThrow(/disposed/);
  });

  it("rejects a commit parked on 'retry' when the adapter is disposed and drops its listeners", async function () {
    const completions = [];
    const adapter = new PyricSandboxAdapter(
      makeFakeRef({ onTransaction: function (_u, done) { completions.push(done); } }),
      "u1",
    );
    adapter.ready = true;
    const p = adapter.commitOperation(new TextOperation().insert("x"), "u1");
    const state = settledState(p);
    completions[0](null, false);
    await flush();
    expect(state()).toBe("pending");

    await adapter.dispose();
    await flush();
    expect(state()).toBe("rejected");
    expect(Object.keys(adapter.listeners).length).toBe(0);
  });

  it("re-attempts on 'retry' with exponential backoff and rejects after maxRetries", async function () {
    const completions = [];
    const adapter = new PyricSandboxAdapter(
      makeFakeRef({ onTransaction: function (_u, done) { completions.push(done); } }),
      "u1",
    );
    adapter.ready = true;
    const scheduled = [];
    adapter.retryPolicy = {
      maxRetries: 3,
      baseDelayMs: 50,
      schedule: function (fn, ms) {
        scheduled.push({ fn: fn, ms: ms });
      },
    };

    const p = adapter.commitOperation(new TextOperation().insert("x"), "u1");
    const state = settledState(p);

    for (let attempt = 0; attempt < 3; attempt++) {
      completions[attempt](null, false);
      adapter.trigger("retry");
      expect(scheduled.length).toBe(attempt + 1);
      scheduled[attempt].fn();
    }
    expect(scheduled.map(function (s) { return s.ms; })).toEqual([50, 100, 200]);
    expect(completions.length).toBe(4);

    completions[3](null, false);
    adapter.trigger("retry");
    await flush();
    expect(scheduled.length).toBe(3);
    expect(state()).toBe("rejected");
    await expect(p).rejects.toThrow(/retries/);
    await adapter.dispose();
  });

  it("resolves when a backed-off retry commits", async function () {
    const completions = [];
    const adapter = new PyricSandboxAdapter(
      makeFakeRef({ onTransaction: function (_u, done) { completions.push(done); } }),
      "u1",
    );
    adapter.ready = true;
    const scheduled = [];
    adapter.retryPolicy = {
      maxRetries: 3,
      baseDelayMs: 10,
      schedule: function (fn, ms) { scheduled.push({ fn: fn, ms: ms }); },
    };
    const p = adapter.commitOperation(new TextOperation().insert("x"), "u1");
    completions[0](null, false);
    adapter.trigger("retry");
    scheduled[0].fn();
    completions[1](null, true);
    const ack = await p;
    expect(ack.committed).toBe(true);
    await adapter.dispose();
  });
});

describe("TextOperation.fromJSON input validation", function () {
  it("throws on non-array input instead of returning an empty op", function () {
    expect(function () { TextOperation.fromJSON({ invalid_op: true }); }).toThrow();
    expect(function () { TextOperation.fromJSON(null); }).toThrow();
    expect(function () { TextOperation.fromJSON("abc"); }).toThrow();
    expect(TextOperation.fromJSON([3, "x"]).toJSON()).toEqual([3, "x"]);
  });
});
