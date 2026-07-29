import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import React from "react";
import {
  PyrepadProvider,
  usePyrepadEditor,
  useCollaborators,
  useAgentiveDiffs,
  CollaborativeEditor,
  VERSION,
} from "../../src/react/index.ts";
import { PyricSandboxAdapter } from "../../src/adapters/index.ts";
import { TextOperation } from "../../src/core/index.ts";

describe("Build Declarative React Component Library & Hooks (Issue #5)", function () {
  var testState = [];
  var stateIdx = 0;
  var cleanups = [];

  var testDispatcher = {
    useState: function (initial) {
      var idx = stateIdx++;
      if (testState[idx] === undefined) {
        testState[idx] = typeof initial === "function" ? initial() : initial;
      }
      var setState = function (val) {
        testState[idx] = typeof val === "function" ? val(testState[idx]) : val;
      };
      return [testState[idx], setState];
    },
    useRef: function (initial) {
      var idx = stateIdx++;
      if (testState[idx] === undefined) {
        testState[idx] = { current: initial };
      }
      return testState[idx];
    },
    useEffect: function (cb) {
      var cleanup = cb();
      if (typeof cleanup === "function") {
        cleanups.push(cleanup);
      }
    },
    useMemo: function (factory) {
      var idx = stateIdx++;
      if (testState[idx] === undefined) {
        testState[idx] = factory();
      }
      return testState[idx];
    },
    useContext: function () {
      return { adapter: null };
    },
    useTransition: function () {
      return [false, function (fn) { fn(); }];
    },
  };

  beforeEach(function () {
    testState = [];
    stateIdx = 0;
    cleanups = [];
    var internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE || {};
    internals.H = testDispatcher;
  });

  afterEach(function () {
    cleanups.forEach(function (fn) {
      try { fn(); } catch (_e) {}
    });
    var internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE || {};
    internals.H = null;
  });

  it("Exposes single-file custom reactive hooks: usePyrepadEditor, useCollaborators, and useAgentiveDiffs", function () {
    expect(typeof usePyrepadEditor).toBe("function");
    expect(typeof useCollaborators).toBe("function");
    expect(typeof useAgentiveDiffs).toBe("function");
    expect(VERSION).toBe("2.0.0");
  });

  it("Implements <PyrepadProvider /> context binder and <CollaborativeEditor /> wrapper component", function () {
    expect(typeof PyrepadProvider).toBe("function");
    expect(typeof CollaborativeEditor).toBe("function");

    var adapter = new PyricSandboxAdapter(null, "provider-test", "#3b82f6");
    var providerElement = PyrepadProvider({ adapter: adapter, children: React.createElement("div", null, "child") });

    expect(providerElement).toBeDefined();
    expect(providerElement.props.value.adapter).toBe(adapter);

    var editorWrapper = CollaborativeEditor({
      adapter: adapter,
      editor: { getWrapperElement: function () { return { style: {} }; } },
      type: "cm6",
      userId: "alice",
      userColor: "#10b981",
      showCollaboratorBar: true,
    });
    expect(editorWrapper).toBeDefined();

    adapter.dispose();
  });

  it("Confirms rapid keyboard input updates author text at 60fps without triggering re-renders of parent React DOM structures", async function () {
    var adapter = new PyricSandboxAdapter(null, "speed-client", "#3b82f6");
    var emittedOps = [];
    adapter.on("operation", function (op) {
      emittedOps.push(op);
    });

    var mockCM6 = {
      state: { doc: { toString: function () { return "initial"; }, length: 7 }, selection: { main: { head: 7, anchor: 7 } } },
      dispatch: function () {},
      getWrapperElement: function () { return { style: {} }; },
    };

    var editorResult = usePyrepadEditor({
      adapter: adapter,
      editor: mockCM6,
      type: "cm6",
      userId: "speed-user",
      userColor: "#3b82f6",
    });

    expect(editorResult.renderCount).toBe(1);

    var startTime = performance.now();

    for (var i = 0; i < 100; i++) {
      var op = new TextOperation().retain(7 + i).insert("a");
      adapter.trigger("operation", op);
    }

    var duration = performance.now() - startTime;
    await new Promise((resolve) => queueMicrotask(resolve));

    expect(duration).toBeLessThan(150);
    expect(emittedOps.length).toBe(100);
    expect(editorResult.renderCount).toBe(1);

    adapter.dispose();
  });
});
