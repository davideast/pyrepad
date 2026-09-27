import { describe, it, expect } from "bun:test";
import { TextOperation, WrappedOperation } from "../../src/core/index.ts";

// Direct specs of src/core transformation math (TextOperation.transform,
// TextOperation.transformAttributes, WrappedOperation.transform).

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
  var attrsArray = function (n) {
    var arr = [];
    for (var k = 0; k < n; k++) arr.push(attrs(false));
    return arr;
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
  return { rand: rand, int: int, str: str, op: op, attrsArray: attrsArray };
}

var ITERATIONS = 300;

describe("core transform: TP1 apply(b', apply(a, s)) === apply(a', apply(b, s))", function () {
  it("deterministic: concurrent inserts at the same position (a wins the tie)", function () {
    var doc = "abc";
    var a = new TextOperation().retain(1).insert("X").retain(2);
    var b = new TextOperation().retain(1).insert("Y").retain(2);
    var pair = TextOperation.transform(a, b);
    var aPrime = pair[0];
    var bPrime = pair[1];
    expect(bPrime.apply(a.apply(doc))).toBe("aXYbc");
    expect(aPrime.apply(b.apply(doc))).toBe("aXYbc");
  });

  it("deterministic: overlapping deletes", function () {
    var doc = "abcdef";
    var a = new TextOperation().retain(1).delete(3).retain(2); // remove bcd
    var b = new TextOperation().retain(2).delete(3).retain(1); // remove cde
    var pair = a.transform(b);
    expect(pair[1].apply(a.apply(doc))).toBe("af");
    expect(pair[0].apply(b.apply(doc))).toBe("af");
  });

  it("deterministic: insert inside a concurrently deleted range survives", function () {
    var doc = "abcdef";
    var a = new TextOperation().retain(3).insert("X").retain(3);
    var b = new TextOperation().retain(1).delete(4).retain(1);
    var pair = TextOperation.transform(a, b);
    expect(pair[1].apply(a.apply(doc))).toBe("aXf");
    expect(pair[0].apply(b.apply(doc))).toBe("aXf");
  });

  it("length invariants: a'.base === b.target, b'.base === a.target, targets agree", function () {
    var a = new TextOperation().retain(2).insert("hello").delete(1);
    var b = new TextOperation().delete(2).retain(1).insert("!!");
    var pair = TextOperation.transform(a, b);
    expect(pair[0].baseLength).toBe(b.targetLength);
    expect(pair[1].baseLength).toBe(a.targetLength);
    expect(pair[0].targetLength).toBe(pair[1].targetLength);
  });

  it("throws when base lengths differ", function () {
    expect(function () {
      TextOperation.transform(new TextOperation().retain(2), new TextOperation().retain(3));
    }).toThrow();
  });

  it("does not mutate its inputs", function () {
    var a = new TextOperation().retain(2).insert("x").delete(2);
    var b = new TextOperation().delete(3).retain(1);
    var aJson = a.toJSON();
    var bJson = b.toJSON();
    TextOperation.transform(a, b);
    expect(a.toJSON()).toEqual(aJson);
    expect(b.toJSON()).toEqual(bJson);
  });

  it("random ops (plain text)", function () {
    var g = makeGen(0x7a4501);
    for (var n = 0; n < ITERATIONS; n++) {
      var doc = g.str(g.int(40));
      var a = g.op(doc, false);
      var b = g.op(doc, false);
      var pair = TextOperation.transform(a, b);
      var aPrime = pair[0];
      var bPrime = pair[1];
      expect(aPrime.baseLength).toBe(b.targetLength);
      expect(bPrime.baseLength).toBe(a.targetLength);
      expect(bPrime.apply(a.apply(doc))).toBe(aPrime.apply(b.apply(doc)));
    }
  });

  it("random ops: compose(a, b') and compose(b, a') converge on the same text", function () {
    var g = makeGen(0x7a4502);
    for (var n = 0; n < ITERATIONS; n++) {
      var doc = g.str(g.int(40));
      var a = g.op(doc, false);
      var b = g.op(doc, false);
      var pair = TextOperation.transform(a, b);
      var viaA = a.compose(pair[1]);
      var viaB = b.compose(pair[0]);
      expect(viaA.apply(doc)).toBe(viaB.apply(doc));
    }
  });

  it("random ops (with attributes): text and resulting attributes converge", function () {
    var g = makeGen(0x7a4503);
    for (var n = 0; n < ITERATIONS; n++) {
      var doc = g.str(g.int(40));
      var docAttrs = g.attrsArray(doc.length);
      var a = g.op(doc, true);
      var b = g.op(doc, true);
      var pair = TextOperation.transform(a, b);

      var afterAAttrs = [];
      var afterA = a.apply(doc, docAttrs, afterAAttrs);
      var abAttrs = [];
      var ab = pair[1].apply(afterA, afterAAttrs, abAttrs);

      var afterBAttrs = [];
      var afterB = b.apply(doc, docAttrs, afterBAttrs);
      var baAttrs = [];
      var ba = pair[0].apply(afterB, afterBAttrs, baAttrs);

      expect(ab).toBe(ba);
      expect(abAttrs).toEqual(baAttrs);
    }
  });
});

describe("core transform: transformAttributes", function () {
  it("keeps attributes only one side set, and lets the first side win conflicts", function () {
    var pair = TextOperation.transformAttributes(
      { b: true, color: "red", i: true },
      { u: true, color: "blue", i: true },
    );
    expect(pair[0]).toEqual({ b: true, color: "red" });
    expect(pair[1]).toEqual({ u: true });
  });

  it("returns empty maps for empty inputs", function () {
    expect(TextOperation.transformAttributes({}, {})).toEqual([{}, {}]);
  });
});

describe("core transform: WrappedOperation", function () {
  it("transforms the wrapped operations and the meta", function () {
    var doc = "abc";
    var metaCalls = [];
    var meta = function (tag) {
      return {
        tag: tag,
        transform: function (op) {
          metaCalls.push([tag, op.toJSON()]);
          return meta(tag + "'");
        },
      };
    };
    var a = new WrappedOperation(new TextOperation().retain(3).insert("A"), meta("a"));
    var b = new WrappedOperation(new TextOperation().insert("B").retain(3), meta("b"));
    var pair = WrappedOperation.transform(a, b);
    expect(pair[1].apply(a.apply(doc))).toBe("BabcA");
    expect(pair[0].apply(b.apply(doc))).toBe("BabcA");
    expect(pair[0].meta.tag).toBe("a'");
    expect(pair[1].meta.tag).toBe("b'");
    expect(metaCalls).toEqual([
      ["a", ["B", 3]],
      ["b", [3, "A"]],
    ]);
  });

  it("random ops: TP1 holds through WrappedOperation", function () {
    var g = makeGen(0x7a4504);
    for (var n = 0; n < ITERATIONS; n++) {
      var doc = g.str(g.int(40));
      var a = new WrappedOperation(g.op(doc, false), null);
      var b = new WrappedOperation(g.op(doc, false), null);
      var pair = a.transform(b);
      expect(pair[1].apply(a.apply(doc))).toBe(pair[0].apply(b.apply(doc)));
    }
  });
});
