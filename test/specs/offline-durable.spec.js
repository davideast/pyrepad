import { describe, it, expect } from "bun:test";
import {
  OfflineDurableAdapter,
  InMemoryStorageEngine,
  PyricSandboxAdapter,
} from "../../src/adapters/index.ts";
import { TextOperation } from "../../src/core/index.ts";

const ins = (at, len, text) => {
  const op = new TextOperation();
  if (at) op.retain(at);
  op.insert(text);
  if (len - at) op.retain(len - at);
  return op;
};

async function settle(ms = 30) {
  await new Promise((r) => setTimeout(r, ms));
}

let docCounter = 0;
function freshRef() {
  const db = firepad.PyricSandbox.createDatabase();
  return db.ref("/offline-durable-" + ++docCounter);
}

/** An editor bound to `seam`: applies remote ops, commits local ones. */
function editorOn(seam) {
  const view = {
    text: "",
    type(op) {
      view.text = op.apply(view.text);
      return seam.commitOperation(op);
    },
  };
  seam.operations.subscribe((e) => {
    view.text = e.operation.apply(view.text);
  });
  return view;
}

function readDoc(ref) {
  return new Promise((resolve) => {
    ref.child("history").once("value", (snap) => {
      const all = snap.val() || {};
      let doc = new TextOperation();
      for (let i = 0; all["A" + i.toString(36)]; i++)
        doc = doc.compose(TextOperation.fromJSON(all["A" + i.toString(36)].o));
      resolve(doc.apply(""));
    });
  });
}

async function seed(ref, text) {
  const writer = new PyricSandboxAdapter(ref, "seeder");
  await writer.whenReady();
  await writer.commitOperation(ins(0, 0, text));
  await writer.dispose();
}

describe("OfflineDurableAdapter keeps unsaved edits across a reload", () => {
  it("replays edits that never landed, rebased over a peer's later revision", async () => {
    const ref = freshRef();
    const storage = new InMemoryStorageEngine();
    await seed(ref, "hello");

    const net1 = new PyricSandboxAdapter(ref, "me");
    const session1 = new OfflineDurableAdapter(net1, storage, "doc");
    const editor1 = editorOn(session1);
    await session1.whenReady();
    expect(editor1.text).toBe("hello");
    net1.sendOperation = () => {}; // writes never land: offline
    void editor1.type(ins(5, 5, "!")).catch(() => {});
    void editor1.type(ins(6, 6, "?")).catch(() => {});
    await session1.flush();
    await session1.dispose(); // the tab closes

    const peer = new PyricSandboxAdapter(ref, "peer");
    await peer.whenReady();
    await peer.commitOperation(ins(0, 5, ">"));
    await peer.dispose();

    const session2 = new OfflineDurableAdapter(
      new PyricSandboxAdapter(ref, "me"),
      storage,
      "doc",
    );
    const editor2 = editorOn(session2);
    await session2.whenReady();
    await settle();
    expect(editor2.text).toBe(">hello!?");
    expect(await readDoc(ref)).toBe(">hello!?");
    await session2.flush();
    expect(await storage.get("doc:unsaved")).toBeFalsy();
    await session2.dispose();
  });

  it("does not apply twice an edit that landed just before the reload", async () => {
    const ref = freshRef();
    const storage = new InMemoryStorageEngine();
    await seed(ref, "hello");
    const mine = new PyricSandboxAdapter(ref, "me");
    await mine.whenReady();
    await mine.commitOperation(ins(5, 5, "!"));
    await mine.dispose();
    // The snapshot was taken before the ack arrived.
    await storage.put("doc:unsaved", {
      docId: "doc",
      revision: 1,
      baseLength: 5,
      sent: ins(5, 5, "!").toJSON(),
      rest: null,
      savedAt: 0,
    });

    const session = new OfflineDurableAdapter(
      new PyricSandboxAdapter(ref, "me"),
      storage,
      "doc",
    );
    const editor = editorOn(session);
    await session.whenReady();
    await settle();
    expect(editor.text).toBe("hello!");
    expect(await readDoc(ref)).toBe("hello!");
    expect(await storage.get("doc:unsaved")).toBeFalsy();
    await session.dispose();
  });

  it("reports saved edits it cannot restore instead of guessing", async () => {
    const ref = freshRef();
    const storage = new InMemoryStorageEngine();
    await seed(ref, "hi");
    await storage.put("doc:unsaved", {
      docId: "doc",
      revision: 9,
      baseLength: 2,
      sent: ins(2, 2, "!").toJSON(),
      rest: null,
      savedAt: 0,
    });
    const session = new OfflineDurableAdapter(
      new PyricSandboxAdapter(ref, "me"),
      storage,
      "doc",
    );
    const errors = [];
    session.errors.subscribe((e) => errors.push(e));
    const editor = editorOn(session);
    await session.whenReady();
    expect(editor.text).toBe("hi");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ kind: "reconcile-failed", revision: 9 });
    await session.dispose();
  });
});

describe("OfflineDurableAdapter while online", () => {
  it("converges two clients typing at the same revision", async () => {
    const ref = freshRef();
    await seed(ref, "abc");
    const a = new OfflineDurableAdapter(
      new PyricSandboxAdapter(ref, "a"),
      new InMemoryStorageEngine(),
      "doc",
    );
    const b = new OfflineDurableAdapter(
      new PyricSandboxAdapter(ref, "b"),
      new InMemoryStorageEngine(),
      "doc",
    );
    const ea = editorOn(a);
    const eb = editorOn(b);
    await Promise.all([a.whenReady(), b.whenReady()]);
    const commits = [ea.type(ins(0, 3, "A")), eb.type(ins(3, 3, "B"))];
    commits.push(ea.type(ins(1, 4, "a")), eb.type(ins(4, 4, "b")));
    await Promise.all(commits);
    await settle();
    expect(ea.text).toBe(eb.text);
    expect(ea.text).toBe(await readDoc(ref));
    expect(ea.text).toBe("AaabcBb");
    await a.dispose();
    await b.dispose();
  });

  it("clears the stored snapshot once every edit is acknowledged", async () => {
    const ref = freshRef();
    const storage = new InMemoryStorageEngine();
    const session = new OfflineDurableAdapter(
      new PyricSandboxAdapter(ref, "me"),
      storage,
      "doc",
    );
    const editor = editorOn(session);
    await session.whenReady();
    await editor.type(ins(0, 0, "x"));
    await session.flush();
    expect(await storage.get("doc:unsaved")).toBeFalsy();
    await session.dispose();
  });
});
