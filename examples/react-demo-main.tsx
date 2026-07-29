/**
 * Interactive declarative React multiplayer demo application utilizing 100% pure ES Module subpaths.
 * Highlights 60fps burst typing without Virtual DOM render lag and live teammate presence over SharedWorkerAdapter seam.
 */
import React, { useEffect, useRef, useState, useTransition } from "react";
import { createRoot } from "react-dom/client";
import { PyrepadProvider, CollaborativeEditor, VERSION } from "../src/react/index.ts";
import { SharedWorkerAdapter } from "../src/adapters/index.ts";

const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("pyric_esm_react_studio") : null;
const workerPort = channel || { postMessage: () => {}, addEventListener: () => {}, removeEventListener: () => {} };

const adapterA = new SharedWorkerAdapter(null, "React-Dev-A", "#3b82f6", workerPort);
const adapterB = new SharedWorkerAdapter(null, "Teammate-B", "#10b981", workerPort);

const sampleText = `// Welcome to the @pyric/pad/react pure ES Module developer studio!
// Notice how rapid typing directly updates the editor mount point
// without EVER invoking React setState or incrementing the parent render count!

function calculateLeverage(depth: number): string {
  const isDeepSeam = depth > 5;
  if (isDeepSeam) {
    return "Deep Seam (High Leverage & Locality)";
  }
  return "Shallow Module";
}
`;

interface HeaderProps {
  renderCount: number;
  onBurst: () => void;
  onSpawnAgent: () => void;
  onForceRender: () => void;
}

function StudioHeader({ renderCount, onBurst, onSpawnAgent, onForceRender }: HeaderProps): React.ReactElement {
  return (
    <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1.25rem 2.5rem", background: "rgba(15, 23, 42, 0.85)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(59, 130, 246, 0.3)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <span style={{ background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)", color: "#ffffff", padding: "0.4rem 0.8rem", borderRadius: "8px", fontWeight: 700, fontSize: "0.85rem" }}>
          @PYRIC/PAD/REACT
        </span>
        <span style={{ fontSize: "1.3rem", fontWeight: 600, color: "#f8fafc" }}>
          Declarative 60fps Multiplayer Studio (v{VERSION})
        </span>
      </div>
      <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
        <div style={{ padding: "0.5rem 1rem", borderRadius: "9999px", background: "rgba(16, 185, 129, 0.15)", color: "#10b981", border: "1px solid rgba(16, 185, 129, 0.4)", fontWeight: 600, fontSize: "0.85rem" }}>
          🟢 Parent Render Count: {renderCount}
        </div>
        <button onClick={onBurst} style={{ background: "#3b82f6", color: "#ffffff", border: "none", padding: "0.6rem 1.2rem", borderRadius: "8px", fontWeight: 600, cursor: "pointer" }}>
          ⚡ Trigger 60fps Burst Typing
        </button>
        <button onClick={onSpawnAgent} style={{ background: "linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)", color: "#ffffff", border: "none", padding: "0.6rem 1.2rem", borderRadius: "8px", fontWeight: 600, cursor: "pointer" }}>
          🤖 Spawn AI Co-Pilot
        </button>
        <button onClick={onForceRender} style={{ background: "transparent", color: "#60a5fa", border: "1px solid rgba(59, 130, 246, 0.4)", padding: "0.6rem 1.2rem", borderRadius: "8px", fontWeight: 600, cursor: "pointer" }}>
          🔄 Test Parent Re-render
        </button>
      </div>
    </header>
  );
}

function StudioFooter(): React.ReactElement {
  return (
    <footer style={{ padding: "1rem 2.5rem", background: "rgba(3, 7, 18, 0.9)", borderTop: "1px solid rgba(255, 255, 255, 0.08)", display: "flex", justifyContent: "space-between", fontSize: "0.85rem", color: "#94a3b8" }}>
      <div>⚡ Powered by @pyric/pad/react Hooks & Pure ESM SharedWorker Architecture</div>
      <div>Zero Virtual DOM Render Lag · Sub-Pixel Collaborative Carets · 60fps Convergence</div>
    </footer>
  );
}

function EditorPane({ title, adapter, userColor, userId, initialDoc, peerCM, onCMCreated }: { title: string; adapter: any; userColor: string; userId: string; initialDoc?: string; peerCM?: any; onCMCreated?: (cm: any) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [cmInstance, setCmInstance] = useState<any>(null);

  useEffect(() => {
    const isReady = Boolean(containerRef.current && !cmInstance && typeof (window as any).CodeMirror === "function");
    if (isReady) {
      const cm = (window as any).CodeMirror(containerRef.current!, { lineNumbers: true, mode: "javascript", theme: "dracula", value: initialDoc || "" });
      cm.on("change", (_i: any, ch: any) => {
        const isSelf = ch.origin !== "peer" && Boolean(peerCM);
        if (isSelf) peerCM.setValue(cm.getValue());
      });
      setCmInstance(cm);
      const hasCB = typeof onCMCreated === "function";
      if (hasCB) onCMCreated!(cm);
    }
  }, [containerRef, cmInstance, initialDoc, peerCM, onCMCreated]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <CollaborativeEditor adapter={adapter} editor={cmInstance} defaultText={initialDoc} type="cm5" userId={userId} userColor={userColor} showCollaboratorBar={true} style={{ minHeight: "460px", flex: 1 }}>
        <div ref={containerRef} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
      </CollaborativeEditor>
    </div>
  );
}

function App(): React.ReactElement {
  const [cmA, setCmA] = useState<any>(null);
  const [cmB, setCmB] = useState<any>(null);
  const [parentRenderCount, setParentRenderCount] = useState(1);
  const [_, startTransition] = useTransition();

  const handleBurstTyping = () => {
    const canBurst = Boolean(cmA && typeof cmA.getCursor === "function");
    if (!canBurst) return;
    let count = 0;
    const interval = setInterval(() => {
      const isDone = count >= 50;
      if (isDone) {
        clearInterval(interval);
        return;
      }
      count++;
      const cursor = cmA.getCursor();
      cmA.replaceRange("⚡", cursor, cursor, "user-burst");
      const hasPeer = Boolean(cmB);
      if (hasPeer) cmB.setValue(cmA.getValue());
    }, 16);
  };

  const handleSpawnAgent = () => {
    const hasTriggerA = Boolean(adapterA && typeof (adapterA as any).trigger === "function");
    if (hasTriggerA) (adapterA as any).trigger("agentive", "Jules-AI", "Refactoring AST for deep seam boundaries", { diff: "+ const leverage = true;" }, "Enhancing modular depth");
    const hasTriggerB = Boolean(adapterB && typeof (adapterB as any).trigger === "function");
    if (hasTriggerB) (adapterB as any).trigger("agentive", "Jules-AI", "Refactoring AST for deep seam boundaries", { diff: "+ const leverage = true;" }, "Enhancing modular depth");
  };

  return (
    <PyrepadProvider adapter={adapterA}>
      <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        <StudioHeader renderCount={parentRenderCount} onBurst={handleBurstTyping} onSpawnAgent={handleSpawnAgent} onForceRender={() => startTransition(() => setParentRenderCount((p) => p + 1))} />
        <main style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem", padding: "2.5rem" }}>
          <EditorPane title="Editor A" adapter={adapterA} userId="React-Dev-A" userColor="#3b82f6" initialDoc={sampleText} peerCM={cmB} onCMCreated={(cm) => setCmA(cm)} />
          <EditorPane title="Editor B" adapter={adapterB} userId="Teammate-B" userColor="#10b981" peerCM={cmA} onCMCreated={(cm) => setCmB(cm)} />
        </main>
        <StudioFooter />
      </div>
    </PyrepadProvider>
  );
}

const rootElement = document.getElementById("root");
const hasRoot = Boolean(rootElement);
if (hasRoot) {
  const root = createRoot(rootElement!);
  root.render(<App />);
}
