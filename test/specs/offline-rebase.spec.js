import { describe, it, expect } from "bun:test";
import { rebaseUnsaved } from "../../src/adapters/offline/unsaved-snapshot.ts";
import { TextOperation } from "../../src/core/index.ts";

const ins = (at, len, text) => {
  const op = new TextOperation();
  if (at) op.retain(at);
  op.insert(text);
  if (len - at) op.retain(len - at);
  return op;
};
const snapshot = (fields) => ({
  docId: "d",
  revision: 1,
  baseLength: 5,
  sent: null,
  rest: null,
  savedAt: 0,
  ...fields,
});
const entry = (author, op) => ({ author, op: op.toJSON() });

describe("rebaseUnsaved", () => {
  it("returns the edits unchanged when nothing was written since", () => {
    const sent = ins(5, 5, "!");
    const { op } = rebaseUnsaved(snapshot({ sent: sent.toJSON() }), [], "me");
    expect(op.apply("hello")).toBe("hello!");
  });

  it("rebases sent and later edits over a peer's revision", () => {
    // "hello": I sent "hello!" then typed "?" -> "hello!?"; a peer wrote ">hello".
    const snap = snapshot({
      sent: ins(5, 5, "!").toJSON(),
      rest: ins(6, 6, "?").toJSON(),
    });
    const { op } = rebaseUnsaved(snap, [entry("peer", ins(0, 5, ">"))], "me");
    expect(op.apply(">hello")).toBe(">hello!?");
  });

  it("drops the sent op when it landed before the reload, keeping later edits", () => {
    const sent = ins(5, 5, "!");
    const snap = snapshot({ sent: sent.toJSON(), rest: ins(6, 6, "?").toJSON() });
    const { op } = rebaseUnsaved(
      snap,
      [entry("peer", ins(0, 5, ">")), entry("me", ins(6, 6, "!"))],
      "me",
    );
    expect(op.apply(">hello!")).toBe(">hello!?");
  });

  it("does not mistake a peer's identical op for its own", () => {
    const snap = snapshot({ sent: ins(5, 5, "!").toJSON() });
    const { op } = rebaseUnsaved(snap, [entry("peer", ins(5, 5, "!"))], "me");
    expect(op.apply("hello!")).toBe("hello!!");
  });

  it("skips entries that don't fit, as live clients do", () => {
    const snap = snapshot({ sent: ins(5, 5, "!").toJSON() });
    const { op, skipped } = rebaseUnsaved(
      snap,
      [entry("evil", ins(40, 40, "x")), { author: "evil", op: ["junk"] }, entry("peer", ins(0, 5, ">"))],
      "me",
    );
    expect(skipped).toEqual([0, 1]);
    expect(op.apply(">hello")).toBe(">hello!");
  });

  it("returns null when every edit landed", () => {
    const sent = ins(5, 5, "!");
    const { op } = rebaseUnsaved(snapshot({ sent: sent.toJSON() }), [entry("me", sent)], "me");
    expect(op).toBeNull();
  });
});
