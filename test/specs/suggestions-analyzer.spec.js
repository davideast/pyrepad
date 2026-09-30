import { describe, it, expect } from "bun:test";
import { SuggestionAnalyzer } from "../../src/suggestions/analyzer.ts";
import { SuggestionBook } from "../../src/suggestions/suggestion-book.ts";

const KINDS = ["typo", "grammar"];

function harness(overrides = {}) {
  const calls = [];
  const proposer = (request, signal) =>
    new Promise((resolve, reject) => {
      const call = { request, signal, resolve, reject };
      signal?.addEventListener("abort", () =>
        reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
      );
      calls.push(call);
    });
  let clock = 0;
  const timers = [];
  const book = new SuggestionBook();
  const analyzer = new SuggestionAnalyzer({
    proposer,
    book,
    getInstructions: () => "be kind",
    getKinds: () => KINDS,
    minChars: 20,
    minGapMs: 100,
    now: () => clock,
    schedule: (fn, ms) => {
      const t = { fn, at: clock + ms, live: true };
      timers.push(t);
      return () => (t.live = false);
    },
    ...overrides,
  });
  const advance = (ms) => {
    clock += ms;
    for (const t of timers) {
      if (t.live && t.at <= clock) {
        t.live = false;
        t.fn();
      }
    }
  };
  let text = "";
  const type = (insert, at = text.length) => {
    const changes = [{ from: at, to: at, insert }];
    text = text.slice(0, at) + insert + text.slice(at);
    book.applyChanges(changes);
    analyzer.update({ text, changes, cursor: at + insert.length });
  };
  return { analyzer, book, calls, type, advance, getText: () => text };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("SuggestionAnalyzer", function () {
  it("asks the proposer to revise a suggestion using the reviewer's comment", async function () {
    const h = harness();
    h.type("This sentence has a tyop in it.\n\n");
    h.calls[0].resolve([
      { find: "tyop", replacement: "typo", reason: "spelling", kind: "typo" },
    ]);
    await flush();
    const [suggestion] = h.book.list();
    const revised = h.analyzer.revise(suggestion, "use the word error");
    expect(h.calls[1].request.text).toBe("tyop");
    expect(h.calls[1].request.revision).toEqual({
      replacement: "typo",
      comment: "use the word error",
    });
    h.calls[1].resolve([
      { find: "tyop", replacement: "error", reason: "as asked", kind: "typo" },
    ]);
    expect(await revised).toMatchObject({ find: "tyop", replacement: "error" });
  });

  it("retries a sentence whose review failed", async function () {
    const h = harness();
    h.type("This sentence has a tyop in it.\n\n");
    expect(h.calls).toHaveLength(1);
    h.calls[0].reject(new Error("429"));
    await flush();
    h.advance(2999);
    expect(h.calls).toHaveLength(1);
    h.advance(1);
    expect(h.calls).toHaveLength(2);
  });

  it("reviews the sentence under the cursor once typing goes idle", function () {
    const h = harness({ idleMs: 500 });
    h.type("This last sentence has a tyop in it.");
    expect(h.calls).toHaveLength(0);
    h.advance(499);
    expect(h.calls).toHaveLength(0);
    h.advance(1);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].request.text).toBe(
      "This last sentence has a tyop in it.",
    );
  });

  it("skips text an earlier session already reviewed", async function () {
    const first = harness();
    first.type(
      "This sentence has a tyop in it. Another finished sentence here. ",
    );
    for (let i = 0; i < 3; i++) {
      for (const call of first.calls) call.resolve([]);
      await flush();
      first.advance(200);
    }
    const saved = first.analyzer.reviewedText();
    expect(saved.length).toBeGreaterThan(0);

    const second = harness();
    second.analyzer.setEnabled(false);
    second.type(
      "This sentence has a tyop in it. Another finished sentence here. ",
    );
    second.analyzer.restoreReviewed(saved);
    second.analyzer.setEnabled(true);
    expect(second.calls).toHaveLength(0);
  });

  it("does not send the sentence still being typed", function () {
    const h = harness();
    h.type("This sentence is being typed right now");
    expect(h.calls).toHaveLength(0);
    h.type(".");
    expect(h.calls).toHaveLength(0);
  });

  it("sends a finished sentence without waiting for a pause", function () {
    const h = harness();
    h.type("This sentence has a tyop in it. ");
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].request.text).toBe("This sentence has a tyop in it.");
    expect(h.calls[0].request.instructions).toBe("be kind");
    expect(h.calls[0].request.kinds).toEqual(KINDS);
  });

  it("keeps sending later sentences while an earlier request is running", function () {
    const h = harness();
    h.type("This sentence has a tyop in it. ");
    h.type("And here is a second finished sentence. ");
    h.advance(100);
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1].request.text).toBe(
      "And here is a second finished sentence.",
    );
  });

  it("rate limits dispatches and caps concurrency", function () {
    const h = harness({ maxInFlight: 1 });
    h.type("This sentence has a tyop in it. ");
    h.type("And here is a second finished sentence. ");
    h.advance(500);
    expect(h.calls).toHaveLength(1);
  });

  it("reports the in-flight span and tracks it through edits", function () {
    const h = harness();
    h.type("This sentence has a tyop in it. ");
    const [span] = h.analyzer.inflight();
    expect(span).toMatchObject({ from: 0, to: 31 });
    h.type(">> ", 0);
    expect(h.analyzer.inflight()[0]).toMatchObject({ from: 3, to: 34 });
  });

  it("places returned edits as suggestions and emits proposed", async function () {
    const h = harness();
    const proposed = [];
    h.analyzer.on("proposed", (s) => proposed.push(s));
    h.type("This sentence has a tyop in it. ");
    h.calls[0].resolve([
      { find: "tyop", replacement: "typo", reason: "spelling", kind: "typo" },
    ]);
    await flush();
    expect(h.book.list()).toHaveLength(1);
    expect(proposed[0]).toMatchObject({
      original: "tyop",
      replacement: "typo",
    });
    expect(h.analyzer.inflight()).toHaveLength(0);
  });

  it("rebases a suggestion when the user typed before it while the request ran", async function () {
    const h = harness();
    h.type("This sentence has a tyop in it. ");
    h.type("Keep typing more words here", 0);
    h.calls[0].resolve([
      { find: "tyop", replacement: "typo", reason: "r", kind: "typo" },
    ]);
    await flush();
    const [s] = h.book.list();
    expect(h.getText().slice(s.from, s.to)).toBe("tyop");
  });

  it("drops an edit whose quote was edited away during the request", async function () {
    const h = harness();
    h.type("This sentence has a tyop in it. ");
    const at = h.getText().indexOf("tyop");
    h.type("", at);
    h.analyzer.update({
      text: h.getText().replace("tyop", "typo"),
      changes: [{ from: at, to: at + 4, insert: "typo" }],
      cursor: 0,
    });
    h.calls[0].resolve([
      { find: "tyop", replacement: "typo", reason: "r", kind: "typo" },
    ]);
    await flush();
    expect(h.book.list()).toHaveLength(0);
  });

  it("ignores edits with a kind the user turned off", async function () {
    const h = harness();
    h.type("This sentence has a tyop in it. ");
    h.calls[0].resolve([
      { find: "tyop", replacement: "typo", reason: "r", kind: "tone" },
    ]);
    await flush();
    expect(h.book.list()).toHaveLength(0);
  });

  it("re-reviews text that was edited, but not untouched text", async function () {
    const h = harness();
    h.type("This sentence has a tyop in it. ");
    h.calls[0].resolve([]);
    await flush();
    h.advance(100);
    expect(h.calls).toHaveLength(1);
    const at = h.getText().indexOf("sentence");
    const changes = [{ from: at, to: at, insert: "long " }];
    const text = h.getText().slice(0, at) + "long " + h.getText().slice(at);
    h.analyzer.update({ text, changes, cursor: text.length });
    h.advance(100);
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1].request.text).toContain("long sentence");
  });

  it("does not re-review the assistant's own accepted text", async function () {
    const h = harness();
    h.type("This sentence has a tyop in it. ");
    h.calls[0].resolve([]);
    await flush();
    const at = h.getText().indexOf("tyop");
    const changes = [{ from: at, to: at + 4, insert: "typo" }];
    const text = h.getText().replace("tyop", "typo");
    h.analyzer.update({
      text,
      changes,
      cursor: text.length,
      fromAssistant: true,
    });
    h.advance(1000);
    expect(h.calls).toHaveLength(1);
  });

  it("reset aborts in-flight work and reviews everything again", async function () {
    const h = harness();
    h.type("This sentence has a tyop in it. ");
    h.analyzer.reset();
    expect(h.calls[0].signal.aborted).toBe(true);
    h.advance(100);
    expect(h.calls).toHaveLength(2);
    h.calls[0].resolve([
      { find: "tyop", replacement: "typo", reason: "r", kind: "typo" },
    ]);
    await flush();
    expect(h.book.list()).toHaveLength(0);
  });

  it("emits error and keeps going when the proposer fails", async function () {
    const h = harness();
    const errors = [];
    h.analyzer.on("error", (e) => errors.push(e));
    h.type("This sentence has a tyop in it. ");
    h.calls[0].reject(new Error("boom"));
    await flush();
    expect(errors).toHaveLength(1);
    expect(h.analyzer.inflight()).toHaveLength(0);
  });

  it("stops sending when disabled", function () {
    const h = harness();
    h.analyzer.setEnabled(false);
    h.type("This sentence has a tyop in it. ");
    expect(h.calls).toHaveLength(0);
    h.analyzer.setEnabled(true);
    expect(h.calls).toHaveLength(1);
  });
});
