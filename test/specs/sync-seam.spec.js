import { describe, it, expect } from "bun:test";
import * as Adapters from "../../src/adapters/index.ts";
import { TextOperation, Cursor } from "../../src/core/index.ts";

const { PyricSandboxAdapter } = Adapters;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// A1: `firepad.SyncSeam` is the esbuild IIFE of src/adapters (dist/seam.iife.js),
// loaded by test/setup-globals.js exactly as tools/bundle.js prepends it.
describe("firepad.SyncSeam is the bundled src/adapters seam (A1)", function () {
  const seam = globalThis.firepad.SyncSeam;

  it("exposes every src/adapters export under the same name and kind", function () {
    const missing = Object.keys(Adapters).filter(
      (name) => typeof seam[name] !== typeof Adapters[name],
    );
    expect(missing).toEqual([]);
  });

  it("builds adapters with the src prototype surface", function () {
    const srcMethods = Object.getOwnPropertyNames(
      Adapters.AbstractSyncAdapter.prototype,
    ).sort();
    const globalMethods = Object.getOwnPropertyNames(
      seam.AbstractSyncAdapter.prototype,
    ).sort();
    expect(globalMethods).toEqual(srcMethods);
    expect(new seam.PyricSandboxAdapter(null)).toBeInstanceOf(
      seam.AbstractSyncAdapter,
    );
  });

  it("shares the history wire format with src", function () {
    expect(seam.revisionToId(37)).toBe(Adapters.revisionToId(37));
  });
});

describe("PyricSandboxAdapter (src)", function () {
  const PyricSandbox = globalThis.firepad.PyricSandbox;

  it("Initializes with reactive streams for operations, presence, and agentive", async function () {
    const db = PyricSandbox.createDatabase();
    const adapter = new PyricSandboxAdapter(db.ref("/test-seam"), "user-A", "#00ff00");

    expect(typeof adapter.operations.subscribe).toBe("function");
    expect(typeof adapter.presence.subscribe).toBe("function");
    expect(typeof adapter.agentive.subscribe).toBe("function");
    expect(typeof adapter.commitOperation).toBe("function");
    expect(typeof adapter.broadcastPresence).toBe("function");
    expect(typeof adapter.broadcastAgentive).toBe("function");

    await adapter.whenReady();
    await adapter.dispose();
  });

  it("Handles commitOperation and streams operation events", async function () {
    const db = PyricSandbox.createDatabase();
    const ref = db.ref("/test-ops");
    const adapterA = new PyricSandboxAdapter(ref, "user-A", "#ff0000");
    const adapterB = new PyricSandboxAdapter(ref, "user-B", "#0000ff");
    await Promise.all([adapterA.whenReady(), adapterB.whenReady()]);

    let receivedB = null;
    const unsub = adapterB.operations.subscribe((evt) => {
      receivedB = evt;
    });

    const ack = await adapterA.commitOperation(new TextOperation().insert("Hello Seam!"));
    expect(ack.committed).toBe(true);
    expect(ack.revision).toBe(1);

    await delay(20);
    expect(receivedB).not.toBeNull();
    expect(receivedB.author).toBe("user-A");
    expect(receivedB.operation.ops[0].text).toBe("Hello Seam!");

    unsub();
    await adapterA.dispose();
    await adapterB.dispose();
  });

  it("Handles broadcastPresence and streams cursor updates", async function () {
    const db = PyricSandbox.createDatabase();
    const ref = db.ref("/test-cursor");
    const adapterA = new PyricSandboxAdapter(ref, "user-A", "#ff0000");
    const adapterB = new PyricSandboxAdapter(ref, "user-B", "#0000ff");
    await Promise.all([adapterA.whenReady(), adapterB.whenReady()]);

    let cursorB = null;
    adapterB.presence.subscribe((evt) => {
      if (evt.userId === "user-A") cursorB = evt;
    });

    await adapterA.broadcastPresence(new Cursor(0, 5));
    await delay(30);
    expect(cursorB).not.toBeNull();
    expect(cursorB.color).toBe("#ff0000");
    expect(cursorB.cursor.position).toBe(0);

    await adapterA.dispose();
    await adapterB.dispose();
  });

  it("Handles broadcastAgentive and streams agent status and ghost diffs", async function () {
    const db = PyricSandbox.createDatabase();
    const ref = db.ref("/test-agentive");
    const adapterA = new PyricSandboxAdapter(ref, "user-A", "#ff0000");
    const adapterB = new PyricSandboxAdapter(ref, "user-B", "#0000ff");
    await Promise.all([adapterA.whenReady(), adapterB.whenReady()]);

    let agentEvent = null;
    adapterB.agentive.subscribe((evt) => {
      agentEvent = evt;
    });

    await adapterA.broadcastAgentive({
      agentId: "agent-777",
      status: "thinking",
      ghostDiff: null,
      explanation: "Analyzing code structure",
    });
    await delay(30);
    expect(agentEvent).not.toBeNull();
    expect(agentEvent.agentId).toBe("agent-777");
    expect(agentEvent.status).toBe("thinking");
    expect(agentEvent.explanation).toBe("Analyzing code structure");

    await adapterA.dispose();
    await adapterB.dispose();
  });
});
