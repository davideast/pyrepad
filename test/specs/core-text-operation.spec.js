import { describe, it, expect } from "bun:test";
import { TextOperation } from "../../src/core/index.ts";

// Direct specs of src/core TextOperation: builder invariants, apply, invert,
// equals and JSON round-trip. Random loops use a seeded PRNG so any failure
// reproduces exactly.

function mulberry32(seed) {
  return function () {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeGen(seed) {
  const rand = mulberry32(seed);
  const int = function (n) {
    return Math.floor(rand() * n);
  };
  const str = function (n) {
    let s = "";
    while (n--) s += rand() < 0.15 ? "\n" : String.fromCharCode(97 + int(26));
    return s;
  };
  const attrs = function (allowFalse) {
    const names = ["b", "i", "u", "color"];
    const values = [true, "red", 3, "x"];
    if (allowFalse) values.push(false);
    const a = {};
    const count = int(3);
    for (let k = 0; k < count; k++) {
      a[names[int(names.length)]] = values[int(values.length)];
    }
    return a;
  };
  const op = function (doc, useAttrs) {
    const o = new TextOperation();
    while (true) {
      const left = doc.length - o.baseLength;
      if (left === 0) break;
      const r = rand();
      const l = 1 + int(Math.min(left - 1, 20));
      if (r < 0.2) o.insert(str(l), useAttrs ? attrs(false) : {});
      else if (r < 0.4) o.delete(l);
      else o.retain(l, useAttrs ? attrs(true) : {});
    }
    if (rand() < 0.3) o.insert("z" + str(10));
    return o;
  };
  return { rand: rand, int: int, str: str, op: op };
}

const ITERATIONS = 300;

describe("core TextOperation: builder invariants", function () {
  it("tracks baseLength and targetLength across retain/insert/delete", function () {
    const o = new TextOperation();
    expect(o.baseLength).toBe(0);
    expect(o.targetLength).toBe(0);
    o.retain(5);
    expect([o.baseLength, o.targetLength]).toEqual([5, 5]);
    o.insert("abc");
    expect([o.baseLength, o.targetLength]).toEqual([5, 8]);
    o.retain(2);
    expect([o.baseLength, o.targetLength]).toEqual([7, 10]);
    o.delete(2);
    expect([o.baseLength, o.targetLength]).toEqual([9, 10]);
  });

  it("merges adjacent ops of the same kind and ignores zero-length ops", function () {
    const o = new TextOperation()
      .retain(0)
      .insert("")
      .delete(0)
      .retain(2)
      .retain(3)
      .insert("a")
      .insert("b")
      .delete(1)
      .delete(2);
    expect(o.ops.length).toBe(3);
    expect(o.toJSON()).toEqual([5, "ab", -3]);
  });

  it("delete(string) deletes string.length characters", function () {
    const o = new TextOperation().delete("abc");
    expect(o.baseLength).toBe(3);
    expect(o.toJSON()).toEqual([-3]);
  });

  it("canonicalises insert-after-delete to insert-before-delete", function () {
    const o = new TextOperation().retain(1).delete(2).insert("x");
    expect(o.toJSON()).toEqual([1, "x", -2]);
    // a further insert with equal attributes merges into the first insert
    o.insert("y");
    expect(o.toJSON()).toEqual([1, "xy", -2]);
  });

  it("rejects invalid arguments", function () {
    expect(function () {
      new TextOperation().retain(-1);
    }).toThrow();
    expect(function () {
      new TextOperation().delete(-1);
    }).toThrow();
    expect(function () {
      new TextOperation().insert(3);
    }).toThrow();
  });

  it("isNoop is true for an empty op and a plain retain, false otherwise", function () {
    expect(new TextOperation().isNoop()).toBe(true);
    expect(new TextOperation().retain(4).isNoop()).toBe(true);
    expect(new TextOperation().retain(4, { b: true }).isNoop()).toBe(false);
    expect(new TextOperation().insert("a").isNoop()).toBe(false);
    expect(new TextOperation().delete(1).isNoop()).toBe(false);
  });

  it("random ops: baseLength matches the doc and apply yields targetLength chars", function () {
    const g = makeGen(0x5eed01);
    for (let n = 0; n < ITERATIONS; n++) {
      const doc = g.str(g.int(50));
      const o = g.op(doc, n % 2 === 0);
      expect(o.baseLength).toBe(doc.length);
      expect(o.apply(doc).length).toBe(o.targetLength);
    }
  });
});

describe("core TextOperation: apply", function () {
  it("applies a mixed operation", function () {
    const o = new TextOperation().retain(6).delete(5).insert("pyric").retain(1);
    expect(o.apply("hello world!")).toBe("hello pyric!");
  });

  it("throws when the base length does not match the string", function () {
    const o = new TextOperation().retain(3);
    expect(function () {
      o.apply("ab");
    }).toThrow();
    expect(function () {
      o.apply("abcd");
    }).toThrow();
  });

  it("applies attributes to retained and inserted characters", function () {
    const o = new TextOperation()
      .retain(1, { b: true })
      .insert("x", { i: true })
      .retain(1, { u: false });
    const oldAttrs = [{}, { u: true, c: 1 }];
    const newAttrs = [];
    expect(o.apply("ab", oldAttrs, newAttrs)).toBe("axb");
    expect(newAttrs).toEqual([{ b: true }, { i: true }, { c: 1 }]);
  });
});

describe("core TextOperation: invert", function () {
  it("inverts insert and delete", function () {
    const doc = "abcdef";
    const o = new TextOperation().retain(1).delete(2).insert("XY").retain(3);
    const after = o.apply(doc);
    expect(after).toBe("aXYdef");
    const inv = o.invert(doc);
    expect(inv.baseLength).toBe(o.targetLength);
    expect(inv.targetLength).toBe(o.baseLength);
    expect(inv.apply(after)).toBe(doc);
  });

  it("random ops: apply(invert(a), apply(a, s)) === s", function () {
    const g = makeGen(0x5eed02);
    for (let n = 0; n < ITERATIONS; n++) {
      const doc = g.str(g.int(50));
      const o = g.op(doc, false);
      const inv = o.invert(doc);
      expect(inv.baseLength).toBe(o.targetLength);
      expect(inv.targetLength).toBe(o.baseLength);
      expect(inv.apply(o.apply(doc))).toBe(doc);
    }
  });
});

describe("core TextOperation: equals", function () {
  it("is structural, including attributes and lengths", function () {
    const a = new TextOperation().retain(2).insert("x", { b: true }).delete(1);
    const b = new TextOperation()
      .retain(1)
      .retain(1)
      .insert("x", { b: true })
      .delete(1);
    expect(a.equals(b)).toBe(true);
    expect(b.equals(a)).toBe(true);
    expect(a.equals(new TextOperation().retain(2).insert("x").delete(1))).toBe(false);
    expect(
      a.equals(new TextOperation().retain(2).insert("y", { b: true }).delete(1)),
    ).toBe(false);
    expect(
      a.equals(new TextOperation().retain(3).insert("x", { b: true }).delete(1)),
    ).toBe(false);
  });

  it("random ops: a.equals(a.clone()) and the clone is independent", function () {
    const g = makeGen(0x5eed03);
    for (let n = 0; n < ITERATIONS; n++) {
      const doc = g.str(g.int(50));
      const o = g.op(doc, true);
      const c = o.clone();
      expect(o.equals(c)).toBe(true);
      c.insert("tail");
      expect(o.equals(c)).toBe(false);
    }
  });
});

describe("core TextOperation: JSON", function () {
  it("serialises retain/insert/delete with attribute prefixes", function () {
    const o = new TextOperation()
      .retain(2, { b: true })
      .insert("hi")
      .delete(3)
      .retain(1);
    expect(o.toJSON()).toEqual([{ b: true }, 2, "hi", -3, 1]);
  });

  it("serialises an empty operation as [0] and reads it back", function () {
    expect(new TextOperation().toJSON()).toEqual([0]);
    expect(TextOperation.fromJSON([0]).equals(new TextOperation())).toBe(true);
  });

  it("random ops: fromJSON(toJSON(a)) equals a", function () {
    const g = makeGen(0x5eed04);
    for (let n = 0; n < ITERATIONS; n++) {
      const doc = g.str(g.int(50));
      const o = g.op(doc, true);
      const json = JSON.parse(JSON.stringify(o.toJSON()));
      const back = TextOperation.fromJSON(json);
      expect(back.equals(o)).toBe(true);
      expect(back.toJSON()).toEqual(o.toJSON());
    }
  });
});
