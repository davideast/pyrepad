import { describe, it, expect } from "bun:test";
import {
  mapPos,
  mapRange,
  changeSpansAfter,
} from "../../src/suggestions/range-map.ts";

const ins = (at, text) => ({ from: at, to: at, insert: text });
const del = (from, to) => ({ from, to, insert: "" });
const rep = (from, to, text) => ({ from, to, insert: text });

describe("mapPos", function () {
  it("shifts positions after an insertion and leaves earlier ones", function () {
    expect(mapPos(10, [ins(4, "abc")], 1)).toBe(13);
    expect(mapPos(3, [ins(4, "abc")], 1)).toBe(3);
  });

  it("uses assoc to place a position sitting exactly at an insertion", function () {
    expect(mapPos(4, [ins(4, "abc")], 1)).toBe(7);
    expect(mapPos(4, [ins(4, "abc")], -1)).toBe(4);
  });

  it("collapses positions inside a deleted span", function () {
    expect(mapPos(6, [del(4, 9)], -1)).toBe(4);
    expect(mapPos(6, [del(4, 9)], 1)).toBe(4);
    expect(mapPos(6, [rep(4, 9, "xy")], -1)).toBe(4);
    expect(mapPos(6, [rep(4, 9, "xy")], 1)).toBe(6);
  });

  it("applies simultaneous changes in old coordinates", function () {
    const changes = [ins(2, "ab"), del(5, 7), ins(9, "z")];
    expect(mapPos(3, changes, 1)).toBe(5);
    expect(mapPos(8, changes, 1)).toBe(8);
    expect(mapPos(10, changes, 1)).toBe(11);
  });
});

describe("mapRange", function () {
  it("shifts a range untouched by earlier and later edits", function () {
    expect(mapRange(10, 15, [ins(2, "abcd")])).toEqual({
      from: 14,
      to: 19,
      touched: false,
    });
    expect(mapRange(10, 15, [ins(20, "zz")])).toEqual({
      from: 10,
      to: 15,
      touched: false,
    });
  });

  it("keeps the range on its text when typing happens at either boundary", function () {
    expect(mapRange(10, 15, [ins(10, "ab")])).toEqual({
      from: 12,
      to: 17,
      touched: false,
    });
    expect(mapRange(10, 15, [ins(15, "ab")])).toEqual({
      from: 10,
      to: 15,
      touched: false,
    });
  });

  it("flags edits inside the range", function () {
    expect(mapRange(10, 15, [ins(12, "x")]).touched).toBe(true);
    expect(mapRange(10, 15, [del(11, 13)]).touched).toBe(true);
    expect(mapRange(10, 15, [rep(8, 11, "q")]).touched).toBe(true);
    expect(mapRange(10, 15, [del(0, 30)]).touched).toBe(true);
  });

  it("does not flag deletions that merely abut the range", function () {
    expect(mapRange(10, 15, [del(5, 10)])).toEqual({
      from: 5,
      to: 10,
      touched: false,
    });
    expect(mapRange(10, 15, [del(15, 20)])).toEqual({
      from: 10,
      to: 15,
      touched: false,
    });
  });
});

describe("changeSpansAfter", function () {
  it("returns each insertion's span in new-document coordinates", function () {
    const spans = changeSpansAfter([
      ins(2, "ab"),
      rep(5, 7, "xyz"),
      del(9, 10),
    ]);
    expect(spans).toEqual([
      { from: 2, to: 4 },
      { from: 7, to: 10 },
    ]);
  });
});
