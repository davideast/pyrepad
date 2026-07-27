import { describe, it, expect } from "bun:test";
import { PyricSandboxAdapter } from "../../src/adapters/index.ts";
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
