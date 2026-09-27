import { describe, it, expect } from "bun:test";
import { TextOperation } from "../../src/core/index.ts";

// Direct specs of src/core TextOperation: builder invariants, apply, invert,
// equals and JSON round-trip. Random loops use a seeded PRNG so any failure
// reproduces exactly.

function mulberry32(seed) {
  return function () {
    seed = (seed + 0x6d2b79f5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeGen(seed) {
  var rand = mulberry32(seed);
  var int = function (n) {
    return Math.floor(rand() * n);
  };
  var str = function (n) {
    var s = "";
    while (n--) s += rand() < 0.15 ? "\n" : String.fromCharCode(97 + int(26));
    return s;
  };
  var attrs = function (allowFalse) {
    var names = ["b", "i", "u", "color"];
    var values = [true, "red", 3, "x"];
    if (allowFalse) values.push(false);
    var a = {};
    var count = int(3);
    for (var k = 0; k < count; k++) {
      a[names[int(names.length)]] = values[int(values.length)];
    }
    return a;
  };
  var op = function (doc, useAttrs) {
    var o = new TextOperation();
    while (true) {
      var left = doc.length - o.baseLength;
      if (left === 0) break;
      var r = rand();
      var l = 1 + int(Math.min(left - 1, 20));
      if (r < 0.2) o.insert(str(l), useAttrs ? attrs(false) : {});
      else if (r < 0.4) o.delete(l);
      else o.retain(l, useAttrs ? attrs(true) : {});
    }
    if (rand() < 0.3) o.insert("z" + str(10));
    return o;
  };
  return { rand: rand, int: int, str: str, op: op };
}

var ITERATIONS = 300;

describe("core TextOperation: builder invariants", function () {
  it("tracks baseLength and targetLength across retain/insert/delete", function () {
    var o = new TextOperation();
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
    var o = new TextOperation()
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
    var o = new TextOperation().delete("abc");
    expect(o.baseLength).toBe(3);
    expect(o.toJSON()).toEqual([-3]);
  });

  it("canonicalises insert-after-delete to insert-before-delete", function () {
    var o = new TextOperation().retain(1).delete(2).insert("x");
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
    var g = makeGen(0x5eed01);
    for (var n = 0; n < ITERATIONS; n++) {
      var doc = g.str(g.int(50));
      var o = g.op(doc, n % 2 === 0);
      expect(o.baseLength).toBe(doc.length);
      expect(o.apply(doc).length).toBe(o.targetLength);
    }
  });
});

describe("core TextOperation: apply", function () {
  it("applies a mixed operation", function () {
    var o = new TextOperation().retain(6).delete(5).insert("pyric").retain(1);
    expect(o.apply("hello world!")).toBe("hello pyric!");
  });

  it("throws when the base length does not match the string", function () {
    var o = new TextOperation().retain(3);
    expect(function () {
      o.apply("ab");
    }).toThrow();
    expect(function () {
      o.apply("abcd");
    }).toThrow();
  });

  it("applies attributes to retained and inserted characters", function () {
    var o = new TextOperation()
      .retain(1, { b: true })
      .insert("x", { i: true })
      .retain(1, { u: false });
    var oldAttrs = [{}, { u: true, c: 1 }];
    var newAttrs = [];
    expect(o.apply("ab", oldAttrs, newAttrs)).toBe("axb");
    expect(newAttrs).toEqual([{ b: true }, { i: true }, { c: 1 }]);
  });
});

describe("core TextOperation: invert", function () {
  it("inverts insert and delete", function () {
    var doc = "abcdef";
    var o = new TextOperation().retain(1).delete(2).insert("XY").retain(3);
    var after = o.apply(doc);
    expect(after).toBe("aXYdef");
    var inv = o.invert(doc);
    expect(inv.baseLength).toBe(o.targetLength);
    expect(inv.targetLength).toBe(o.baseLength);
    expect(inv.apply(after)).toBe(doc);
  });

  it("random ops: apply(invert(a), apply(a, s)) === s", function () {
    var g = makeGen(0x5eed02);
    for (var n = 0; n < ITERATIONS; n++) {
      var doc = g.str(g.int(50));
      var o = g.op(doc, false);
      var inv = o.invert(doc);
      expect(inv.baseLength).toBe(o.targetLength);
      expect(inv.targetLength).toBe(o.baseLength);
      expect(inv.apply(o.apply(doc))).toBe(doc);
    }
  });
});

describe("core TextOperation: equals", function () {
  it("is structural, including attributes and lengths", function () {
    var a = new TextOperation().retain(2).insert("x", { b: true }).delete(1);
    var b = new TextOperation()
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
    var g = makeGen(0x5eed03);
    for (var n = 0; n < ITERATIONS; n++) {
      var doc = g.str(g.int(50));
      var o = g.op(doc, true);
      var c = o.clone();
      expect(o.equals(c)).toBe(true);
      c.insert("tail");
      expect(o.equals(c)).toBe(false);
    }
  });
});

describe("core TextOperation: JSON", function () {
  it("serialises retain/insert/delete with attribute prefixes", function () {
    var o = new TextOperation()
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
    var g = makeGen(0x5eed04);
    for (var n = 0; n < ITERATIONS; n++) {
      var doc = g.str(g.int(50));
      var o = g.op(doc, true);
      var json = JSON.parse(JSON.stringify(o.toJSON()));
      var back = TextOperation.fromJSON(json);
      expect(back.equals(o)).toBe(true);
      expect(back.toJSON()).toEqual(o.toJSON());
    }
  });
});
