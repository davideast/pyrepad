import { describe, it, expect } from "bun:test";
import { SuggestionBook } from "../../src/suggestions/suggestion-book.ts";
import { SuggestionSession } from "../../src/suggestions/session.ts";

function setup(initial) {
  const state = { text: initial };
  const sent = [];
  const book = new SuggestionBook();
  const session = new SuggestionSession({
    book,
    host: {
      getText: () => state.text,
      applyChange: (c) => {
        state.text =
          state.text.slice(0, c.from) + c.insert + state.text.slice(c.to);
        book.applyChanges([c]);
      },
    },
    broadcast: (e) => sent.push(e),
  });
  return { state, sent, book, session };
}

const edit = (o = {}) => ({
  find: "tyop",
  replacement: "typo",
  reason: "spelling",
  kind: "typo",
  ...o,
});

describe("SuggestionSession", function () {
  it("holds a suggestion received before its text loads, then places it", function () {
    const a = setup("a tyop here");
    a.book.add({ ...edit(), agentId: "assistant" }, a.state.text, {});

    const b = setup("");
    b.session.ingest(a.sent[0]);
    expect(b.book.get(a.sent[0].slot)).toBeFalsy();
    b.state.text = "a tyop here";
    b.session.retryDeferred();
    expect(b.book.get(a.sent[0].slot)).toBeTruthy();
    expect(b.sent).toHaveLength(0);
  });

  it("broadcasts suggestions the local analyzer adds, not ones it ingested", function () {
    const a = setup("a tyop here");
    a.book.add({ ...edit(), agentId: "assistant" }, a.state.text, {});
    expect(a.sent).toHaveLength(1);
    expect(a.sent[0].status).toBe("suggesting");

    const b = setup("a tyop here");
    b.session.ingest(a.sent[0]);
    expect(b.book.list()).toHaveLength(1);
    expect(b.sent).toHaveLength(0);
  });

  it("is idempotent when the database echoes an event back", function () {
    const a = setup("a tyop here");
    a.book.add({ ...edit(), agentId: "assistant" }, a.state.text, {});
    a.session.ingest(a.sent[0]);
    expect(a.book.list()).toHaveLength(1);
    expect(a.sent).toHaveLength(1);
  });

  it("accept applies the change, flags it as an assistant edit, and broadcasts", function () {
    const a = setup("a tyop here");
    const s = a.book.add({ ...edit(), agentId: "assistant" }, a.state.text, {});
    let flagged = null;
    const apply = a.session.host.applyChange;
    a.session.host.applyChange = (c) => {
      flagged = a.session.applying;
      apply(c);
    };
    a.session.accept(s.id);
    expect(a.state.text).toBe("a typo here");
    expect(flagged).toBe(true);
    expect(a.session.applying).toBe(false);
    expect(a.sent.at(-1).status).toBe("resolved");
    expect(a.sent.at(-1).ghostDiff.resolution).toBe("accepted");
  });

  it("reject removes without touching the text and broadcasts", function () {
    const a = setup("a tyop here");
    const s = a.book.add({ ...edit(), agentId: "assistant" }, a.state.text, {});
    a.session.reject(s.id);
    expect(a.state.text).toBe("a tyop here");
    expect(a.book.list()).toHaveLength(0);
    expect(a.sent.at(-1).ghostDiff.resolution).toBe("rejected");
  });

  it("a remote resolved event drops the local copy without broadcasting", function () {
    const a = setup("a tyop here");
    a.book.add({ ...edit(), agentId: "assistant" }, a.state.text, {});
    const b = setup("a tyop here");
    b.session.ingest(a.sent[0]);
    b.session.ingest({
      agentId: "assistant",
      slot: a.book.list()[0].id,
      status: "resolved",
      ghostDiff: { resolution: "rejected" },
    });
    expect(b.book.list()).toHaveLength(0);
    expect(b.sent).toHaveLength(0);
  });

  it("a mirrored suggestion can be accepted on the other client", function () {
    const a = setup("a tyop here");
    a.book.add({ ...edit(), agentId: "assistant" }, a.state.text, {});
    const b = setup("a tyop here");
    b.session.ingest(a.sent[0]);
    b.session.accept(b.book.list()[0].id);
    expect(b.state.text).toBe("a typo here");
    expect(b.sent.at(-1).ghostDiff.resolution).toBe("accepted");
  });
});
