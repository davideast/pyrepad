import { describe, it, expect } from "bun:test";
import {
  OfflineDurableAdapter,
  IndexedDBAdapter,
  OfflineRevisionQueue,
  InMemoryStorageEngine,
  IndexedDBStorageEngine,
} from "../../src/adapters/index.ts";
import { TextOperation } from "../../src/core/index.ts";

describe("Implement Offline IndexedDB Revision Queue Durability (Issue #7)", function () {
  it("Backs pending operation typing queues with an asynchronous key-value storage layer", async function () {
    var engine = new InMemoryStorageEngine();
    var queue = new OfflineRevisionQueue("doc-queue-test", engine);

    var op1 = new TextOperation().insert("Hello offline world");
    var op2 = new TextOperation().retain(19).insert("!");

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

  it("Confirms edits typed while disconnected survive accidental browser refreshes and commit cleanly when connection resolves", async function () {
    var committedToServer = [];
    var isOnline = false;
    var currentServerRev = 100;

    var mockNetwork = {
      operations: {
        [Symbol.asyncIterator]: async function* () {},
        subscribe: function () { return function () {}; },
      },
      presence: { [Symbol.asyncIterator]: async function* () {} },
      agentive: { [Symbol.asyncIterator]: async function* () {} },
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

    // Shared simulated IndexedDB storage engine across simulated browser refresh sessions
    var persistentStorage = new InMemoryStorageEngine();

    // Session 1: Client types edits while network connection is dropped/offline
    var adapterSession1 = new OfflineDurableAdapter(mockNetwork, persistentStorage, "shared-doc");
    var offlineOp = new TextOperation().insert("Offline typed text");
    var ack1 = await adapterSession1.commitOperation(offlineOp, "Bob");

    expect(ack1.committed).toBe(false);
    expect(committedToServer.length).toBe(0);
    expect(await adapterSession1.queue.count()).toBe(1);

    // Simulate accidental browser refresh by disposing Session 1 and rebooting Session 2 against persistent storage
    await adapterSession1.dispose();

    var adapterSession2 = new IndexedDBAdapter(mockNetwork, persistentStorage, "shared-doc");
    expect(await adapterSession2.queue.count()).toBe(1);

    // Network connection resolves and reconnects!
    isOnline = true;
    var reconciledCount = await adapterSession2.reconcile();

    expect(reconciledCount).toBe(1);
    expect(committedToServer.length).toBe(1);
    expect(committedToServer[0].author).toBe("Bob");
    expect(committedToServer[0].op.toJSON()).toEqual(offlineOp.toJSON());
    expect(await adapterSession2.queue.count()).toBe(0);

    await adapterSession2.dispose();
  });

  it("Verifies automatic rollback and OT rebase resolution against canonical tree state upon network recovery", async function () {
    var committedOps = [];
    var currentServerRev = 200;

    var mockNetwork = {
      operations: {
        [Symbol.asyncIterator]: async function* () {},
        subscribe: function () { return function () {}; },
      },
      presence: { [Symbol.asyncIterator]: async function* () {} },
      agentive: { [Symbol.asyncIterator]: async function* () {} },
      commitOperation: async function (op, author) {
        currentServerRev++;
        committedOps.push(op);
        return { revision: currentServerRev, committed: true };
      },
      broadcastPresence: async function () {},
      broadcastAgentive: async function () {},
      dispose: async function () {},
    };

    var persistentStorage = new InMemoryStorageEngine();
    var adapter = new OfflineDurableAdapter(mockNetwork, persistentStorage, "rebase-doc");

    // Local user offline edit: insert 'local ' at index 0 of "original text" (length 13) -> length 19
    var localOp = new TextOperation().insert("local ").retain(13);
    await adapter.queue.enqueue(200, localOp, "Alice");

    // Concurrent canonical remote edit received upon connection recovery: insert 'remote ' at index 0
    var canonicalRemoteOp = new TextOperation().insert("remote ").retain(13);

    // Reconcile pending queue against canonical remote edits using automatic OT transformation
    var reconciledCount = await adapter.reconcile([canonicalRemoteOp]);
    expect(reconciledCount).toBe(1);
    expect(committedOps.length).toBe(1);

    // Proof of OT rebase: local edit is transformed across 'remote ' insertion (insert 'local ', retain 20)
    var committedOp = committedOps[0];
    expect(committedOp.ops[0].text).toBe("local "); // Preserves local insertion
    expect(committedOp.ops[1].chars || committedOp.ops[1]).toBe(20); // Rebased retain tail expanded from 13 to 20 to cover the 7 canonical chars inserted by remote

    await adapter.dispose();
  });
});
