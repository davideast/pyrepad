import { describe, it, expect } from "bun:test";
import { Coverage } from "../../src/suggestions/coverage.ts";
import { sentenceSpans, pickChunk } from "../../src/suggestions/chunker.ts";

const ins = (at, text) => ({ from: at, to: at, insert: text });
const del = (from, to) => ({ from, to, insert: "" });
const rep = (from, to, text) => ({ from, to, insert: text });

describe("Coverage", function () {
  it("merges overlapping and adjacent spans", function () {
    const c = new Coverage();
    c.add(0, 5);
    c.add(5, 9);
    c.add(20, 25);
    c.add(3, 6);
    expect(c.list()).toEqual([
      { from: 0, to: 9 },
      { from: 20, to: 25 },
    ]);
  });

  it("answers whether a range is fully covered", function () {
    const c = new Coverage();
    c.add(0, 10);
    expect(c.covers(2, 8)).toBe(true);
    expect(c.covers(8, 12)).toBe(false);
    expect(c.covers(12, 14)).toBe(false);
  });

  it("shifts spans after earlier edits", function () {
    const c = new Coverage();
    c.add(10, 20);
    c.applyChanges([ins(0, "abc")]);
    expect(c.list()).toEqual([{ from: 13, to: 23 }]);
  });

  it("splits a span around an edit inside it", function () {
    const c = new Coverage();
    c.add(0, 20);
    c.applyChanges([ins(10, "XX")]);
    expect(c.list()).toEqual([
      { from: 0, to: 10 },
      { from: 12, to: 22 },
    ]);
  });

  it("removes deleted text and keeps the rest", function () {
    const c = new Coverage();
    c.add(0, 20);
    c.applyChanges([del(5, 15)]);
    expect(c.list()).toEqual([{ from: 0, to: 10 }]);
  });

  it("does not split when typing at the span edge", function () {
    const c = new Coverage();
    c.add(5, 15);
    c.applyChanges([ins(15, "more")]);
    c.applyChanges([ins(5, "a")]);
    expect(c.list()).toEqual([{ from: 6, to: 16 }]);
  });

  it("covers replaced text when asked to (assistant's own edits)", function () {
    const c = new Coverage();
    c.add(0, 20);
    c.applyChanges([rep(5, 8, "wxyz")], true);
    expect(c.list()).toEqual([{ from: 0, to: 21 }]);
    const d = new Coverage();
    d.add(0, 20);
    d.applyChanges([rep(5, 8, "wxyz")], false);
    expect(d.covers(0, 21)).toBe(false);
    expect(d.covers(0, 5)).toBe(true);
  });
});

describe("sentenceSpans", function () {
  it("splits on terminal punctuation followed by whitespace", function () {
    const text = "One two. Three four! Five?";
    const s = sentenceSpans(text);
    expect(s.map((x) => text.slice(x.from, x.to))).toEqual([
      "One two.",
      "Three four!",
      "Five?",
    ]);
    expect(s.map((x) => x.complete)).toEqual([true, true, true]);
  });

  it("does not split inside decimals or before a lowercase continuation without space", function () {
    const s = sentenceSpans("Pi is 3.14 today. Ok");
    expect(s).toHaveLength(2);
    expect(s[0].to).toBe(17);
  });

  it("treats a line break as a sentence end", function () {
    const s = sentenceSpans("A heading\nSome text here.");
    expect(s[0]).toEqual({ from: 0, to: 9, complete: true });
    expect(s[1].complete).toBe(true);
  });

  it("keeps closing quotes with the sentence", function () {
    const text = 'He said "go." Then left.';
    const s = sentenceSpans(text);
    expect(text.slice(s[0].from, s[0].to)).toBe('He said "go."');
  });
});

describe("pickChunk", function () {
  const opts = { minChars: 30, maxChars: 200 };

  it("waits until enough finished text exists", function () {
    const c = new Coverage();
    expect(pickChunk("Short one. ", c, 11, opts)).toBeNull();
    const text = "This sentence is long enough to send. ";
    expect(pickChunk(text, c, text.length, opts)).toEqual({ from: 0, to: 37 });
  });

  it("never picks the sentence under the cursor", function () {
    const c = new Coverage();
    const text =
      "This sentence is long enough to send. And this one is also quite long enough.";
    expect(pickChunk(text, c, text.length, opts)).toEqual({ from: 0, to: 37 });
    const inside = "This sentence is long enough to send. ";
    expect(pickChunk(inside, c, 10, opts)).toBeNull();
  });

  it("skips sentences already covered and picks the next gap", function () {
    const c = new Coverage();
    c.add(0, 37);
    const text =
      "This sentence is long enough to send. Another sentence that is long enough too. ";
    expect(pickChunk(text, c, text.length, opts)).toEqual({ from: 38, to: 79 });
  });

  it("groups consecutive sentences up to maxChars", function () {
    const c = new Coverage();
    const text =
      "Alpha beta gamma delta epsilon. Zeta eta theta iota kappa. Lambda mu nu xi omicron pi. ";
    const got = pickChunk(text, c, text.length, { minChars: 20, maxChars: 60 });
    expect(text.slice(got.from, got.to)).toBe(
      "Alpha beta gamma delta epsilon. Zeta eta theta iota kappa.",
    );
  });

  it("sends a short sentence when its paragraph has ended", function () {
    const c = new Coverage();
    const text = "Short line here.\nNext";
    expect(pickChunk(text, c, text.length, opts)).toEqual({ from: 0, to: 16 });
  });

  it("returns null when everything is covered", function () {
    const c = new Coverage();
    const text = "This sentence is long enough to send. ";
    c.add(0, 37);
    expect(pickChunk(text, c, text.length, opts)).toBeNull();
  });
});
