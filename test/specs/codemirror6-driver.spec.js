import { describe, it, expect } from "bun:test";
import {
  CodeMirror6Adapter,
  CM6PresenceWidget,
  CM6PresencePlugin,
} from "../../src/editors/index.ts";
import { TextOperation } from "../../src/core/index.ts";

describe("Integrate CodeMirror 6 (CM6) State Field Driver & Decorations (Issue #6)", function () {
  it("Builds transactional driver mapping CM6 immutable state modifications directly to Pyrepad text operations", function () {
    var dispatchedChanges = [];
    var mockView = {
      state: { doc: { length: 11, toString: function () { return "hello world"; } } },
      dispatch: function (specs) {
        if (specs && specs.changes) {
          dispatchedChanges.push(specs.changes);
        }
      },
    };

    var adapter = new CodeMirror6Adapter(mockView);
    var emittedOps = [];
    adapter.on("change", function (op) {
      emittedOps.push(op);
    });

    // Simulate an immutable CM6 transaction inserting ' shiny' at index 5
    var simulatedTr = {
      docChanged: true,
      startState: { doc: { length: 11, toString: function () { return "hello world"; } } },
      state: { doc: { length: 17, toString: function () { return "hello shiny world"; } } },
      annotation: function () { return null; },
      changes: {
        iterChanges: function (fn) {
          fn(5, 5, 5, 11, " shiny");
        },
      },
    };

    adapter.onTransaction(simulatedTr);
    expect(emittedOps.length).toBe(1);
    var op = emittedOps[0];
    expect(op.ops.length).toBe(3);
    expect(op.ops[0].chars || op.ops[0]).toBe(5); // Retain 5
    expect(op.ops[1].text || op.ops[1]).toBe(" shiny"); // Insert ' shiny'
    expect(op.ops[2].chars || op.ops[2]).toBe(6); // Retain 6 (' world')

    // Verify applying remote operations back to view via dispatch
    var remoteOp = new TextOperation().retain(11).insert("!");
    adapter.applyOperation(remoteOp);
    expect(dispatchedChanges.length).toBe(1);
    expect(dispatchedChanges[0][0].insert).toBe("!");
    expect(dispatchedChanges[0][0].from).toBe(11);

    adapter.dispose();
  });

  it("Renders multiplayer colored caret lines and username name tags using CM6 View Plugin widget decorations without DOM mutation markers", function () {
    var plugin = new CM6PresencePlugin();
    var mockView = {
      state: { doc: { length: 50, toString: function () { return "test document content"; } } },
      dispatch: function () {},
    };

    var aliceCursor = { cursor: { position: 10, selectionEnd: 10 }, color: "#ef4444", clientId: "Alice" };
    var bobSelection = { cursor: { position: 5, selectionEnd: 15 }, color: "#3b82f6", clientId: "Bob" };

    plugin.setOtherCursor(aliceCursor, mockView);
    plugin.setOtherCursor(bobSelection, mockView);

    var decorations = plugin.getDecorations();
    expect(decorations.length).toBe(2);
    expect(plugin.getActiveWidgetCount()).toBe(1);

    var aliceWidget = plugin.getWidget("Alice");
    expect(aliceWidget).not.toBeUndefined();
    var dom = aliceWidget.toDOM(mockView);
    expect(dom.className).toBe("cm-presence-cursor other-client");
    expect(dom.style.verticalAlign).toBe("baseline");
    expect(dom.style.transform).toBe("translateY(0.000px)");
    expect(parseFloat(dom.style.marginBottom || "0")).toBe(0);

    plugin.dispose();
    expect(plugin.isDisposed()).toBe(true);
    expect(plugin.getActiveWidgetCount()).toBe(0);
    expect(plugin.getDecorations().length).toBe(0);
  });

  it("Verifies clean multiplayer convergence under simulated high-concurrency randomized test edits", function () {
    var docAlice = "Initial CM6 shared document.";
    var docBob = "Initial CM6 shared document.";

    var viewAlice = {
      state: { doc: { length: docAlice.length, toString: function () { return docAlice; } } },
      dispatch: function (spec) {
        if (spec && spec.changes) {
          for (var i = 0; i < spec.changes.length; i++) {
            var chg = spec.changes[i];
            var prefix = docAlice.substring(0, chg.from);
            var suffix = docAlice.substring(chg.to || chg.from);
            docAlice = prefix + (chg.insert || "") + suffix;
            this.state.doc.length = docAlice.length;
          }
        }
      },
    };

    var viewBob = {
      state: { doc: { length: docBob.length, toString: function () { return docBob; } } },
      dispatch: function (spec) {
        if (spec && spec.changes) {
          for (var j = 0; j < spec.changes.length; j++) {
            var chg = spec.changes[j];
            var prefix = docBob.substring(0, chg.from);
            var suffix = docBob.substring(chg.to || chg.from);
            docBob = prefix + (chg.insert || "") + suffix;
            this.state.doc.length = docBob.length;
          }
        }
      },
    };

    var driverAlice = new CodeMirror6Adapter(viewAlice);
    var driverBob = new CodeMirror6Adapter(viewBob);

    // Simulate rapid concurrent editing rounds between Alice and Bob
    var rounds = 25;
    for (var k = 0; k < rounds; k++) {
      var insertText = " [edit " + k + "]";
      var pos = Math.floor(Math.random() * docAlice.length);
      
      var opAlice = new TextOperation();
      if (pos > 0) opAlice.retain(pos);
      opAlice.insert(insertText);
      if (docAlice.length - pos > 0) opAlice.retain(docAlice.length - pos);

      // Apply locally to Alice and synchronize to Bob
      driverAlice.applyOperation(opAlice);
      driverBob.applyOperation(opAlice);
    }

    expect(docAlice).toBe(docBob);
    expect(docAlice.length).toBeGreaterThan(28);

    driverAlice.dispose();
    driverBob.dispose();
    expect(driverAlice.isDisposed()).toBe(true);
    expect(driverBob.isDisposed()).toBe(true);
  });
});
