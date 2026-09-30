import { describe, it, expect } from "bun:test";
import { locateQuote } from "../../src/suggestions/anchor.ts";
import { SuggestionBook } from "../../src/suggestions/suggestion-book.ts";

const edit = (find, replacement, extra = {}) => ({
  agentId: "assistant",
  find,
  replacement,
  reason: "why",
  kind: "typo",
  ...extra,
});
const ins = (at, text) => ({ from: at, to: at, insert: text });
const del = (from, to) => ({ from, to, insert: "" });

describe("locateQuote", function () {
  it("finds a unique quote", function () {
    expect(locateQuote("the quick brown fox", "brown")).toEqual({
      from: 10,
      to: 15,
    });
  });

  it("returns null when the quote is absent or empty", function () {
    expect(locateQuote("abc", "zzz")).toBeNull();
    expect(locateQuote("abc", "")).toBeNull();
  });

  it("prefers a context match over a nearer occurrence", function () {
    const doc = "cat dog cat bird cat";
    expect(locateQuote(doc, "cat", { before: "dog ", hint: 0 })).toEqual({
      from: 8,
      to: 11,
    });
  });

  it("breaks ties by distance to the hint", function () {
    const doc = "cat dog cat bird cat";
    expect(locateQuote(doc, "cat", { hint: 17 })).toEqual({ from: 17, to: 20 });
  });

  it("respects the search window", function () {
    const doc = "cat dog cat";
    expect(locateQuote(doc, "cat", { window: { from: 1, to: 11 } })).toEqual({
      from: 8,
      to: 11,
    });
    expect(locateQuote(doc, "dog", { window: { from: 0, to: 5 } })).toBeNull();
  });
});

describe("SuggestionBook", function () {
  const doc = "I recieved teh package yesterday.";

  it("places a suggestion at its quote", function () {
    const book = new SuggestionBook();
    const s = book.add(edit("recieved", "received"), doc);
    expect(s).toMatchObject({ from: 2, to: 10, original: "recieved" });
    expect(book.list()).toHaveLength(1);
  });

  it("rejects quotes that are missing, unchanged, or overlapping", function () {
    const book = new SuggestionBook();
    expect(book.add(edit("nope", "x"), doc)).toBeNull();
    expect(book.add(edit("teh", "teh"), doc)).toBeNull();
    expect(book.add(edit("recieved", "received"), doc)).not.toBeNull();
    expect(book.add(edit("recieved teh", "received the"), doc)).toBeNull();
  });

  it("is idempotent for a repeated id", function () {
    const book = new SuggestionBook();
    const first = book.add(edit("teh", "the", { id: "a" }), doc);
    const again = book.add(edit("teh", "the", { id: "a" }), doc);
    expect(again).toBe(first);
    expect(book.list()).toHaveLength(1);
  });

  it("rebases spans as text changes elsewhere", function () {
    const book = new SuggestionBook();
    const s = book.add(edit("teh", "the"), doc);
    book.applyChanges([ins(0, "Hello. ")]);
    expect(s.from).toBe(18);
    expect(s.to).toBe(21);
    book.applyChanges([del(0, 7)]);
    expect(s.from).toBe(11);
  });

  it("keeps a suggestion while the user types at its edges", function () {
    const book = new SuggestionBook();
    const s = book.add(edit("teh", "the"), doc);
    book.applyChanges([ins(s.to, "!")]);
    book.applyChanges([ins(s.from, "~")]);
    expect(book.get(s.id)).toBeDefined();
    expect(s.to - s.from).toBe(3);
  });

  it("retires a suggestion when its text is edited", function () {
    const book = new SuggestionBook();
    const s = book.add(edit("teh", "the"), doc);
    const removed = [];
    book.on("removed", (r) => removed.push(r));
    book.applyChanges([ins(s.from + 1, "x")]);
    expect(book.list()).toHaveLength(0);
    expect(removed[0].status).toBe("stale");
  });

  it("accept reports the change at the rebased span and retires it", function () {
    const book = new SuggestionBook();
    const s = book.add(edit("teh", "the"), doc);
    book.applyChanges([ins(0, "AAA")]);
    expect(book.accept(s.id)).toEqual({ from: 14, to: 17, insert: "the" });
    expect(book.list()).toHaveLength(0);
    expect(book.accept(s.id)).toBeNull();
  });

  it("reject and remove retire without producing a change", function () {
    const book = new SuggestionBook();
    const a = book.add(edit("teh", "the"), doc);
    const b = book.add(edit("recieved", "received"), doc);
    expect(book.reject(a.id).status).toBe("rejected");
    expect(book.remove(b.id).status).toBe("stale");
    expect(book.list()).toHaveLength(0);
  });

  it("lists suggestions in document order and emits change events", function () {
    const book = new SuggestionBook();
    let changes = 0;
    book.on("change", () => changes++);
    book.add(edit("teh", "the"), doc);
    book.add(edit("recieved", "received"), doc);
    expect(book.list().map((s) => s.original)).toEqual(["recieved", "teh"]);
    expect(changes).toBe(2);
  });
});

describe("SuggestionBook minimal change", () => {
  const edit = (find, replacement) => ({
    find,
    replacement,
    reason: "r",
    kind: "grammar",
    agentId: "a",
  });

  it("narrows a phrase quote to the words that differ", () => {
    const book = new SuggestionBook();
    const doc = "all the points to this topic.";
    const s = book.add(
      edit("points to this topic", "points of this topic"),
      doc,
    );
    expect(s.original).toBe("to");
    expect(s.replacement).toBe("of");
    expect(doc.slice(s.from, s.to)).toBe("to");
  });

  it("keeps whole words when only part of a word differs", () => {
    const book = new SuggestionBook();
    const s = book.add(edit("definately", "definitely"), "I definately go");
    expect(s.original).toBe("definately");
    expect(s.replacement).toBe("definitely");
  });
});
