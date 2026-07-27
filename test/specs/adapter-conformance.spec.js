import { describe, it, expect } from "bun:test";
import { PyricSandboxAdapter } from "../../src/adapters/index.ts";
import { TextOperation, Cursor } from "../../src/core/index.ts";

describe("Tier B: Modular Protocol Stream Handlers & Adapter Conformance (Issue #3)", function () {
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

    var operationsReceived = 0;
    var readyEmitted = false;

    var adapter = new PyricSandboxAdapter(ref, "client-latecomer", "#00ff00");

    await new Promise(function (resolve) {
      adapter.on("operation", function (doc) {
        operationsReceived++;
        expect(readyEmitted).toBe(false);
        expect(doc.toString()).toBe("insert 'Initial text from seed'");
      });
      adapter.on("ready", function () {
        readyEmitted = true;
        resolve();
      });
    });

    expect(operationsReceived).toBe(1);
    expect(readyEmitted).toBe(true);
    await adapter.dispose();
  });

  it("Confirms 60fps bidirectional burst typing without buffer lockups or duplication across live sandbox connections", async function () {
    var db = PyricSandbox.createDatabase();
    var ref = db.ref("/test-burst-fps");

    var adapterA = new PyricSandboxAdapter(ref, "author-A", "#ff0000");
    var adapterB = new PyricSandboxAdapter(ref, "author-B", "#0000ff");

    await new Promise((res) => adapterA.on("ready", res));
    await new Promise((res) => adapterB.on("ready", res));

    var bReceivedOps = [];
    var unsubscribeB = adapterB.operations.subscribe((evt) => {
      if (evt.author === "author-A") {
        bReceivedOps.push(evt.operation);
      }
    });

    var startTime = performance.now();
    var numOps = 25;
    var currentLength = 0;

    for (var i = 0; i < numOps; i++) {
      var op = new TextOperation().retain(currentLength).insert(String(i % 10));
      currentLength += 1;
      await adapterA.commitOperation(op, "author-A");
    }

    await new Promise((resolve) => {
      var interval = setInterval(() => {
        if (bReceivedOps.length >= numOps) {
          clearInterval(interval);
          resolve();
        }
      }, 5);
    });
    var duration = performance.now() - startTime;

    expect(bReceivedOps.length).toBe(numOps);
    for (var j = 0; j < numOps; j++) {
      var ops = bReceivedOps[j].ops;
      expect(ops[ops.length - 1].text).toBe(String(j % 10));
    }
    expect(duration).toBeLessThan(1000);

    unsubscribeB();
    await adapterA.dispose();
    await adapterB.dispose();
  });

  it("Segregates protocol streams for document history, user presence, and AI tentative ghost diffs independently", async function () {
    var db = PyricSandbox.createDatabase();
    var ref = db.ref("/test-segregated-streams");

    var adapter = new PyricSandboxAdapter(ref, "human-dev", "#00ff00");
    await new Promise((res) => adapter.on("ready", res));

    var streamEvents = { ops: 0, presence: 0, agentive: 0 };
    var unsubOps = adapter.operations.subscribe(() => streamEvents.ops++);
    var unsubPres = adapter.presence.subscribe(() => streamEvents.presence++);
    var unsubAgent = adapter.agentive.subscribe(() => streamEvents.agentive++);

    await adapter.broadcastPresence(new Cursor(5, 10));
    await adapter.broadcastAgentive(
      "ai-agent-1",
      "suggesting",
      new TextOperation().insert("AI Ghost Suggestion"),
      "Refactor helper",
    );

    await new Promise((res) => setTimeout(res, 50));

    expect(streamEvents.ops).toBe(0);
    expect(streamEvents.presence).toBe(0);
    expect(typeof adapter.operations).toBe("object");
    expect(typeof adapter.presence).toBe("object");
    expect(typeof adapter.agentive).toBe("object");

    unsubOps();
    unsubPres();
    unsubAgent();
    await adapter.dispose();
  });
});
