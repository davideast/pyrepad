import { describe, it, expect } from "bun:test";
import {
  createGeminiProposer,
  parseProposedEdits,
} from "../../src/suggestions/gemini-proposer.ts";

const request = {
  text: "Teh cat sat on the the mat.",
  before: "Earlier sentence.",
  after: "Later sentence.",
  instructions: "Fix typos only.",
  kinds: ["typo", "grammar"],
};

function fakeModel(reply, seen) {
  return {
    async generateContent(req, options) {
      seen.push({ req, options });
      const text = typeof reply === "function" ? reply(req) : reply;
      return { response: { text: () => text } };
    },
  };
}

describe("createGeminiProposer", () => {
  it("asks for structured JSON and puts every input in the prompt", async () => {
    const seen = [];
    const propose = createGeminiProposer(fakeModel("[]", seen));
    await propose(request);
    const { req } = seen[0];
    expect(req.generationConfig.responseMimeType).toBe("application/json");
    const item = req.generationConfig.responseSchema.items;
    expect(item.required).toEqual([
      "type",
      "find",
      "replacement",
      "reason",
      "kind",
    ]);
    expect(item.properties.kind.enum).toEqual(["typo", "grammar"]);
    expect(req.systemInstruction).toContain("verbatim");
    const prompt = req.contents[0].parts[0].text;
    for (const piece of [
      "Fix typos only.",
      "typo, grammar",
      "Earlier sentence.",
      "Teh cat sat on the the mat.",
      "Later sentence.",
    ]) {
      expect(prompt).toContain(piece);
    }
    expect(prompt.indexOf("Earlier sentence.")).toBeLessThan(
      prompt.indexOf("Teh cat"),
    );
    expect(prompt.indexOf("Teh cat")).toBeLessThan(
      prompt.indexOf("Later sentence."),
    );
  });

  it("returns valid edits", async () => {
    const reply = JSON.stringify([
      { find: "Teh", replacement: "The", reason: "Typo.", kind: "typo" },
      {
        find: "the the",
        replacement: "the",
        reason: "Doubled.",
        kind: "grammar",
      },
    ]);
    const propose = createGeminiProposer(fakeModel(reply, []));
    const edits = await propose(request);
    expect(edits.map((e) => e.find)).toEqual(["Teh", "the the"]);
    expect(edits[0]).toEqual({
      find: "Teh",
      replacement: "The",
      reason: "Typo.",
      kind: "typo",
    });
  });

  it("strips code fences", async () => {
    const reply =
      '```json\n[{"find":"Teh","replacement":"The","reason":"Typo.","kind":"typo"}]\n```';
    const edits = await createGeminiProposer(fakeModel(reply, []))(request);
    expect(edits).toHaveLength(1);
  });

  it("returns [] for malformed output instead of throwing", async () => {
    for (const reply of ["", "not json", "{", "null", "42", '"str"', "{}"]) {
      const edits = await createGeminiProposer(fakeModel(reply, []))(request);
      expect(edits).toEqual([]);
    }
  });

  it("tolerates a wrapped array or a single object", async () => {
    const one = {
      find: "Teh",
      replacement: "The",
      reason: "Typo.",
      kind: "typo",
    };
    const wrapped = await createGeminiProposer(
      fakeModel(JSON.stringify({ edits: [one] }), []),
    )(request);
    const single = await createGeminiProposer(
      fakeModel(JSON.stringify(one), []),
    )(request);
    expect(wrapped).toEqual([one]);
    expect(single).toEqual([one]);
  });

  it("drops empty, identical, non-string, unquoted, and duplicate entries", () => {
    const good = {
      find: "Teh",
      replacement: "The",
      reason: "Typo.",
      kind: "typo",
    };
    const raw = JSON.stringify([
      { ...good, find: "" },
      { ...good, replacement: "Teh" },
      { ...good, reason: 3 },
      { ...good, kind: null },
      { ...good, find: "not in the text" },
      "junk",
      null,
      good,
      good,
    ]);
    expect(parseProposedEdits(raw, request.text)).toEqual([good]);
  });

  it("keeps an empty replacement as a deletion", () => {
    const raw = JSON.stringify([
      { find: " the", replacement: "", reason: "Doubled.", kind: "grammar" },
    ]);
    expect(parseProposedEdits(raw, request.text)).toHaveLength(1);
  });

  it("caps the number of edits", async () => {
    const text = "a b c d e f g h i j k l";
    const many = text.split(" ").map((w) => ({
      find: w,
      replacement: w.toUpperCase(),
      reason: "Caps.",
      kind: "typo",
    }));
    const propose = createGeminiProposer(fakeModel(JSON.stringify(many), []));
    expect(await propose({ ...request, text })).toHaveLength(8);
    const small = createGeminiProposer(fakeModel(JSON.stringify(many), []), {
      maxEdits: 3,
    });
    expect(await small({ ...request, text })).toHaveLength(3);
  });

  it("passes the signal through to the model", async () => {
    const seen = [];
    const controller = new AbortController();
    await createGeminiProposer(fakeModel("[]", seen))(
      request,
      controller.signal,
    );
    expect(seen[0].options.signal).toBe(controller.signal);
  });

  it("rejects with an AbortError when already aborted, without calling the model", async () => {
    const seen = [];
    const controller = new AbortController();
    controller.abort();
    const promise = createGeminiProposer(fakeModel("[]", seen))(
      request,
      controller.signal,
    );
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(seen).toHaveLength(0);
  });

  it("rejects with an AbortError when aborted mid-flight, even if the model ignores the signal", async () => {
    const controller = new AbortController();
    const slow = {
      generateContent: () => new Promise(() => {}),
    };
    const promise = createGeminiProposer(slow)(request, controller.signal);
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });

  it("propagates model failures", async () => {
    const failing = {
      generateContent: async () => {
        throw new Error("boom");
      },
    };
    await expect(createGeminiProposer(failing)(request)).rejects.toThrow(
      "boom",
    );
  });
});

describe("parseProposedEdits response modes", () => {
  const edit = {
    type: "edit",
    find: "Teh",
    replacement: "The",
    reason: "Typo.",
    kind: "typo",
  };
  const remark = {
    type: "comment",
    find: "cat",
    replacement: "",
    reason: "Vague.",
    kind: "clarity",
  };
  const raw = JSON.stringify([edit, remark]);

  it("drops comments in suggest mode", () => {
    const out = parseProposedEdits(raw, request.text, 10, "suggest");
    expect(out.map((e) => e.type ?? "edit")).toEqual(["edit"]);
  });

  it("turns every item into a comment in comment mode", () => {
    const out = parseProposedEdits(raw, request.text, 10, "comment");
    expect(out.every((e) => e.type === "comment")).toBe(true);
    expect(out.length).toBe(2);
  });

  it("honours the type in both mode", () => {
    const out = parseProposedEdits(raw, request.text, 10, "both");
    expect(out.map((e) => e.type ?? "edit")).toEqual(["edit", "comment"]);
  });
});
