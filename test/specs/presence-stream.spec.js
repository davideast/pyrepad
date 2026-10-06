import { describe, it, expect, spyOn } from "bun:test";
import { PresenceStreamHandler } from "../../src/adapters/streams/presence-stream.ts";

function createFakeRef(options = {}) {
  const log = [];
  function makeRef(path) {
    return {
      path,
      child(sub) {
        return makeRef(path ? path + "/" + sub : sub);
      },
      on() {},
      once() {},
      off() {},
      set(value) {
        log.push({ op: "set", path, value });
        return options.setResult ? options.setResult() : Promise.resolve();
      },
      remove() {
        log.push({ op: "remove", path });
        return options.removeResult
          ? options.removeResult()
          : Promise.resolve();
      },
      onDisconnect() {
        return {
          remove() {
            log.push({ op: "onDisconnect.remove", path });
            return Promise.resolve();
          },
          cancel() {
            log.push({ op: "onDisconnect.cancel", path });
            return Promise.resolve();
          },
        };
      },
    };
  }
  return { ref: makeRef(""), log };
}

function createHandler(ref) {
  return new PresenceStreamHandler(
    ref,
    () => "user-1",
    () => "#123456",
    () => {},
  );
}

async function captureUnhandled(fn) {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  // The handler logs the expected "Presence write failed" warnings; keep them out of the run output.
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  process.on("unhandledRejection", onUnhandled);
  try {
    await fn();
    await new Promise((resolve) => setTimeout(resolve, 20));
  } finally {
    process.off("unhandledRejection", onUnhandled);
    warn.mockRestore();
  }
  return unhandled;
}

describe("PresenceStreamHandler (P7)", function () {
  it("registers onDisconnect().remove() for the user's presence node when broadcasting a cursor", async function () {
    const { ref, log } = createFakeRef();
    const handler = createHandler(ref);
    await handler.broadcastPresence({ position: 1, selectionEnd: 1 });
    const disconnect = log.find((e) => e.op === "onDisconnect.remove");
    expect(disconnect).toBeDefined();
    expect(disconnect.path).toBe("users/user-1");
    const set = log.find((e) => e.op === "set");
    expect(set.value).toEqual({
      cursor: { position: 1, selectionEnd: 1 },
      color: "#123456",
    });
  });

  it("awaits set(): broadcastPresence settles only after the write settles", async function () {
    let resolveSet;
    const { ref } = createFakeRef({
      setResult: () => new Promise((resolve) => (resolveSet = resolve)),
    });
    const handler = createHandler(ref);
    let settled = false;
    const p = handler.broadcastPresence({ position: 0, selectionEnd: 0 });
    p.then(() => (settled = true));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);
    resolveSet();
    await p;
    expect(settled).toBe(true);
  });

  it("handles a rejected set() without an unhandled rejection", async function () {
    const { ref } = createFakeRef({
      setResult: () => Promise.reject(new Error("permission_denied")),
    });
    const handler = createHandler(ref);
    const unhandled = await captureUnhandled(async () => {
      handler.broadcastPresence({ position: 0, selectionEnd: 0 });
    });
    expect(unhandled).toEqual([]);
  });

  it("handles a rejected remove() without an unhandled rejection", async function () {
    const { ref } = createFakeRef({
      removeResult: () => Promise.reject(new Error("permission_denied")),
    });
    const handler = createHandler(ref);
    const unhandled = await captureUnhandled(async () => {
      handler.broadcastPresence(null);
      handler.dispose();
    });
    expect(unhandled).toEqual([]);
  });

  it("tolerates refs without onDisconnect", async function () {
    const { ref, log } = createFakeRef();
    const strip = (r) => ({
      child: (p) => strip(r.child(p)),
      on() {},
      once() {},
      off() {},
      set: (v) => r.set(v),
      remove: () => r.remove(),
    });
    const handler = createHandler(strip(ref));
    await handler.broadcastPresence({ position: 2, selectionEnd: 2 });
    expect(log.some((e) => e.op === "set")).toBe(true);
  });
});

describe("PresenceStreamHandler reports failed writes (item 6)", function () {
  it("sends a failed presence write to onError", async function () {
    const { ref } = createFakeRef({
      setResult: () => Promise.reject(new Error("permission_denied")),
    });
    const handler = createHandler(ref);
    const errors = [];
    handler.onError = (e) => errors.push(e);
    await handler.broadcastPresence({ position: 1, selectionEnd: 1 });
    expect(errors).toHaveLength(1);
    expect(errors[0].kind).toBe("presence-failed");
    expect(errors[0].cause.message).toBe("permission_denied");
  });
});
