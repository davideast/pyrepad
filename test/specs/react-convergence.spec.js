import { describe, it, expect, afterEach } from "bun:test";
import { renderHook, act, cleanup } from "@testing-library/react";
import { usePyrepadEditor } from "../../src/react/index.ts";
import { PyricSandboxAdapter } from "../../src/adapters/index.ts";
import { TextOperation } from "../../src/core/index.ts";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function settle(ms) {
  await act(async function () {
    await new Promise(function (r) {
      setTimeout(r, ms);
    });
  });
}

// EditorSeam fake (as in react-hooks.spec.js): `type` is a local edit, which
// updates the text and fires "change"; `applyOperation` is a remote apply.
function createFakeEditor() {
  let handlers = {};
  const editor = {
    text: "",
    applied: [],
    on: function (event, fn) {
      (handlers[event] = handlers[event] || []).push(fn);
    },
    off: function (event, fn) {
      handlers[event] = (handlers[event] || []).filter(function (h) {
        return h !== fn;
      });
    },
    type: function (op) {
      editor.text = op.apply(editor.text);
      (handlers.change || []).forEach(function (fn) {
        fn(op, op);
      });
    },
    getValue: function () {
      return editor.text;
    },
    applyOperation: function (op) {
      editor.applied.push(op);
      editor.text = op.apply(editor.text);
    },
    setOtherCursor: function () {},
    clearCursor: function () {},
    onChange: function () {},
    onCursorActivity: function () {},
    onFocus: function () {},
    onBlur: function () {},
    detach: function () {},
    dispose: function () {
      handlers = {};
    },
  };
  return editor;
}

function readHistory(ref) {
  return new Promise(function (resolve) {
    ref.child("history").once("value", function (snap) {
      resolve(snap.val() || {});
    });
  });
}

function composeHistory(history) {
  let doc = "";
  for (let rev = 0; history["A" + rev.toString(36)]; rev++) {
    doc = TextOperation.fromJSON(history["A" + rev.toString(36)].o).apply(doc);
  }
  return doc;
}

async function twoTypists(path) {
  const db = firepad.PyricSandbox.createDatabase();
  const ref = db.ref(path);
  const alice = new PyricSandboxAdapter(ref, "alice", "#f00");
  const bob = new PyricSandboxAdapter(ref, "bob", "#00f");
  const edA = createFakeEditor();
  const edB = createFakeEditor();
  renderHook(function () {
    return usePyrepadEditor({ adapter: alice, editor: edA, userId: "alice" });
  });
  renderHook(function () {
    return usePyrepadEditor({ adapter: bob, editor: edB, userId: "bob" });
  });
  await act(async function () {
    await Promise.all([alice.whenReady(), bob.whenReady()]);
  });
  await settle(10);

  edA.type(new TextOperation().insert("hello world"));
  await settle(30);
  expect(edB.text).toBe("hello world");
  edA.applied.length = 0;
  edB.applied.length = 0;

  return { ref: ref, alice: alice, bob: bob, edA: edA, edB: edB };
}

describe("usePyrepadEditor converges under concurrent edits (C7)", function () {
  afterEach(function () {
    cleanup();
  });

  it("two typists with ops in flight at the same revision end with identical text and no self-echo", async function () {
    const t = await twoTypists("/react-convergence-two-typists");

    // Same tick: both sides send at the same revision; each also types again
    // while its first op is still unacknowledged.
    t.edA.type(new TextOperation().insert("A1").retain(11));
    t.edB.type(new TextOperation().retain(11).insert("B1"));
    t.edA.type(new TextOperation().retain(2).insert("A2").retain(11));
    t.edB.type(new TextOperation().retain(13).insert("B2"));
    await settle(400);

    expect(t.edA.text).toBe("A1A2hello worldB1B2");
    expect(t.edB.text).toBe("A1A2hello worldB1B2");
    expect(composeHistory(await readHistory(t.ref))).toBe("A1A2hello worldB1B2");
    // Each editor only ever applied the peer's inserts.
    const insertedBy = function (ops) {
      return ops
        .map(function (op) {
          return op.ops
            .filter(function (o) {
              return typeof o.text === "string" && o.text.length > 0;
            })
            .map(function (o) {
              return o.text;
            })
            .join("");
        })
        .join("");
    };
    expect(insertedBy(t.edA.applied).replace(/[^B0-9]/g, "")).toBe("B1B2");
    expect(insertedBy(t.edB.applied).replace(/[^A0-9]/g, "")).toBe("A1A2");

    cleanup();
    await t.alice.dispose();
    await t.bob.dispose();
  });

  it("re-sends an op that lost its revision race transformed against the winner", async function () {
    const t = await twoTypists("/react-convergence-retry");

    // Alice's transaction runs first and claims the revision Bob also targets.
    t.edA.type(new TextOperation().insert(">> ").retain(11));
    t.edB.type(new TextOperation().retain(11).insert("!"));
    await settle(400);

    const history = await readHistory(t.ref);
    const bobRevisions = Object.keys(history).filter(function (k) {
      return history[k].a === "bob";
    });
    expect(bobRevisions.length).toBe(1);
    const resent = TextOperation.fromJSON(history[bobRevisions[0]].o);
    expect(resent.equals(new TextOperation().retain(14).insert("!"))).toBe(true);
    expect(t.edA.text).toBe(">> hello world!");
    expect(t.edB.text).toBe(">> hello world!");

    cleanup();
    await t.alice.dispose();
    await t.bob.dispose();
  });
  it("two clients seeding the same defaultText into an empty document keep exactly one copy", async function () {
    const db = firepad.PyricSandbox.createDatabase();
    const ref = db.ref("/react-convergence-seed-race");
    const alice = new PyricSandboxAdapter(ref, "alice", "#f00");
    const bob = new PyricSandboxAdapter(ref, "bob", "#00f");
    const edA = createFakeEditor();
    const edB = createFakeEditor();
    const seed = "print('hello')";
    renderHook(function () {
      return usePyrepadEditor({ adapter: alice, editor: edA, userId: "alice", defaultText: seed });
    });
    renderHook(function () {
      return usePyrepadEditor({ adapter: bob, editor: edB, userId: "bob", defaultText: seed });
    });
    await settle(400);

    const occurrences = function (text) {
      return text.split(seed).length - 1;
    };
    expect(occurrences(edA.text)).toBe(1);
    expect(occurrences(edB.text)).toBe(1);
    expect(edA.text).toBe(seed);
    expect(edB.text).toBe(seed);
    expect(composeHistory(await readHistory(ref))).toBe(seed);
    // Both seeded concurrently: the loser undid its own copy.
    const undid = edA.applied.concat(edB.applied).some(function (op) {
      return op.ops.some(function (o) {
        return o.isDelete();
      });
    });
    expect(undid).toBe(true);

    cleanup();
    await alice.dispose();
    await bob.dispose();
  });
});
