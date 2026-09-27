import { describe, it, expect } from "bun:test";
import { TextOperation, WrappedOperation, UndoManager } from "../../src/core/index.ts";

// Direct specs of src/core/history/undo-manager.ts driven by src/core
// TextOperations, including transform-on-remote-op.

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
  var op = function (doc) {
    var o = new TextOperation();
    while (true) {
      var left = doc.length - o.baseLength;
      if (left === 0) break;
      var r = rand();
      var l = 1 + int(Math.min(left - 1, 20));
      if (r < 0.2) o.insert(str(l));
      else if (r < 0.4) o.delete(l);
      else o.retain(l);
    }
    if (rand() < 0.3) o.insert("z" + str(10));
    return o;
  };
  return { rand: rand, int: int, str: str, op: op };
}

// Minimal editor mirroring lib/editor-client.js: the undo stack holds
// inverses, composed when the new edit continues the previous one.
function Editor(doc, maxItems) {
  this.doc = doc;
  this.undoManager = new UndoManager(maxItems);
}
Editor.prototype.localEdit = function (operation, forbidCompose) {
  var stack = this.undoManager.undoStack;
  var inverse = operation.invert(this.doc);
  var compose =
    !forbidCompose &&
    stack.length > 0 &&
    inverse.shouldBeComposedWithInverted(stack[stack.length - 1]);
  this.undoManager.add(inverse, compose);
  this.doc = operation.apply(this.doc);
};
Editor.prototype.remoteEdit = function (operation) {
  this.doc = operation.apply(this.doc);
  this.undoManager.transform(operation);
};
Editor.prototype.undo = function () {
  var self = this;
  this.undoManager.performUndo(function (op) {
    self.localEdit(op);
  });
};
Editor.prototype.redo = function () {
  var self = this;
  this.undoManager.performRedo(function (op) {
    self.localEdit(op);
  });
};

function ins(pos, text, docLen) {
  return new TextOperation().retain(pos).insert(text).retain(docLen - pos);
}
function del(pos, n, docLen) {
  return new TextOperation().retain(pos).delete(n).retain(docLen - pos - n);
}

var ITERATIONS = 150;

describe("core UndoManager: stack behaviour", function () {
  it("rejects a non-positive capacity", function () {
    expect(function () {
      new UndoManager(0);
    }).toThrow();
    expect(function () {
      new UndoManager(-1);
    }).toThrow();
  });

  it("undo then redo restores each state", function () {
    var e = new Editor("Looremipsum");
    var um = e.undoManager;
    expect(um.canUndo()).toBe(false);
    expect(um.canRedo()).toBe(false);
    e.localEdit(del(2, 1, 11));
    expect(e.doc).toBe("Loremipsum");
    e.localEdit(ins(5, " ", 10), true);
    expect(e.doc).toBe("Lorem ipsum");
    expect(um.undoStack.length).toBe(2);

    e.undo();
    expect(e.doc).toBe("Loremipsum");
    expect([um.undoStack.length, um.redoStack.length]).toEqual([1, 1]);
    e.undo();
    expect(e.doc).toBe("Looremipsum");
    expect([um.canUndo(), um.canRedo()]).toEqual([false, true]);
    e.redo();
    expect(e.doc).toBe("Loremipsum");
    e.redo();
    expect(e.doc).toBe("Lorem ipsum");
    expect([um.canUndo(), um.canRedo()]).toEqual([true, false]);
  });

  it("composes consecutive typing into one undo step", function () {
    var e = new Editor("ab");
    e.localEdit(ins(1, "x", 2));
    e.localEdit(ins(2, "y", 3));
    e.localEdit(ins(3, "z", 4));
    expect(e.doc).toBe("axyzb");
    expect(e.undoManager.undoStack.length).toBe(1);
    e.undo();
    expect(e.doc).toBe("ab");
  });

  it("composes consecutive backspaces into one undo step", function () {
    var e = new Editor("abcdef");
    e.localEdit(del(4, 1, 6));
    e.localEdit(del(3, 1, 5));
    e.localEdit(del(2, 1, 4));
    expect(e.doc).toBe("abf");
    expect(e.undoManager.undoStack.length).toBe(1);
    e.undo();
    expect(e.doc).toBe("abcdef");
  });

  it("does not compose non-adjacent edits", function () {
    var e = new Editor("abcdef");
    e.localEdit(ins(1, "x", 6));
    e.localEdit(ins(5, "y", 7));
    expect(e.undoManager.undoStack.length).toBe(2);
  });

  it("a new local edit clears the redo stack", function () {
    var e = new Editor("abc");
    e.localEdit(ins(0, "x", 3));
    e.undo();
    expect(e.undoManager.canRedo()).toBe(true);
    e.localEdit(ins(3, "y", 3));
    expect(e.undoManager.canRedo()).toBe(false);
  });

  it("does not compose the edit following an undo/redo onto the undo/redo op", function () {
    var um = new UndoManager();
    var a = new TextOperation().retain(1).delete(1);
    var b = new TextOperation().retain(1).insert("x");
    um.add(a);
    um.performUndo(function (op) {
      um.add(op);
    });
    expect(um.dontCompose).toBe(true);
    um.add(b, true);
    // redo stack is cleared and b was pushed rather than composed
    expect(um.redoStack.length).toBe(0);
    expect(um.undoStack.length).toBe(1);
    expect(um.undoStack[0]).toBe(b);
    expect(um.dontCompose).toBe(false);
  });

  it("drops the oldest entry beyond maxItems", function () {
    var um = new UndoManager(3);
    var ops = [];
    for (var k = 0; k < 5; k++) {
      var o = new TextOperation().insert(String(k));
      ops.push(o);
      um.add(o);
    }
    expect(um.undoStack).toEqual([ops[2], ops[3], ops[4]]);
  });

  it("performUndo/performRedo throw on an empty stack", function () {
    var um = new UndoManager();
    expect(function () {
      um.performUndo(function () {});
    }).toThrow("undo not possible");
    expect(function () {
      um.performRedo(function () {});
    }).toThrow("redo not possible");
  });

  it("reports undoing/redoing state only inside the callback, and resets on throw", function () {
    var um = new UndoManager();
    um.add(new TextOperation().insert("a"));
    var seen = null;
    um.performUndo(function (op) {
      seen = [um.isUndoing(), um.isRedoing()];
      um.add(op);
    });
    expect(seen).toEqual([true, false]);
    expect(um.isUndoing()).toBe(false);
    um.performRedo(function (op) {
      seen = [um.isUndoing(), um.isRedoing()];
      um.add(op);
    });
    expect(seen).toEqual([false, true]);
    expect(um.isRedoing()).toBe(false);

    expect(function () {
      um.performUndo(function () {
        throw new Error("boom");
      });
    }).toThrow("boom");
    expect(um.state).toBe("normal");
  });
});

describe("core UndoManager: transform on remote op", function () {
  it("deterministic: undo after a concurrent remote edit", function () {
    var e = new Editor("Looremipsum");
    e.localEdit(del(2, 1, 11));
    e.localEdit(ins(5, " ", 10), true);
    expect(e.doc).toBe("Lorem ipsum");
    e.remoteEdit(new TextOperation().retain(6).delete(1).insert("I").retain(4));
    expect(e.doc).toBe("Lorem Ipsum");
    e.undo();
    expect(e.doc).toBe("LoremIpsum");
    e.undo();
    expect(e.doc).toBe("LooremIpsum");
    e.redo();
    e.redo();
    expect(e.doc).toBe("Lorem Ipsum");
  });

  it("drops undo entries that the remote op turns into noops", function () {
    var e = new Editor("abc");
    e.localEdit(ins(1, "X", 3));
    expect(e.doc).toBe("aXbc");
    // Remote deletes the text that the undo entry would delete.
    e.remoteEdit(del(1, 1, 4));
    expect(e.doc).toBe("abc");
    expect(e.undoManager.canUndo()).toBe(false);
  });

  it("transforms WrappedOperation entries too", function () {
    var um = new UndoManager();
    var doc = "abc";
    var local = new TextOperation().retain(3).insert("!");
    um.add(new WrappedOperation(local.invert(doc), null));
    doc = local.apply(doc); // "abc!"
    var remote = new WrappedOperation(new TextOperation().insert(">").retain(4), null);
    doc = remote.apply(doc); // ">abc!"
    um.transform(remote);
    um.performUndo(function (op) {
      doc = op.apply(doc);
    });
    expect(doc).toBe(">abc");
  });

  it("random: with local edits only, undoing everything restores the original", function () {
    var g = makeGen(0x0dd001);
    for (var n = 0; n < ITERATIONS; n++) {
      var original = g.str(g.int(30));
      var e = new Editor(original, 1000);
      var steps = 1 + g.int(8);
      for (var k = 0; k < steps; k++) e.localEdit(g.op(e.doc), g.rand() < 0.5);
      while (e.undoManager.canUndo()) e.undo();
      expect(e.doc).toBe(original);
    }
  });

  it("random: interleaved local/remote edits — every undo applies, and redo-all restores the pre-undo doc", function () {
    var g = makeGen(0x0dd002);
    for (var n = 0; n < ITERATIONS; n++) {
      var e = new Editor(g.str(g.int(30)), 1000);
      var steps = 1 + g.int(10);
      for (var k = 0; k < steps; k++) {
        if (g.rand() < 0.4) e.remoteEdit(g.op(e.doc));
        else e.localEdit(g.op(e.doc), g.rand() < 0.5);
      }
      var beforeUndo = e.doc;
      var undone = 0;
      while (e.undoManager.canUndo()) {
        var top = e.undoManager.undoStack[e.undoManager.undoStack.length - 1];
        expect(top.baseLength).toBe(e.doc.length);
        e.undo();
        undone++;
      }
      expect(e.undoManager.redoStack.length).toBe(undone);
      while (e.undoManager.canRedo()) e.redo();
      expect(e.doc).toBe(beforeUndo);
    }
  });

  it("random: remote edit between undo and redo — redo still applies after transform", function () {
    var g = makeGen(0x0dd003);
    for (var n = 0; n < ITERATIONS; n++) {
      var e = new Editor(g.str(1 + g.int(30)), 1000);
      var steps = 1 + g.int(6);
      for (var k = 0; k < steps; k++) e.localEdit(g.op(e.doc), true);
      e.undo();
      e.remoteEdit(g.op(e.doc));
      var um = e.undoManager;
      while (um.canRedo()) {
        expect(um.redoStack[um.redoStack.length - 1].baseLength).toBe(e.doc.length);
        e.redo();
      }
      while (um.canUndo()) {
        expect(um.undoStack[um.undoStack.length - 1].baseLength).toBe(e.doc.length);
        e.undo();
      }
    }
  });
});
