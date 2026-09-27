import { describe, it, expect, afterEach } from "bun:test";
import React from "react";
import { renderHook, render, act, cleanup } from "@testing-library/react";
import {
  PyrepadProvider,
  usePyrepadEditor,
  useCollaborators,
  useAgentiveDiffs,
  CollaborativeEditor,
  VERSION,
} from "../../src/react/index.ts";
import {
  PyricSandboxAdapter,
  ReactiveStream,
} from "../../src/adapters/index.ts";
import { TextOperation, Cursor } from "../../src/core/index.ts";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Lets the async-iterator pumps inside the hooks drain their queues.
async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

// A SyncSeam built only from the interface: three streams + methods. No `.on`.
function createFakeSeam(opts) {
  const options = opts || {};
  let readyListeners = [];
  const seam = {
    operations: new ReactiveStream(),
    presence: new ReactiveStream(),
    agentive: new ReactiveStream(),
    commits: [],
    broadcasts: [],
    commitOperation: function (op, author) {
      seam.commits.push({ op: op, author: author });
      return Promise.resolve({ revision: seam.commits.length, committed: true });
    },
    broadcastPresence: function (cursor) {
      seam.broadcasts.push(cursor);
      return Promise.resolve();
    },
    broadcastAgentive: function () {
      return Promise.resolve();
    },
    dispose: function () {
      return Promise.resolve();
    },
  };
  if (options.readiness) {
    seam.isReady = false;
    seam.historyEmpty = true;
    seam.once = function (event, cb) {
      if (event === "ready") readyListeners.push(cb);
    };
    seam.isHistoryEmpty = function () {
      if (!seam.isReady) throw new Error("not ready");
      return seam.historyEmpty;
    };
    seam.becomeReady = function (historyEmpty) {
      seam.isReady = true;
      seam.historyEmpty = historyEmpty;
      const listeners = readyListeners;
      readyListeners = [];
      listeners.forEach(function (cb) {
        cb();
      });
    };
  }
  return seam;
}

// A minimal EditorSeam: records what the hook drives into it and lets the
// spec fire local "change"/"cursor" events the way the real adapters do.
function createFakeEditor(text) {
  let handlers = {};
  const editor = {
    text: text || "",
    applied: [],
    otherCursors: [],
    cleared: [],
    disposed: false,
    on: function (event, fn) {
      (handlers[event] = handlers[event] || []).push(fn);
    },
    fire: function (event) {
      const args = Array.prototype.slice.call(arguments, 1);
      (handlers[event] || []).forEach(function (fn) {
        fn.apply(null, args);
      });
    },
    listenerCount: function (event) {
      return (handlers[event] || []).length;
    },
    getValue: function () {
      return editor.text;
    },
    applyOperation: function (op) {
      editor.applied.push(op);
      editor.text = op.apply(editor.text);
    },
    setOtherCursor: function (data) {
      editor.otherCursors.push(data);
    },
    clearCursor: function (clientId) {
      editor.cleared.push(clientId);
    },
    onChange: function () {},
    onCursorActivity: function () {},
    onFocus: function () {},
    onBlur: function () {},
    detach: function () {},
    dispose: function () {
      editor.disposed = true;
      handlers = {};
    },
  };
  return editor;
}

function opEvent(op, author) {
  return { revision: 1, operation: op, author: author, timestamp: Date.now() };
}

describe("React hooks drive the SyncSeam (C3, A2)", function () {
  afterEach(function () {
    cleanup();
  });

  it("exports the hooks, provider, component and VERSION", function () {
    expect(typeof usePyrepadEditor).toBe("function");
    expect(typeof useCollaborators).toBe("function");
    expect(typeof useAgentiveDiffs).toBe("function");
    expect(typeof PyrepadProvider).toBe("function");
    expect(typeof CollaborativeEditor).toBe("function");
    expect(VERSION).toBe("2.0.0");
  });

  it("usePyrepadEditor applies remote `operations` events to the editor", async function () {
    const seam = createFakeSeam();
    const editor = createFakeEditor("abc");
    renderHook(function () {
      return usePyrepadEditor({ adapter: seam, editor: editor, userId: "me" });
    });
    await flush();

    const remote = new TextOperation().retain(3).insert("d");
    seam.operations.push(opEvent(remote, "peer"));
    await flush();

    expect(editor.applied).toEqual([remote]);
    expect(editor.text).toBe("abcd");
  });

  it("usePyrepadEditor does not re-apply the echo of its own committed operation", async function () {
    const seam = createFakeSeam();
    const editor = createFakeEditor("abc");
    renderHook(function () {
      return usePyrepadEditor({ adapter: seam, editor: editor, userId: "me" });
    });
    await flush();

    seam.operations.push(opEvent(new TextOperation().retain(3).insert("x"), "me"));
    await flush();

    expect(editor.applied.length).toBe(0);
  });

  it("usePyrepadEditor commits local editor changes via adapter.commitOperation", async function () {
    const seam = createFakeSeam();
    const editor = createFakeEditor("abc");
    renderHook(function () {
      return usePyrepadEditor({ adapter: seam, editor: editor, userId: "me" });
    });
    await flush();

    const local = new TextOperation().retain(3).insert("!");
    editor.fire("change", local, local);

    expect(seam.commits.length).toBe(1);
    expect(seam.commits[0].op).toBe(local);
    expect(seam.commits[0].author).toBe("me");
  });

  it("usePyrepadEditor broadcasts local cursor activity via adapter.broadcastPresence", async function () {
    const seam = createFakeSeam();
    const editor = createFakeEditor("abc");
    renderHook(function () {
      return usePyrepadEditor({ adapter: seam, editor: editor, userId: "me" });
    });
    await flush();

    editor.fire("cursor", { position: 2, selectionEnd: 2 });

    expect(seam.broadcasts).toEqual([{ position: 2, selectionEnd: 2 }]);
  });

  it("usePyrepadEditor routes `presence` events to setOtherCursor / clearCursor", async function () {
    const seam = createFakeSeam();
    const editor = createFakeEditor("abc");
    renderHook(function () {
      return usePyrepadEditor({ adapter: seam, editor: editor, userId: "me" });
    });
    await flush();

    seam.presence.push({ userId: "bob", cursor: new Cursor(1, 2), color: "#f00", state: "active" });
    seam.presence.push({ userId: "bob", cursor: null, color: "#f00", state: "disconnected" });
    await flush();

    expect(editor.otherCursors.length).toBe(1);
    expect(editor.otherCursors[0].clientId).toBe("bob");
    expect(editor.otherCursors[0].color).toBe("#f00");
    expect(editor.otherCursors[0].cursor.position).toBe(1);
    expect(editor.otherCursors[0].cursor.selectionEnd).toBe(2);
    expect(editor.cleared).toEqual(["bob"]);
  });

  it("usePyrepadEditor applies defaultText once when the adapter becomes ready with an empty document", async function () {
    const seam = createFakeSeam({ readiness: true });
    const editor = createFakeEditor("");
    const hook = renderHook(function () {
      return usePyrepadEditor({
        adapter: seam,
        editor: editor,
        userId: "me",
        defaultText: "hello",
      });
    });
    await flush();
    expect(editor.text).toBe("");

    await act(async function () {
      seam.becomeReady(true);
    });
    hook.rerender();
    await flush();

    expect(editor.text).toBe("hello");
    expect(seam.commits.length).toBe(1);
    expect(seam.commits[0].op.apply("")).toBe("hello");
    expect(seam.commits[0].author).toBe("me");
  });

  it("usePyrepadEditor ignores defaultText when the shared document already has history", async function () {
    const seam = createFakeSeam({ readiness: true });
    const editor = createFakeEditor("");
    renderHook(function () {
      return usePyrepadEditor({
        adapter: seam,
        editor: editor,
        userId: "me",
        defaultText: "hello",
      });
    });
    await flush();
    await act(async function () {
      seam.becomeReady(false);
    });
    await flush();

    expect(editor.text).toBe("");
    expect(seam.commits.length).toBe(0);
  });

  it("usePyrepadEditor stops syncing after unmount and leaves a caller-owned EditorSeam undisposed", async function () {
    const seam = createFakeSeam();
    const editor = createFakeEditor("abc");
    const hook = renderHook(function () {
      return usePyrepadEditor({ adapter: seam, editor: editor, userId: "me" });
    });
    await flush();
    hook.unmount();

    seam.operations.push(opEvent(new TextOperation().retain(3).insert("z"), "peer"));
    await flush();

    expect(editor.applied.length).toBe(0);
    expect(editor.disposed).toBe(false);
  });

  it("usePyrepadEditor does not re-render on a burst of remote operations", async function () {
    const seam = createFakeSeam();
    const editor = createFakeEditor("");
    const hook = renderHook(function () {
      return usePyrepadEditor({ adapter: seam, editor: editor, userId: "me" });
    });
    await flush();
    const before = hook.result.current.renderCount;

    for (let i = 0; i < 100; i++) {
      seam.operations.push(opEvent(new TextOperation().retain(i).insert("a"), "peer"));
    }
    await flush();

    expect(editor.text.length).toBe(100);
    expect(hook.result.current.renderCount).toBe(before);
  });

  it("useCollaborators tracks peers from the `presence` stream (no adapter.on)", async function () {
    const seam = createFakeSeam();
    const hook = renderHook(function () {
      return useCollaborators(seam);
    });
    await flush();

    await act(async function () {
      seam.presence.push({ userId: "bob", cursor: new Cursor(3, 3), color: "#0f0", state: "active" });
      await Promise.resolve();
    });
    await flush();
    expect(hook.result.current.length).toBe(1);
    expect(hook.result.current[0].userId).toBe("bob");
    expect(hook.result.current[0].color).toBe("#0f0");

    await act(async function () {
      seam.presence.push({ userId: "bob", cursor: null, color: "#0f0", state: "disconnected" });
      await Promise.resolve();
    });
    await flush();
    expect(hook.result.current.length).toBe(0);
  });

  it("useAgentiveDiffs tracks agents from the `agentive` stream (no adapter.on)", async function () {
    const seam = createFakeSeam();
    const hook = renderHook(function () {
      return useAgentiveDiffs(seam);
    });
    await flush();

    await act(async function () {
      seam.agentive.push({ agentId: "copilot", status: "thinking", ghostDiff: null, explanation: "hm" });
      await Promise.resolve();
    });
    await flush();

    expect(hook.result.current.length).toBe(1);
    expect(hook.result.current[0].agentId).toBe("copilot");
    expect(hook.result.current[0].status).toBe("thinking");
    expect(hook.result.current[0].explanation).toBe("hm");
  });

  it("<CollaborativeEditor /> inside <PyrepadProvider /> renders peers from the context adapter", async function () {
    const seam = createFakeSeam();
    const view = render(
      React.createElement(
        PyrepadProvider,
        { adapter: seam },
        React.createElement(CollaborativeEditor, { userId: "me" }),
      ),
    );
    await flush();
    await act(async function () {
      seam.presence.push({ userId: "carol", cursor: new Cursor(0, 0), color: "#00f", state: "active" });
      await Promise.resolve();
    });
    await flush();

    expect(view.container.textContent).toContain("carol");
  });

  it("syncs two real CodeMirror 5 editors through the Pyric sandbox", async function () {
    const db = firepad.PyricSandbox.createDatabase();
    const ref = db.ref("/react-hooks-integration");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const cmA = CodeMirror(host);
    const cmB = CodeMirror(host);
    const adapterA = new PyricSandboxAdapter(ref, "alice", "#f00");
    const adapterB = new PyricSandboxAdapter(ref, "bob", "#00f");

    renderHook(function () {
      return usePyrepadEditor({ adapter: adapterA, editor: cmA, type: "cm5", userId: "alice" });
    });
    renderHook(function () {
      return usePyrepadEditor({ adapter: adapterB, editor: cmB, type: "cm5", userId: "bob" });
    });
    await act(async function () {
      await new Promise(function (r) {
        setTimeout(r, 30);
      });
    });

    await act(async function () {
      cmA.replaceRange("hi from alice", { line: 0, ch: 0 });
      await new Promise(function (r) {
        setTimeout(r, 50);
      });
    });

    expect(cmA.getValue()).toBe("hi from alice");
    expect(cmB.getValue()).toBe("hi from alice");

    cleanup();
    await adapterA.dispose();
    await adapterB.dispose();
    host.remove();
  });
});
