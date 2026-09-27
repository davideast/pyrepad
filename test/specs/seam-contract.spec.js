import { describe, it, expect, afterEach } from "bun:test";
import { renderHook, act, cleanup } from "@testing-library/react";
import { usePyrepadEditor } from "../../src/react/index.ts";
import {
  PyricSandboxAdapter,
  OfflineDurableAdapter,
  InMemoryStorageEngine,
  ReactiveStream,
} from "../../src/adapters/index.ts";
import { TextOperation } from "../../src/core/index.ts";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function freshRef(name) {
  const db = globalThis.firepad.PyricSandbox.createDatabase();
  return db.ref("/" + name + "-" + Math.random().toString(36).slice(2));
}

function readyOnce(adapter) {
  return new Promise((resolve) => adapter.once("ready", resolve));
}

describe("SyncSeam adapters emit the 'agentive' event (P8)", function () {
  it("an adapter's on('agentive') listener receives the event after broadcastAgentive", async function () {
    const adapter = new PyricSandboxAdapter(freshRef("agentive-evt"), "u1");
    await readyOnce(adapter);
    const received = [];
    adapter.on("agentive", (...args) => received.push(args));

    await adapter.broadcastAgentive({
      agentId: "agent-1",
      status: "thinking",
      ghostDiff: null,
      explanation: "Reading",
    });
    await wait(10);

    expect(received).toEqual([
      [
        {
          agentId: "agent-1",
          status: "thinking",
          ghostDiff: null,
          explanation: "Reading",
        },
      ],
    ]);
    await adapter.dispose();
  });
});

describe("SyncSeam readiness (D2)", function () {
  it("whenReady() resolves after the atomic-startup history push and isHistoryEmpty() flips accordingly", async function () {
    const ref = freshRef("ready");
    const writer = new PyricSandboxAdapter(ref, "writer");
    await writer.whenReady();
    expect(writer.isHistoryEmpty()).toBe(true);
    await writer.commitOperation(new TextOperation().insert("seed"), "writer");

    const reader = new PyricSandboxAdapter(ref, "reader");
    expect(() => reader.isHistoryEmpty()).toThrow();
    await reader.whenReady();
    expect(reader.isHistoryEmpty()).toBe(false);

    await reader.whenReady();
    await writer.dispose();
    await reader.dispose();
  });

  it("whenReady() rejects when the adapter is disposed before it becomes ready", async function () {
    const adapter = new PyricSandboxAdapter(freshRef("ready-dispose"), "u1");
    const ready = adapter.whenReady();
    await adapter.dispose();
    await expect(ready).rejects.toThrow(/disposed/);
  });

  it("OfflineDurableAdapter forwards whenReady() and isHistoryEmpty() to the network adapter", async function () {
    const ref = freshRef("ready-durable");
    const network = new PyricSandboxAdapter(ref, "u1");
    const durable = new OfflineDurableAdapter(
      network,
      new InMemoryStorageEngine(),
      "ready-durable-doc",
    );
    await durable.whenReady();
    expect(durable.isHistoryEmpty()).toBe(true);
    await durable.dispose();
  });
});

function createSeam() {
  return {
    operations: new ReactiveStream(),
    presence: new ReactiveStream(),
    agentive: new ReactiveStream(),
    commitOperation: () => Promise.resolve({ revision: 1, committed: true }),
    broadcastPresence: () => Promise.resolve(),
    broadcastAgentive: () => Promise.resolve(),
    whenReady: () => new Promise(() => {}),
    isHistoryEmpty: () => true,
    dispose: () => Promise.resolve(),
  };
}

function createEditorSeam() {
  let handlers = {};
  return {
    on(event, fn) {
      (handlers[event] = handlers[event] || []).push(fn);
    },
    off(event, fn) {
      handlers[event] = (handlers[event] || []).filter((h) => h !== fn);
    },
    listenerCount() {
      return Object.values(handlers).reduce((n, list) => n + list.length, 0);
    },
    applyOperation() {},
    setOtherCursor() {},
    clearCursor() {},
    onChange() {},
    onCursorActivity() {},
    onFocus() {},
    onBlur() {},
    detach() {},
    dispose() {
      handlers = {};
    },
  };
}

describe("usePyrepadEditor drives EditorSeam.off (D1)", function () {
  afterEach(function () {
    cleanup();
  });

  it("removes its listeners from a caller-built adapter on unmount", async function () {
    const seam = createSeam();
    const editor = createEditorSeam();
    const hook = renderHook(() =>
      usePyrepadEditor({ adapter: seam, editor: editor, userId: "me" }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(editor.listenerCount()).toBeGreaterThan(0);

    hook.unmount();
    expect(editor.listenerCount()).toBe(0);
  });
});
