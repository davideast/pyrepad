import { describe, it, expect } from "bun:test";
import {
  encodeSuggesting,
  encodeResolved,
  decodeMessage,
} from "../../src/suggestions/protocol.ts";

const suggestion = {
  id: "assistant-1",
  agentId: "assistant",
  kind: "typo",
  reason: "spelling",
  from: 20,
  to: 24,
  original: "tyop",
  replacement: "typo",
  status: "pending",
};

describe("suggestion protocol", function () {
  it("round-trips a suggestion through an agentive event", function () {
    const event = encodeSuggesting(suggestion, "has a ");
    expect(event.agentId).toBe("assistant");
    expect(event.slot).toBe("assistant-1");
    expect(event.status).toBe("suggesting");
    expect(decodeMessage(event)).toEqual({
      type: "suggesting",
      id: "assistant-1",
      agentId: "assistant",
      edit: {
        find: "tyop",
        replacement: "typo",
        reason: "spelling",
        kind: "typo",
      },
      before: "has a ",
      hint: 20,
    });
  });

  it("round-trips resolved", function () {
    const event = encodeResolved("assistant", "assistant-1", "accepted");
    expect(decodeMessage(event)).toEqual({
      type: "resolved",
      id: "assistant-1",
      agentId: "assistant",
      resolution: "accepted",
    });
  });

  it("ignores events it does not understand", function () {
    expect(
      decodeMessage({ agentId: "x", status: "thinking", ghostDiff: null }),
    ).toBeNull();
    expect(
      decodeMessage({
        agentId: "x",
        slot: "s",
        status: "suggesting",
        ghostDiff: { find: 3 },
      }),
    ).toBeNull();
    expect(
      decodeMessage({
        agentId: "x",
        slot: "s",
        status: "resolved",
        ghostDiff: { resolution: "bogus" },
      }),
    ).toBeNull();
  });
});
