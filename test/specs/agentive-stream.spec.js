import { describe, it, expect } from "bun:test";
import { AgentiveStreamHandler } from "../../src/adapters/streams/agentive-stream.ts";

function createFakeRef() {
  const listeners = {};
  const writes = [];
  function makeRef(path) {
    return {
      path,
      child(sub) {
        return makeRef(path ? path + "/" + sub : sub);
      },
      on(event, cb) {
        const key = path + ":" + event;
        listeners[key] = listeners[key] || [];
        listeners[key].push(cb);
      },
      once() {},
      off() {},
      set(value) {
        writes.push({ path, value });
        return Promise.resolve();
      },
      remove() {
        return Promise.resolve();
      },
    };
  }
  function fire(path, event, key, value) {
    for (const cb of listeners[path + ":" + event] || []) {
      cb({ key, val: () => value });
    }
  }
  return { ref: makeRef(""), fire, writes };
}

describe("AgentiveStreamHandler (P8, A5)", function () {
  it("emits the agentive event through the adapter hook alongside the stream push", function () {
    const { ref, fire } = createFakeRef();
    const emitted = [];
    const handler = new AgentiveStreamHandler(ref, (evt) => emitted.push(evt));
    const streamed = [];
    handler.stream.subscribe((evt) => streamed.push(evt));
    handler.startMonitoring();

    fire("agentive", "child_added", "agent-7", {
      status: "thinking",
      ghostDiff: null,
      explanation: "Analyzing",
    });

    const expected = {
      agentId: "agent-7",
      status: "thinking",
      ghostDiff: null,
      explanation: "Analyzing",
    };
    expect(streamed).toEqual([expected]);
    expect(emitted).toEqual([expected]);
  });

  it("still streams when no emit hook is supplied", function () {
    const { ref, fire } = createFakeRef();
    const handler = new AgentiveStreamHandler(ref);
    const streamed = [];
    handler.stream.subscribe((evt) => streamed.push(evt));
    handler.startMonitoring();
    fire("agentive", "child_changed", "agent-8", { status: "idle" });
    expect(streamed.length).toBe(1);
    expect(streamed[0].agentId).toBe("agent-8");
  });

  it("broadcastAgentive accepts a single AgentivePresenceEvent", async function () {
    const { ref, writes } = createFakeRef();
    const handler = new AgentiveStreamHandler(ref);
    await handler.broadcastAgentive({
      agentId: "agent-9",
      status: "suggesting",
      ghostDiff: { ops: [1] },
      explanation: "Rename",
    });
    expect(writes.length).toBe(1);
    expect(writes[0].path).toBe("agentive/agent-9");
    expect(writes[0].value.status).toBe("suggesting");
    expect(writes[0].value.ghostDiff).toEqual({ ops: [1] });
    expect(writes[0].value.explanation).toBe("Rename");
  });

  it("broadcastAgentive keeps the deprecated 4-arg form", async function () {
    const { ref, writes } = createFakeRef();
    const handler = new AgentiveStreamHandler(ref);
    await handler.broadcastAgentive("agent-10", "thinking", null, "Hmm");
    expect(writes[0].path).toBe("agentive/agent-10");
    expect(writes[0].value.status).toBe("thinking");
    expect(writes[0].value.ghostDiff).toBe(null);
    expect(writes[0].value.explanation).toBe("Hmm");
  });
});

describe("AgentiveStreamHandler slots", function () {
  it("stores a slotted event under agentId~slot and keeps agentId in the payload", async function () {
    const { ref, writes } = createFakeRef();
    const handler = new AgentiveStreamHandler(ref);
    await handler.broadcastAgentive({
      agentId: "assistant",
      slot: "s1",
      status: "suggesting",
      ghostDiff: { find: "a" },
    });
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe("agentive/assistant~s1");
    expect(writes[0].value.agentId).toBe("assistant");
    expect(writes[0].value.slot).toBe("s1");
  });

  it("keeps the unslotted path and payload unchanged", async function () {
    const { ref, writes } = createFakeRef();
    const handler = new AgentiveStreamHandler(ref);
    await handler.broadcastAgentive({
      agentId: "agent-7",
      status: "thinking",
      ghostDiff: null,
    });
    expect(writes[0].path).toBe("agentive/agent-7");
    expect("slot" in writes[0].value).toBe(false);
    expect("agentId" in writes[0].value).toBe(false);
  });

  it("reads agentId and slot from the payload of a slotted child", function () {
    const { ref, fire } = createFakeRef();
    const handler = new AgentiveStreamHandler(ref);
    const streamed = [];
    handler.stream.subscribe((evt) => streamed.push(evt));
    handler.startMonitoring();
    fire("agentive", "child_added", "assistant~s1", {
      agentId: "assistant",
      slot: "s1",
      status: "suggesting",
      ghostDiff: { find: "a" },
    });
    expect(streamed[0].agentId).toBe("assistant");
    expect(streamed[0].slot).toBe("s1");
  });
});
