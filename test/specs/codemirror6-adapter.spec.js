import { describe, it, expect, afterEach } from "bun:test";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  CodeMirror6Adapter,
  CM6PresenceWidget,
} from "../../src/editors/index.ts";
import { TextOperation } from "../../src/core/index.ts";

// JSDOM (test/setup-globals.js) has no requestAnimationFrame, which EditorView
// needs at construction to schedule its measure pass. Polyfilled here, in this
// spec only, as a no-op: DOM updates are synchronous; only layout measuring is
// skipped, which JSDOM cannot do anyway.
if (typeof window.requestAnimationFrame !== "function") {
  window.requestAnimationFrame = () => 1;
  window.cancelAnimationFrame = () => {};
}

const mounted = [];

function mount(doc, extensions = []) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({ state: EditorState.create({ doc, extensions }), parent });
  mounted.push(view);
  return view;
}

afterEach(() => {
  while (mounted.length) {
    const view = mounted.pop();
    view.destroy();
    view.dom.parentNode?.remove();
  }
});

function opShape(op) {
  return op.ops.map((o) =>
    o.isRetain() ? ["retain", o.chars] : o.isInsert() ? ["insert", o.text] : ["delete", o.chars],
  );
}

describe("CodeMirror6Adapter against a real EditorView", () => {
  it("a local edit produces exactly one committed TextOperation; a remote applyOperation produces none (no echo)", () => {
    const view = mount("hello world");
    const adapter = new CodeMirror6Adapter(view);
    const committed = [];
    const seam = { commitOperation: (op) => committed.push(op) };
    adapter.on("change", (op) => seam.commitOperation(op));

    view.dispatch({ changes: { from: 5, insert: " shiny" }, userEvent: "input.type" });

    expect(committed.length).toBe(1);
    const op = committed[0];
    expect(op instanceof TextOperation).toBe(true);
    expect(opShape(op)).toEqual([
      ["retain", 5],
      ["insert", " shiny"],
      ["retain", 6],
    ]);
    expect(op.apply("hello world")).toBe("hello shiny world");

    const remote = new TextOperation().retain(17).insert("!");
    adapter.applyOperation(remote);
    expect(view.state.doc.toString()).toBe("hello shiny world!");
    expect(committed.length).toBe(1);

    adapter.dispose();
  });

  it("tags remote transactions with a real CM6 annotation that tr.annotation() can read", () => {
    const transactions = [];
    const view = mount("abc", [EditorView.updateListener.of((u) => transactions.push(...u.transactions))]);
    const adapter = new CodeMirror6Adapter(view);

    adapter.applyOperation(new TextOperation().retain(3).insert("d"));

    const docChanges = transactions.filter((tr) => tr.docChanged);
    expect(docChanges.length).toBe(1);
    expect(docChanges[0].annotation(adapter.remoteOrigin)).toBe(true);
    adapter.dispose();
  });

  it("maps a local replace (delete + insert) to a correct TextOperation", () => {
    const view = mount("hello world");
    const adapter = new CodeMirror6Adapter(view);
    const committed = [];
    adapter.on("change", (op) => committed.push(op));

    view.dispatch({ changes: { from: 0, to: 5, insert: "HELLO" } });

    expect(committed.length).toBe(1);
    expect(committed[0].apply("hello world")).toBe("HELLO world");
    adapter.dispose();
  });

  it("installs an EditorView.updateListener that routes every transaction to onTransaction", () => {
    const view = mount("abc");
    const adapter = new CodeMirror6Adapter(view);
    const seen = [];
    const original = adapter.onTransaction.bind(adapter);
    adapter.onTransaction = (tr) => {
      seen.push(tr);
      original(tr);
    };
    const cursors = [];
    adapter.on("cursor", (c) => cursors.push(c));

    view.dispatch({ changes: { from: 3, insert: "d" } });
    view.dispatch({ selection: { anchor: 1, head: 2 } });

    expect(seen.length).toBe(2);
    expect(cursors.length).toBe(1);
    expect(cursors[0]).toEqual({ position: 2, selectionEnd: 1 });
    adapter.dispose();
  });

  it("renders remote presence decorations into view.dom after setOtherCursor and removes them on clearCursor", () => {
    const view = mount("test document content");
    const adapter = new CodeMirror6Adapter(view);

    adapter.setOtherCursor({
      cursor: { position: 4, selectionEnd: 4 },
      color: "#ef4444",
      clientId: "Alice",
    });
    adapter.setOtherCursor({
      cursor: { position: 5, selectionEnd: 13 },
      color: "#3b82f6",
      clientId: "Bob",
    });

    const caret = view.dom.querySelector('.cm-presence-cursor[data-clientid="Alice"]');
    expect(caret).not.toBeNull();
    expect(caret.querySelector(".cm-presence-caret").style.backgroundColor).not.toBe("");

    const selection = view.dom.querySelector(".cm-presence-selection");
    expect(selection).not.toBeNull();
    expect(selection.textContent).toBe("document");

    adapter.clearCursor("Alice");
    expect(view.dom.querySelector('.cm-presence-cursor[data-clientid="Alice"]')).toBeNull();
    expect(view.dom.querySelector(".cm-presence-selection")).not.toBeNull();

    adapter.clearCursor("Bob");
    expect(view.dom.querySelector(".cm-presence-selection")).toBeNull();
    adapter.dispose();
  });

  it("keeps a remote caret anchored to its text when the document changes before it", () => {
    const view = mount("abcdef");
    const adapter = new CodeMirror6Adapter(view);
    adapter.setOtherCursor({
      cursor: { position: 3, selectionEnd: 3 },
      color: "#ef4444",
      clientId: "Alice",
    });

    view.dispatch({ changes: { from: 0, insert: "XY" } });

    const [deco] = adapter.presencePlugin.getDecorations();
    expect(deco.from).toBe(5);
    expect(view.dom.querySelector('.cm-presence-cursor[data-clientid="Alice"]')).not.toBeNull();
    adapter.dispose();
  });

  it("styles the CM6 caret widget on the text baseline", () => {
    const widget = new CM6PresenceWidget("#ef4444", "Alice", 21);
    const dom = widget.toDOM();
    expect(dom.className).toBe("cm-presence-cursor other-client");
    expect(dom.style.verticalAlign).toBe("baseline");
    expect(dom.style.transform).toBe("translateY(0.000px)");
    expect(parseFloat(dom.style.marginBottom || "0")).toBe(0);
    expect(widget.getActiveTimerCount()).toBeGreaterThan(0);
    widget.dispose();
    expect(widget.isDisposed()).toBe(true);
    expect(widget.getActiveTimerCount()).toBe(0);
    expect(widget.getActiveListenerCount()).toBe(0);
  });

  it("converges two real views exchanging operations", () => {
    const initial = "Initial CM6 shared document.";
    const viewAlice = mount(initial);
    const viewBob = mount(initial);
    const alice = new CodeMirror6Adapter(viewAlice);
    const bob = new CodeMirror6Adapter(viewBob);
    alice.on("change", (op) => bob.applyOperation(op));
    bob.on("change", (op) => alice.applyOperation(op));

    for (let k = 0; k < 25; k++) {
      const view = k % 2 === 0 ? viewAlice : viewBob;
      const pos = helpers.randomInt(view.state.doc.length);
      view.dispatch({ changes: { from: pos, insert: " [edit " + k + "]" } });
    }

    expect(viewAlice.state.doc.toString()).toBe(viewBob.state.doc.toString());
    expect(viewAlice.state.doc.length).toBeGreaterThan(initial.length);
    alice.dispose();
    bob.dispose();
  });

  it("reads the local caret from view.state.selection in getCursor", () => {
    const view = mount("0123456789012345678901234567890123456789");
    view.dispatch({ selection: { anchor: 25, head: 15 } });
    const adapter = new CodeMirror6Adapter(view);
    expect(adapter.getCursor()).toEqual({ position: 15, selectionEnd: 25 });
    adapter.dispose();
  });

  it("stops emitting and removes presence after dispose", () => {
    const view = mount("abc");
    const adapter = new CodeMirror6Adapter(view);
    const committed = [];
    adapter.on("change", (op) => committed.push(op));
    adapter.setOtherCursor({
      cursor: { position: 1, selectionEnd: 1 },
      color: "#ef4444",
      clientId: "Alice",
    });

    adapter.dispose();
    view.dispatch({ changes: { from: 0, insert: "z" } });

    expect(committed.length).toBe(0);
    expect(adapter.isDisposed()).toBe(true);
    expect(view.dom.querySelector(".cm-presence-cursor")).toBeNull();
  });
});
