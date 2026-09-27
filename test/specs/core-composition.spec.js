import { describe, it, expect } from "bun:test";
import { TextOperation } from "../../src/core/index.ts";

// Direct specs of src/core composition math (TextOperation#compose,
// #shouldBeComposedWith, #shouldBeComposedWithInverted).

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
  const attrsArray = function (n) {
    const arr = [];
    for (let k = 0; k < n; k++) arr.push(attrs(false));
    return arr;
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
  return { rand: rand, int: int, str: str, op: op, attrsArray: attrsArray };
}

const ITERATIONS = 300;

describe("core compose: law apply(compose(a,b), s) === apply(b, apply(a, s))", function () {
  it("deterministic: insert then delete inside the insert", function () {
    const doc = "abc";
    const a = new TextOperation().retain(1).insert("XYZ").retain(2);
    const b = new TextOperation().retain(2).delete(1).retain(3);
    const ab = a.compose(b);
    expect(b.apply(a.apply(doc))).toBe("aXZbc");
    expect(ab.apply(doc)).toBe("aXZbc");
    expect(ab.toJSON()).toEqual([1, "XZ", 2]);
  });

  it("deterministic: delete then insert at the same spot", function () {
    const doc = "hello";
    const a = new TextOperation().delete(1).retain(4);
    const b = new TextOperation().insert("J").retain(4);
    expect(a.compose(b).apply(doc)).toBe("Jello");
  });

  it("result has baseLength of a and targetLength of b", function () {
    const a = new TextOperation().retain(3).insert("xx");
    const b = new TextOperation().delete(4).retain(1);
    const ab = a.compose(b);
    expect(ab.baseLength).toBe(a.baseLength);
    expect(ab.targetLength).toBe(b.targetLength);
  });

  it("throws when a.targetLength !== b.baseLength", function () {
    const a = new TextOperation().retain(3);
    const b = new TextOperation().retain(4);
    expect(function () {
      a.compose(b);
    }).toThrow();
  });

  it("does not mutate its inputs", function () {
    const a = new TextOperation().retain(2).insert("abc").delete(1);
    const b = new TextOperation().retain(1).delete(3).retain(1);
    const aJson = a.toJSON();
    const bJson = b.toJSON();
    a.compose(b);
    expect(a.toJSON()).toEqual(aJson);
    expect(b.toJSON()).toEqual(bJson);
  });

  it("random ops (plain text)", function () {
    const g = makeGen(0xc0de01);
    for (let n = 0; n < ITERATIONS; n++) {
      const doc = g.str(g.int(40));
      const a = g.op(doc, false);
      const afterA = a.apply(doc);
      const b = g.op(afterA, false);
      const ab = a.compose(b);
      expect(ab.baseLength).toBe(a.baseLength);
      expect(ab.targetLength).toBe(b.targetLength);
      expect(ab.apply(doc)).toBe(b.apply(afterA));
    }
  });

  it("random ops (with attributes): text and resulting attributes agree", function () {
    const g = makeGen(0xc0de02);
    for (let n = 0; n < ITERATIONS; n++) {
      const doc = g.str(g.int(40));
      const docAttrs = g.attrsArray(doc.length);
      const a = g.op(doc, true);
      const afterAAttrs = [];
      const afterA = a.apply(doc, docAttrs, afterAAttrs);
      const b = g.op(afterA, true);
      const sequentialAttrs = [];
      const sequential = b.apply(afterA, afterAAttrs, sequentialAttrs);
      const composedAttrs = [];
      const composed = a.compose(b).apply(doc, docAttrs, composedAttrs);
      expect(composed).toBe(sequential);
      expect(composedAttrs).toEqual(sequentialAttrs);
    }
  });

  it("random ops: compose is associative on the resulting text", function () {
    const g = makeGen(0xc0de03);
    for (let n = 0; n < ITERATIONS; n++) {
      const doc = g.str(g.int(40));
      const a = g.op(doc, false);
      const s1 = a.apply(doc);
      const b = g.op(s1, false);
      const s2 = b.apply(s1);
      const c = g.op(s2, false);
      const left = a.compose(b).compose(c);
      const right = a.compose(b.compose(c));
      expect(left.apply(doc)).toBe(right.apply(doc));
      expect(left.toJSON()).toEqual(right.toJSON());
    }
  });

  it("random ops: invert then compose yields an identity on the text", function () {
    const g = makeGen(0xc0de04);
    for (let n = 0; n < ITERATIONS; n++) {
      const doc = g.str(g.int(40));
      const a = g.op(doc, false);
      const roundTrip = a.compose(a.invert(doc));
      expect(roundTrip.baseLength).toBe(doc.length);
      expect(roundTrip.targetLength).toBe(doc.length);
      expect(roundTrip.apply(doc)).toBe(doc);
    }
  });
});

describe("core compose: shouldBeComposedWith", function () {
  function ins(pos, text, docLen) {
    return new TextOperation().retain(pos).insert(text).retain(docLen - pos);
  }
  function del(pos, n, docLen) {
    return new TextOperation().retain(pos).delete(n).retain(docLen - pos - n);
  }

  it("noops always compose", function () {
    const noop = new TextOperation().retain(5);
    expect(noop.shouldBeComposedWith(ins(1, "a", 5))).toBe(true);
    expect(ins(1, "a", 5).shouldBeComposedWith(new TextOperation().retain(6))).toBe(true);
  });

  it("consecutive inserts compose when B starts where A ended (typing forward)", function () {
    const a = ins(2, "ab", 5); // doc len 5 -> 7, A ends at index 4
    expect(a.shouldBeComposedWith(ins(4, "c", 7))).toBe(true);
    expect(a.shouldBeComposedWith(ins(3, "c", 7))).toBe(false);
    expect(a.shouldBeComposedWith(ins(2, "c", 7))).toBe(false);
    expect(a.shouldBeComposedWith(ins(5, "c", 7))).toBe(false);
  });

  it("consecutive deletes compose for backspace (B ends where A starts) and forward-delete (same start)", function () {
    const a = del(4, 1, 10); // doc 10 -> 9
    expect(a.shouldBeComposedWith(del(3, 1, 9))).toBe(true); // backspace
    expect(a.shouldBeComposedWith(del(4, 1, 9))).toBe(true); // forward delete
    expect(a.shouldBeComposedWith(del(2, 1, 9))).toBe(false);
    expect(a.shouldBeComposedWith(del(5, 1, 9))).toBe(false);
  });

  it("insert followed by delete (or vice versa) does not compose", function () {
    expect(ins(2, "a", 5).shouldBeComposedWith(del(2, 1, 6))).toBe(false);
    expect(del(2, 1, 5).shouldBeComposedWith(ins(2, "a", 4))).toBe(false);
  });

  it("ops that are not a single simple edit do not compose", function () {
    const multi = new TextOperation().retain(1).insert("a").retain(1).insert("b").retain(1);
    expect(multi.shouldBeComposedWith(ins(4, "c", 5))).toBe(false);
    expect(ins(0, "c", 3).shouldBeComposedWith(multi)).toBe(false);
  });

  it("handles inserts/deletes at document start (no leading retain)", function () {
    const a = new TextOperation().insert("ab").retain(3);
    expect(a.shouldBeComposedWith(ins(2, "c", 5))).toBe(true);
    const d = new TextOperation().retain(1).delete(1).retain(3);
    expect(d.shouldBeComposedWith(new TextOperation().delete(1).retain(3))).toBe(true);
  });
});

describe("core compose: shouldBeComposedWithInverted", function () {
  function ins(pos, text, docLen) {
    return new TextOperation().retain(pos).insert(text).retain(docLen - pos);
  }
  function del(pos, n, docLen) {
    return new TextOperation().retain(pos).delete(n).retain(docLen - pos - n);
  }

  it("noops always compose", function () {
    expect(new TextOperation().retain(3).shouldBeComposedWithInverted(del(0, 1, 3))).toBe(true);
  });

  it("inserts compose when B continues A or starts at the same position", function () {
    const a = ins(2, "ab", 5);
    expect(a.shouldBeComposedWithInverted(ins(4, "c", 7))).toBe(true);
    expect(a.shouldBeComposedWithInverted(ins(2, "c", 7))).toBe(true);
    expect(a.shouldBeComposedWithInverted(ins(3, "c", 7))).toBe(false);
  });

  it("deletes compose only when B ends where A starts", function () {
    const a = del(4, 1, 10);
    expect(a.shouldBeComposedWithInverted(del(3, 1, 9))).toBe(true);
    expect(a.shouldBeComposedWithInverted(del(4, 1, 9))).toBe(false);
  });

  it("deterministic: typing forward, inverted, composes (inv(b) with inv(a))", function () {
    // Typing "a" then "b" at position 2. editor-client asks
    // `inverse.shouldBeComposedWithInverted(topOfUndoStack)`, i.e.
    // inv(b).shouldBeComposedWithInverted(inv(a)).
    const doc0 = "hello";
    const t1 = ins(2, "a", 5);
    const doc1 = t1.apply(doc0);
    const t2 = ins(3, "b", 6);
    expect(t1.shouldBeComposedWith(t2)).toBe(true);
    expect(t2.invert(doc1).shouldBeComposedWithInverted(t1.invert(doc0))).toBe(true);
  });

  it("random simple edits: shouldBeComposedWith(a, b) === shouldBeComposedWithInverted(inv(b), inv(a))", function () {
    const g = makeGen(0xc0de05);
    function simpleEdit(doc) {
      const len = doc.length;
      if (len === 0 || g.rand() < 0.5) {
        const p = g.int(len + 1);
        return ins(p, g.str(1 + g.int(3)), len);
      }
      const start = g.int(len);
      return del(start, 1 + g.int(Math.min(3, len - start)), len);
    }
    let composable = 0;
    for (let n = 0; n < ITERATIONS * 3; n++) {
      const doc0 = g.str(2 + g.int(12));
      const a = simpleEdit(doc0);
      const doc1 = a.apply(doc0);
      const b = simpleEdit(doc1);
      const forward = a.shouldBeComposedWith(b);
      if (forward) composable++;
      const inverted = b.invert(doc1).shouldBeComposedWithInverted(a.invert(doc0));
      expect({ a: a.toJSON(), b: b.toJSON(), inverted: inverted }).toEqual({
        a: a.toJSON(),
        b: b.toJSON(),
        inverted: forward,
      });
    }
    // Short docs make adjacent edits common, so both outcomes are exercised.
    expect(composable).toBeGreaterThan(20);
  });
});
