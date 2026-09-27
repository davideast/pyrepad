import { describe, it, expect } from "bun:test";
import {
  PyricSandboxAdapter,
  FirebaseAdapter,
  FirebaseModularAdapter,
  SharedWorkerAdapter,
  OfflineDurableAdapter,
  IndexedDBAdapter,
  InMemoryStorageEngine,
  IndexedDBStorageEngine,
} from "../../src/adapters/index.ts";
import { TextOperation, Cursor } from "../../src/core/index.ts";

function verifySyncAdapterContract(adapterName, createAdapter) {
  describe("Tier B Pluggable Seam Contract (" + adapterName + ")", function () {
    var PyricSandbox = globalThis.firepad && globalThis.firepad.PyricSandbox;

    it("Enforces deterministic start-up synchronization by atomically composing existing history snapshots before emitting ready events", async function () {
      var db = PyricSandbox.createDatabase();
      var ref = db.ref("/test-atomic-startup");

      var initialOp = new TextOperation().insert("Initial text");
      ref.child("history/A0").set({
        a: "seed",
        o: initialOp.toJSON(),
        t: Date.now() - 1000,
      });
      var secondOp = new TextOperation().retain(12).insert(" from seed");
      ref.child("history/A1").set({
        a: "seed",
        o: secondOp.toJSON(),
        t: Date.now() - 500,
      });

      var callbackOperationsReceived = 0;
      var streamOperationsReceived = 0;
      var readyEmitted = false;

      var adapter = createAdapter(ref, "client-latecomer", "#00ff00");
      var unsubStream = adapter.operations.subscribe(function (evt) {
        streamOperationsReceived++;
        expect(evt.operation.toString()).toBe("insert 'Initial text from seed'");
      });

      await new Promise(function (resolve) {
        adapter.on("operation", function (doc) {
          callbackOperationsReceived++;
          expect(readyEmitted).toBe(false);
          expect(doc.toString()).toBe("insert 'Initial text from seed'");
        });
        adapter.on("ready", function () {
          readyEmitted = true;
          resolve();
        });
      });

      expect(callbackOperationsReceived).toBe(1);
      expect(streamOperationsReceived).toBe(1);
      expect(readyEmitted).toBe(true);
      unsubStream();
      await adapter.dispose();
    });

    it("Confirms bidirectional burst typing without buffer lockups or duplication across live sandbox connections", async function () {
      var db = PyricSandbox.createDatabase();
      var ref = db.ref("/test-bidirectional-burst");

      var adapterA = createAdapter(ref, "author-A", "#ff0000");
      var adapterB = createAdapter(ref, "author-B", "#0000ff");

      await new Promise((r) => setTimeout(r, 20));

      var bReceivedFromA = [];
      var aReceivedFromB = [];

      var unsubB = adapterB.operations.subscribe((evt) => {
        if (evt.author === "author-A") bReceivedFromA.push(evt.operation);
      });
      var unsubA = adapterA.operations.subscribe((evt) => {
        if (evt.author === "author-B") aReceivedFromB.push(evt.operation);
      });

      var startTime = performance.now();
      var numOpsPerPeer = 15;

      // Execute interleaved bidirectional high-speed editing burst
      var docLength = 0;
      for (var i = 0; i < numOpsPerPeer; i++) {
        var opA = new TextOperation().retain(docLength).insert("A" + i);
        docLength += (("A" + i).length);
        await adapterA.commitOperation(opA, "author-A");

        var opB = new TextOperation().retain(docLength).insert("B" + i);
        docLength += (("B" + i).length);
        await adapterB.commitOperation(opB, "author-B");
      }

      await new Promise((resolve) => {
        var interval = setInterval(() => {
          if (
            bReceivedFromA.length >= numOpsPerPeer &&
            aReceivedFromB.length >= numOpsPerPeer
          ) {
            clearInterval(interval);
            resolve();
          }
        }, 5);
      });
      var duration = performance.now() - startTime;

      expect(bReceivedFromA.length).toBe(numOpsPerPeer);
      expect(aReceivedFromB.length).toBe(numOpsPerPeer);
      expect(duration).toBeLessThan(1500);

      unsubA();
      unsubB();
      await adapterA.dispose();
      await adapterB.dispose();
    });

    it("Segregates protocol streams for document history, user presence, and AI tentative ghost diffs across peer connections", async function () {
      var db = PyricSandbox.createDatabase();
      var ref = db.ref("/test-peer-stream-segregation");

      var adapterA = createAdapter(ref, "peer-Alice", "#ff0000");
      var adapterB = createAdapter(ref, "peer-Bob", "#0000ff");

      await new Promise((r) => setTimeout(r, 20));

      var streamEventsB = { ops: 0, presence: 0, agentive: 0 };
      var unsubOps = adapterB.operations.subscribe(() => streamEventsB.ops++);
      var unsubPres = adapterB.presence.subscribe(
        () => streamEventsB.presence++,
      );
      var unsubAgent = adapterB.agentive.subscribe(
        () => streamEventsB.agentive++,
      );

      await adapterA.broadcastPresence(new Cursor(5, 10));
      await adapterA.broadcastAgentive(
        "ai-agent-1",
        "suggesting",
        new TextOperation().insert("AI Ghost Suggestion"),
        "Refactor helper",
      );

      await new Promise((resolve) => {
        var interval = setInterval(() => {
          if (streamEventsB.presence > 0 && streamEventsB.agentive > 0) {
            clearInterval(interval);
            resolve();
          }
        }, 5);
      });

      expect(streamEventsB.ops).toBe(0);
      expect(streamEventsB.presence).toBe(1);
      expect(streamEventsB.agentive).toBe(1);

      unsubOps();
      unsubPres();
      unsubAgent();
      await adapterA.dispose();
      await adapterB.dispose();
    });
  });
}

// Execute Tier B Pluggable Conformance Suite against our PyricSandboxAdapter implementation
verifySyncAdapterContract("PyricSandboxAdapter", function (ref, userId, color) {
  return new PyricSandboxAdapter(ref, userId, color);
});

// Execute Tier B Pluggable Conformance Suite against evergreen modular Firebase / Firestore implementations (Issue #12)
verifySyncAdapterContract("FirebaseAdapter", function (ref, userId, color) {
  return new FirebaseAdapter(ref, userId, color);
});

verifySyncAdapterContract("FirebaseModularAdapter (Alias)", function (ref, userId, color) {
  return new FirebaseModularAdapter(ref, userId, color);
});

// Modular (v9-style) bindings over the sandbox database. Targets are opaque boxes with no
// .child/.on methods, as real modular DatabaseReferences are (only `.root`), so every
// listener must be routed through the config's free functions.
function createModularConfig(sandboxRef) {
  function box(r) {
    return {
      __ref: r,
      get root() { return r.root ? box(r.root) : undefined; },
    };
  }
  function listen(event) {
    return function (target, cb) {
      target.__ref.on(event, cb);
      return function () { target.__ref.off(event, cb); };
    };
  }
  return {
    ref: box(sandboxRef),
    child: function (parent, path) { return box(parent.__ref.child(path)); },
    onValue: listen("value"),
    onChildAdded: listen("child_added"),
    onChildChanged: listen("child_changed"),
    onChildRemoved: listen("child_removed"),
    get: function (target) {
      return new Promise(function (resolve) { target.__ref.once("value", resolve); });
    },
    set: function (target, value) { return target.__ref.set(value); },
    remove: function (target) { return target.__ref.remove(); },
    runTransaction: function (target, update) {
      return new Promise(function (resolve, reject) {
        target.__ref.transaction(update, function (err, committed, snapshot) {
          if (err) reject(err);
          else resolve({ committed: committed, snapshot: snapshot });
        });
      });
    },
  };
}

verifySyncAdapterContract("FirebaseAdapter (modular config)", function (ref, userId, color) {
  return new FirebaseAdapter(createModularConfig(ref), userId, color);
});

// Execute Tier B Pluggable Conformance Suite against SharedWorker multi-tab environment driver (Issue #12)
verifySyncAdapterContract("SharedWorkerAdapter", function (ref, userId, color) {
  var mockPort = {
    postMessage: function () {},
    addEventListener: function () {},
    removeEventListener: function () {},
    close: function () {},
  };
  return new SharedWorkerAdapter(ref, userId, color, mockPort);
});

// Execute Tier B Pluggable Conformance Suite against Offline Durable IndexedDB implementations (Issue #7)
verifySyncAdapterContract("OfflineDurableAdapter", function (ref, userId, color) {
  var base = new PyricSandboxAdapter(ref, userId, color);
  return new OfflineDurableAdapter(base, new IndexedDBStorageEngine("conf_db_1", "conf_store"), "doc-conformance");
});

verifySyncAdapterContract("IndexedDBAdapter (Alias)", function (ref, userId, color) {
  var base = new PyricSandboxAdapter(ref, userId, color);
  return new IndexedDBAdapter(base, new IndexedDBStorageEngine("conf_db_2", "conf_store"), "doc-conformance");
});

describe("Modular Tree-Shakable Firebase Bindings (Issue #12)", function () {
  function snap(key, value) {
    return { key: key, val: function () { return value; } };
  }

  // A modular fake that records each registered listener per free function, keyed by
  // target path, and returns an unsubscribe that records its invocation.
  function createRecordingConfig() {
    var rec = {
      onValue: {},
      onChildAdded: {},
      onChildChanged: {},
      onChildRemoved: {},
      unsubscribed: [],
      getCalls: [],
    };
    function listen(name) {
      return function (target, cb) {
        rec[name][target.path] = cb;
        return function () { rec.unsubscribed.push(name + ":" + target.path); };
      };
    }
    var config = {
      ref: { path: "/doc" },
      child: function (parent, path) { return { path: parent.path + "/" + path }; },
      onValue: listen("onValue"),
      onChildAdded: listen("onChildAdded"),
      onChildChanged: listen("onChildChanged"),
      onChildRemoved: listen("onChildRemoved"),
      get: function (target) {
        rec.getCalls.push(target.path);
        return Promise.resolve(snap(target.path.split("/").pop(), { seeded: true }));
      },
      set: function () {},
      remove: function () {},
    };
    return { config: config, rec: rec };
  }

  function proxyFor(config) {
    var adapter = new FirebaseAdapter(config, "modular-client", "#eab308");
    return { adapter: adapter, ref: adapter.ref };
  }

  it("Routes child_added/changed/removed to the matching modular listener and delivers child snapshots with their keys", async function () {
    var fake = createRecordingConfig();
    var h = proxyFor(fake.config);
    var history = h.ref.child("history-probe");

    var added = [];
    var changed = [];
    var removed = [];
    history.on("child_added", function (s) { added.push([s.key, s.val()]); });
    history.on("child_changed", function (s) { changed.push([s.key, s.val()]); });
    history.on("child_removed", function (s) { removed.push([s.key, s.val()]); });

    expect(fake.rec.onValue["/doc/history-probe"]).toBeUndefined();
    fake.rec.onChildAdded["/doc/history-probe"](snap("A0", { a: "x" }));
    fake.rec.onChildChanged["/doc/history-probe"](snap("A0", { a: "y" }));
    fake.rec.onChildRemoved["/doc/history-probe"](snap("A0", null));

    expect(added).toEqual([["A0", { a: "x" }]]);
    expect(changed).toEqual([["A0", { a: "y" }]]);
    expect(removed).toEqual([["A0", null]]);
    await h.adapter.dispose();
  });

  it("off() invokes the unsubscribe functions returned by modular listeners, including from a fresh child proxy", async function () {
    var fake = createRecordingConfig();
    var h = proxyFor(fake.config);

    var received = [];
    var cb = function (s) { received.push(s.key); };
    h.ref.child("probe").on("child_added", cb);
    h.ref.child("probe").on("value", cb);

    h.ref.child("probe").off("child_added", cb);
    expect(fake.rec.unsubscribed).toEqual(["onChildAdded:/doc/probe"]);

    h.ref.child("probe").off();
    expect(fake.rec.unsubscribed).toEqual([
      "onChildAdded:/doc/probe",
      "onValue:/doc/probe",
    ]);
    await h.adapter.dispose();
  });

  it("once('value') maps to modular get() and delivers its snapshot", async function () {
    var fake = createRecordingConfig();
    var h = proxyFor(fake.config);

    var delivered = await new Promise(function (resolve) {
      h.ref.child("probe-once").once("value", resolve);
    });

    expect(fake.rec.getCalls).toContain("/doc/probe-once");
    expect(delivered.key).toBe("probe-once");
    expect(delivered.val()).toEqual({ seeded: true });
    expect(fake.rec.onValue["/doc/probe-once"]).toBeUndefined();
    await h.adapter.dispose();
  });

  it("Delivers seeded history through modular child listeners so the adapter reaches ready with the document", async function () {
    var db = globalThis.firepad.PyricSandbox.createDatabase();
    var ref = db.ref("/test-modular-seeded");
    ref.child("history/A0").set({
      a: "seed",
      o: new TextOperation().insert("hello").toJSON(),
      t: Date.now(),
    });

    var adapter = new FirebaseAdapter(createModularConfig(ref), "late", "#00ff00");
    var doc = await new Promise(function (resolve) {
      var seen = null;
      adapter.on("operation", function (op) { seen = op; });
      adapter.on("ready", function () { resolve(seen); });
    });
    expect(doc.toString()).toBe("insert 'hello'");

    var live = new Promise(function (resolve) {
      adapter.on("operation", function (op) { resolve(op.toString()); });
    });
    ref.child("history/A1").set({
      a: "other",
      o: new TextOperation().retain(5).insert("!").toJSON(),
      t: Date.now(),
    });
    expect(await live).toBe("retain 5, insert '!'");
    await adapter.dispose();
  });
});
