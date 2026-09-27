import { describe, it, expect } from "bun:test";
import { Emitter } from "../../src/core/emitter.ts";

describe("Emitter (A3)", function () {
  it("delivers trigger() args to every listener in registration order", function () {
    const emitter = new Emitter();
    const calls = [];
    emitter.on("change", (a, b) => calls.push(["first", a, b]));
    emitter.on("change", (a, b) => calls.push(["second", a, b]));
    emitter.trigger("change", 1, 2);
    expect(calls).toEqual([
      ["first", 1, 2],
      ["second", 1, 2],
    ]);
  });

  it("once() fires a single time", function () {
    const emitter = new Emitter();
    let count = 0;
    emitter.once("ready", () => count++);
    emitter.trigger("ready");
    emitter.trigger("ready");
    expect(count).toBe(1);
  });

  it("off(event, fn) removes one listener, off(event) removes the event, off() removes all", function () {
    const emitter = new Emitter();
    const seen = [];
    const a = () => seen.push("a");
    const b = () => seen.push("b");
    emitter.on("x", a);
    emitter.on("x", b);
    emitter.on("y", a);
    emitter.off("x", a);
    emitter.trigger("x");
    expect(seen).toEqual(["b"]);

    emitter.off("x");
    emitter.trigger("x");
    expect(seen).toEqual(["b"]);
    expect(Object.keys(emitter.listeners)).toEqual(["y"]);

    emitter.off();
    emitter.trigger("y");
    expect(seen).toEqual(["b"]);
    expect(Object.keys(emitter.listeners).length).toBe(0);
  });

  it("a listener removed during trigger() still runs for that trigger (snapshot)", function () {
    const emitter = new Emitter();
    const seen = [];
    const second = () => seen.push("second");
    emitter.on("x", () => {
      seen.push("first");
      emitter.off("x", second);
    });
    emitter.on("x", second);
    emitter.trigger("x");
    emitter.trigger("x");
    expect(seen).toEqual(["first", "second", "first"]);
  });

  it("trigger() with no listeners is a no-op", function () {
    const emitter = new Emitter();
    expect(() => emitter.trigger("nothing", 1)).not.toThrow();
  });
});
