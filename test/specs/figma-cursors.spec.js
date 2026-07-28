import { describe, it, expect } from "bun:test";
import {
  FigmaCursorWidget,
  FigmaDecorationManager,
  CodeMirror5Adapter,
} from "../../src/editors/index.ts";
import { TextOperation } from "../../src/core/index.ts";

describe("Migrate CodeMirror 5 Adapter & Sub-Pixel Figma Cursors (Issue #4)", function () {
  it("Separates text change driver translation from collaborative UI decoration rendering in dedicated modules", function () {
    var replacedText = "";
    var mockCm = {
      on: function () {},
      off: function () {},
      getValue: function () {
        return "test content";
      },
      getCursor: function () {
        return { line: 0, ch: 4 };
      },
      indexFromPos: function () {
        return 4;
      },
      posFromIndex: function (idx) {
        return { line: 0, ch: idx };
      },
      cursorCoords: function () {
        return { top: 100, bottom: 122, left: 50 };
      },
      setBookmark: function () {
        return { clear: function () {} };
      },
      replaceRange: function (text, from, to, origin) {
        replacedText = text;
      },
    };

    var driver = new CodeMirror5Adapter(mockCm);
    expect(driver.decorations instanceof FigmaDecorationManager).toBe(true);

    // Verify applyOperation properly synchronizes incoming remote operations
    var remoteOp = new TextOperation().retain(4).insert("inserted ");
    driver.applyOperation(remoteOp);
    expect(replacedText).toBe("inserted ");

    // Verify setOtherCursor mounts collaborative UI decorations independently
    var cursorData = { position: 4, selectionEnd: 4 };
    var bookmark = driver.setOtherCursor({ cursor: cursorData, color: "#3b82f6", clientId: "Alice" });
    expect(bookmark).not.toBeUndefined();
    expect(driver.decorations.getActiveWidgetCount()).toBe(1);
    driver.dispose();
  });

  it("Aligns collaborative cursor widgets directly on text line baselines with 0.000px vertical discrepancy", function () {
    var widget = new FigmaCursorWidget("#ef4444", "Bob", 22);
    var el = widget.getElement();

    expect(el.className).toBe("other-client firepad-client-cursor");
    expect(el.style.verticalAlign).toBe("baseline");
    expect(el.style.transform).toBe("translateY(0.000px)");
    expect(parseFloat(el.style.marginBottom || "0")).toBe(0);
    expect(el.style.height).toBe("22px");
    expect(el.style.position).toBe("relative");
    expect(el.style.display).toBe("inline-block");
    expect(widget.getVerticalDiscrepancy()).toBe(0.0);

    widget.dispose();
  });

  it("Guarantees 100% event listener and hover timer disposal upon editor teardown (dispose)", function () {
    var manager = new FigmaDecorationManager();
    var mockCm = {
      posFromIndex: function (idx) {
        return { line: 0, ch: idx };
      },
      cursorCoords: function () {
        return { top: 10, bottom: 30, left: 15 };
      },
      setBookmark: function () {
        return {
          clear: function () {},
        };
      },
      markText: function () {
        return { clear: function () {} };
      },
    };

    manager.setOtherCursor(
      { cursor: { position: 5, selectionEnd: 5 }, color: "#ef4444", clientId: "Peer1" },
      mockCm,
      100,
    );
    manager.setOtherCursor(
      { cursor: { position: 10, selectionEnd: 10 }, color: "#3b82f6", clientId: "Peer2" },
      mockCm,
      100,
    );

    expect(manager.getActiveWidgetCount()).toBe(2);
    expect(manager.getActiveBookmarkCount()).toBe(2);

    var widget1 = manager.getWidget("Peer1");
    expect(widget1.isDisposed()).toBe(false);
    expect(widget1.getActiveTimerCount()).toBeGreaterThan(0); // Initial fade timer active

    // Trigger explicit teardown
    manager.dispose();

    expect(manager.isDisposed()).toBe(true);
    expect(manager.getActiveWidgetCount()).toBe(0);
    expect(manager.getActiveBookmarkCount()).toBe(0);
    expect(widget1.isDisposed()).toBe(true);
    expect(widget1.getActiveTimerCount()).toBe(0);
    expect(widget1.getActiveListenerCount()).toBe(0);
  });
});
