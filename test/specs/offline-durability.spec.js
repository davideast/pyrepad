import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  OfflineDurableAdapter,
  IndexedDBAdapter,
  OfflineRevisionQueue,
  InMemoryStorageEngine,
  IndexedDBStorageEngine,
  SharedWorkerAdapter,
} from "../../src/adapters/index.ts";
import { TextOperation } from "../../src/core/index.ts";

describe("Implement Offline IndexedDB Revision Queue Durability (Issue #7)", function () {
  beforeEach(function () {
    // Setup simulated browser IndexedDB runtime for test verification
    var storeData = {};
    globalThis.indexedDB = {
      open: function (dbName, version) {
        var req = { onsuccess: null, onerror: null, onupgradeneeded: null };
        queueMicrotask(function () {
          var mockDB = {
            objectStoreNames: { contains: function () { return true; } },
            createObjectStore: function () {},
            transaction: function (stores, mode) {
              var tx = {
                objectStore: function (name) {
                  return {
                    get: function (key) {
                      var r = { result: storeData[key] || null, onsuccess: null };
                      queueMicrotask(function () { if (r.onsuccess) r.onsuccess({ target: r }); });
                      return r;
                    },
                    put: function (val, key) {
                      storeData[key] = val;
                      var r = { onsuccess: null };
                      queueMicrotask(function () { if (r.onsuccess) r.onsuccess({ target: r }); });
                      return r;
                    },
                    delete: function (key) {
                      delete storeData[key];
                      var r = { onsuccess: null };
                      queueMicrotask(function () { if (r.onsuccess) r.onsuccess({ target: r }); });
                      return r;
                    },
                    clear: function () {
                      storeData = {};
                      var r = { onsuccess: null };
                      queueMicrotask(function () { if (r.onsuccess) r.onsuccess({ target: r }); });
                      return r;
                    },
                    getAllKeys: function () {
                      var r = { result: Object.keys(storeData), onsuccess: null };
                      queueMicrotask(function () { if (r.onsuccess) r.onsuccess({ target: r }); });
                      return r;
                    },
                    getAll: function () {
                      var vals = Object.keys(storeData).map(function (k) { return storeData[k]; });
                      var r = { result: vals, onsuccess: null };
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

  it("Backs pending operation typing queues with an asynchronous IndexedDB key-value storage layer", async function () {
    var engine = new IndexedDBStorageEngine("test_idb", "revisions");
    var queue = new OfflineRevisionQueue("doc-idb-test", engine);

    var op1 = new TextOperation().insert("Hello offline IDB world");
    var op2 = new TextOperation().retain(23).insert("!");

    var id1 = await queue.enqueue(1, op1, "Alice");
    var id2 = await queue.enqueue(2, op2, "Alice");
    expect(typeof id1).toBe("string");
    expect(typeof id2).toBe("string");

    var count = await queue.count();
    expect(count).toBe(2);

    var pending = await queue.getPendingRevisions();
    expect(pending[0].author).toBe("Alice");
    expect(pending[0].operationJSON).toEqual(op1.toJSON());
    expect(pending[1].operationJSON).toEqual(op2.toJSON());

    await queue.dequeue(id1);
    expect(await queue.count()).toBe(1);

    await queue.clear();
    expect(await queue.count()).toBe(0);
    queue.dispose();
  });

  it("Confirms edits typed while disconnected survive accidental browser refreshes and commit cleanly upon automatic reconnection triggers", async function () {
    var committedToServer = [];
    var isOnline = false;
    var currentServerRev = 100;
    var listeners = {};

    var mockNetwork = {
      operations: {
        [Symbol.asyncIterator]: async function* () {},
        subscribe: function () { return function () {}; },
      },
      presence: { [Symbol.asyncIterator]: async function* () {} },
      agentive: { [Symbol.asyncIterator]: async function* () {} },
      on: function (evt, cb) {
        if (!listeners[evt]) listeners[evt] = [];
        listeners[evt].push(cb);
      },
      trigger: function (evt, ...args) {
        if (listeners[evt]) listeners[evt].forEach((cb) => cb(...args));
      },
      commitOperation: async function (op, author) {
        if (!isOnline) {
          throw new Error("Network offline disconnect");
        }
        currentServerRev++;
        committedToServer.push({ rev: currentServerRev, op: op, author: author });
        return { revision: currentServerRev, committed: true };
      },
      broadcastPresence: async function () {},
      broadcastAgentive: async function () {},
      dispose: async function () {},
    };

    var persistentIDB = new IndexedDBStorageEngine("persist_db", "store");

    // Session 1: Client types edits while network connection is dropped/offline
    var adapterSession1 = new OfflineDurableAdapter(mockNetwork, persistentIDB, "shared-doc");
    var offlineOp = new TextOperation().insert("Offline typed text");
    var ack1 = await adapterSession1.commitOperation(offlineOp, "Bob");

    expect(ack1.committed).toBe(false);
    expect(committedToServer.length).toBe(0);
    expect(await adapterSession1.queue.count()).toBe(1);

    // Simulate accidental browser refresh by disposing Session 1 and rebooting Session 2 against persistent IDB
    await adapterSession1.dispose();

    var adapterSession2 = new IndexedDBAdapter(mockNetwork, persistentIDB, "shared-doc");
    expect(await adapterSession2.queue.count()).toBe(1);

    // Network resolves: trigger automatic "ready" event from underlying network adapter without calling reconcile() manually!
    isOnline = true;
    mockNetwork.trigger("ready");

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(committedToServer.length).toBe(1);
    expect(committedToServer[0].author).toBe("Bob");
    expect(committedToServer[0].op.toJSON()).toEqual(offlineOp.toJSON());
    expect(await adapterSession2.queue.count()).toBe(0);

    await adapterSession2.dispose();
  });

  it("Verifies automatic rollback and multi-revision OT rebase resolution against canonical Pyric SharedWorker tree state upon recovery", async function () {
    var committedOps = [];
    var currentServerRev = 200;

    var mockPort = {
      postMessage: function () {},
      addEventListener: function () {},
      removeEventListener: function () {},
      close: function () {},
    };
    var workerAdapter = new SharedWorkerAdapter(null, "shared-worker-client", "#3b82f6", mockPort);

    // Override commitOperation to record actual canonical tree commits
    workerAdapter.commitOperation = async function (op, author) {
      currentServerRev++;
      committedOps.push(op);
      return { revision: currentServerRev, committed: true };
    };

    var persistentStorage = new IndexedDBStorageEngine("worker_idb", "store");
    var durableAdapter = new OfflineDurableAdapter(workerAdapter, persistentStorage, "worker-rebase-doc");

    // Allow any startup initialization events from SharedWorkerAdapter to settle before enqueuing offline edits
    await new Promise((resolve) => setTimeout(resolve, 20));
    committedOps = [];

    // Local offline edit: insert 'local ' at index 0 of canonical string (length 13) -> length 19
    var localOp = new TextOperation().insert("local ").retain(13);
    await durableAdapter.queue.enqueue(200, localOp, "Alice");

    // Concurrent canonical remote edit received over SharedWorker during disconnect: insert 'remote ' at index 0
    var canonicalRemoteOp = new TextOperation().insert("remote ").retain(13);

    // Automatically trigger recovery by reconciling against canonical SharedWorker remote edits
    var reconciledCount = await durableAdapter.reconcile([canonicalRemoteOp]);
    expect(reconciledCount).toBe(1);
    expect(committedOps.length).toBe(1);

    // Proof of multi-revision OT rebase: local edit is transformed across 'remote ' insertion (insert 'local ', retain 20)
    var committedOp = committedOps[0];
    expect(committedOp.ops[0].text).toBe("local "); // Preserves local insertion
    expect(committedOp.ops[1].chars || committedOp.ops[1]).toBe(20); // Rebased retain tail expanded from 13 to 20 to cover the 7 canonical chars inserted by remote

    // Proof of automatic rollback upon unresolvable conflict
    var corruptedOp = { invalid_op: true };
    var conflictId = await durableAdapter.queue.enqueue(202, corruptedOp, "Alice");
    expect(await durableAdapter.queue.count()).toBe(1);

    // Reconciling an unresolvable operation triggers automatic rollback removal from queue
    await durableAdapter.reconcile([canonicalRemoteOp]);
    expect(await durableAdapter.queue.count()).toBe(0); // Rollback cleanup complete

    await durableAdapter.dispose();
  });
});
