/**
 * Interactive declarative React multiplayer demo application.
 * Highlights 60fps burst typing without Virtual DOM render lag and live teammate presence over PyricSandbox.
 */
import React, { useEffect, useRef, useState, useTransition } from "react";
import { createRoot } from "react-dom/client";
import {
  PyrepadProvider,
  CollaborativeEditor,
  VERSION,
} from "../src/react/index.ts";

const firepadGlobal = (window as any).firepad || (window as any).Firepad || {};
const PyricSandbox = firepadGlobal.PyricSandbox || { createDatabase: () => ({ ref: () => null }) };
const SyncSeam = firepadGlobal.SyncSeam || { PyricSandboxAdapter: class {} };

const db = PyricSandbox.createDatabase();
const sharedPadRef = db.ref("/react-multiplayer-studio");

const adapterA = new SyncSeam.PyricSandboxAdapter(sharedPadRef, "React-Dev-A", "#3b82f6");
const adapterB = new SyncSeam.PyricSandboxAdapter(sharedPadRef, "Teammate-B", "#10b981");

const sampleText = `// Welcome to the @pyric/pad/react declarative developer studio!
// Notice how rapid typing directly updates the editor mount point
// without EVER invoking React setState or incrementing the parent render count!

function calculateLeverage(depth: number): string {
  const isDeepSeam = depth > 5;
  if (isDeepSeam) {
    return "Deep Seam (High Leverage & Locality)";
  }
  return "Shallow Module";
}

// Try collaborating with Teammate-B or triggering AI Co-Pilot diffs!
`;

function EditorPane({
  title,
  adapter,
  userColor,
  userId,
  initialDoc,
  onCMCreated,
}: {
  title: string;
  adapter: any;
  userColor: string;
  userId: string;
  initialDoc?: string;
  onCMCreated?: (cm: any) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [cmInstance, setCmInstance] = useState<any>(null);

  useEffect(() => {
    const hasContainer = Boolean(containerRef.current && !cmInstance && typeof (window as any).CodeMirror === "function");
    if (hasContainer) {
      const cm = (window as any).CodeMirror(containerRef.current!, {
        lineNumbers: true,
        mode: "javascript",
        theme: "dracula",
        value: "",
      });

      setCmInstance(cm);
      const hasCallback = typeof onCMCreated === "function";
      if (hasCallback) onCMCreated!(cm);
    }
  }, [containerRef, cmInstance, onCMCreated]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <CollaborativeEditor
        adapter={adapter}
        editor={cmInstance}
        dbRef={sharedPadRef}
        defaultText={initialDoc}
        type="cm5"
        userId={userId}
        userColor={userColor}
        showCollaboratorBar={true}
        style={{ minHeight: "460px", flex: 1 }}
      >
        <div ref={containerRef} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
      </CollaborativeEditor>
    </div>
  );
}

function App() {
  const [cmA, setCmA] = useState<any>(null);
  const [parentRenderCount, setParentRenderCount] = useState(1);
  const [_, startTransition] = useTransition();

  const handleBurstTyping = () => {
    const isReady = Boolean(cmA && typeof cmA.getCursor === "function");
    if (!isReady) return;

    let count = 0;
    const interval = setInterval(() => {
      if (count >= 50) {
        clearInterval(interval);
        return;
      }
      count++;
      const cursor = cmA.getCursor();
      cmA.replaceRange("⚡", cursor, cursor, "user-burst");
    }, 16);
  };

  const handleSpawnAgent = () => {
    const hasTriggerA = Boolean(adapterA && typeof (adapterA as any).trigger === "function");
    if (hasTriggerA) {
      (adapterA as any).trigger("agentive", "Jules-AI", "Refactoring AST for deep seam boundaries", { diff: "+ const leverage = true;" }, "Enhancing modular depth");
    }
    const hasTriggerB = Boolean(adapterB && typeof (adapterB as any).trigger === "function");
    if (hasTriggerB) {
      (adapterB as any).trigger("agentive", "Jules-AI", "Refactoring AST for deep seam boundaries", { diff: "+ const leverage = true;" }, "Enhancing modular depth");
    }
  };

  const handleForceParentRender = () => {
    startTransition(() => {
      setParentRenderCount((prev) => prev + 1);
    });
  };

  return (
    <PyrepadProvider adapter={adapterA}>
      <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "1.25rem 2.5rem",
            background: "rgba(15, 23, 42, 0.85)",
            backdropFilter: "blur(12px)",
            borderBottom: "1px solid rgba(59, 130, 246, 0.3)",
            boxShadow: "0 4px 20px rgba(0, 0, 0, 0.4)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <span
              style={{
                background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
                color: "#ffffff",
                padding: "0.4rem 0.8rem",
                borderRadius: "8px",
                fontWeight: 700,
                fontSize: "0.85rem",
                boxShadow: "0 0 15px rgba(59, 130, 246, 0.4)",
              }}
            >
              @PYRIC/PAD/REACT
            </span>
            <span style={{ fontSize: "1.3rem", fontWeight: 600, color: "#f8fafc" }}>
              Declarative 60fps Multiplayer Studio (v{VERSION})
            </span>
          </div>

          <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
            <div
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "9999px",
                background: "rgba(16, 185, 129, 0.15)",
                color: "#10b981",
                border: "1px solid rgba(16, 185, 129, 0.4)",
                fontWeight: 600,
                fontSize: "0.85rem",
              }}
            >
              🟢 Parent Render Count: {parentRenderCount}
            </div>

            <button
              onClick={handleBurstTyping}
              style={{
                background: "#3b82f6",
                color: "#ffffff",
                border: "none",
                padding: "0.6rem 1.2rem",
                borderRadius: "8px",
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: "0 4px 12px rgba(59, 130, 246, 0.3)",
              }}
            >
              ⚡ Trigger 60fps Burst Typing
            </button>

            <button
              onClick={handleSpawnAgent}
              style={{
                background: "linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)",
                color: "#ffffff",
                border: "none",
                padding: "0.6rem 1.2rem",
                borderRadius: "8px",
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: "0 4px 12px rgba(139, 92, 246, 0.4)",
              }}
            >
              🤖 Spawn AI Co-Pilot
            </button>

            <button
              onClick={handleForceParentRender}
              style={{
                background: "transparent",
                color: "#60a5fa",
                border: "1px solid rgba(59, 130, 246, 0.4)",
                padding: "0.6rem 1.2rem",
                borderRadius: "8px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              🔄 Test Parent Re-render
            </button>
          </div>
        </header>

        <main
          style={{
            flex: 1,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "2rem",
            padding: "2.5rem",
          }}
        >
          <EditorPane
            title="Editor A"
            adapter={adapterA}
            userId="React-Dev-A"
            userColor="#3b82f6"
            initialDoc={sampleText}
            onCMCreated={(cm) => setCmA(cm)}
          />
          <EditorPane
            title="Editor B"
            adapter={adapterB}
            userId="Teammate-B"
            userColor="#10b981"
          />
        </main>

        <footer
          style={{
            padding: "1rem 2.5rem",
            background: "rgba(3, 7, 18, 0.9)",
            borderTop: "1px solid rgba(255, 255, 255, 0.08)",
            display: "flex",
            justifyContent: "space-between",
            fontSize: "0.85rem",
            color: "#94a3b8",
          }}
        >
          <div>⚡ Powered by @pyric/pad/react Hooks & SyncSeam Architecture</div>
          <div>Zero Virtual DOM Render Lag · Sub-Pixel Collaborative Carets · 60fps Convergence</div>
        </footer>
      </div>
    </PyrepadProvider>
  );
}

const rootElement = document.getElementById("root");
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<App />);
}
