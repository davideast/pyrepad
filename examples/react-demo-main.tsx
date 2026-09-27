/**
 * Interactive declarative React multiplayer demo application utilizing 100% pure ES Module subpaths.
 * Two editors, each with its own FirebaseAdapter on one shared Realtime Database path. Under
 * `bun run dev`, @pyric/cli/vite maps the `firebase/*` imports to the hosted Pyric sandbox, so no
 * Firebase project is needed. `?room=<name>` picks the database path (default "default").
 */
import React, { useEffect, useRef, useState, useTransition } from "react";
import { createRoot } from "react-dom/client";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, child, onValue, onChildAdded, onChildChanged, onChildRemoved, off, get, set, remove, runTransaction } from "firebase/database";
import { PyrepadProvider, CollaborativeEditor, VERSION } from "../src/react/index.ts";
import { FirebaseAdapter, type FirebaseModularConfig, type AgentivePresenceEvent } from "../src/adapters/index.ts";

const db = getDatabase(initializeApp({ projectId: "demo-react-pad" }));
const room = new URLSearchParams(window.location.search).get("room") || "default";
const modularConfig = { ref: ref(db, `pyrepad-react-demo/${room}`), child, onValue, onChildAdded, onChildChanged, onChildRemoved, off, get, set, remove, runTransaction } as FirebaseModularConfig;

const adapterA = new FirebaseAdapter(modularConfig, "React-Dev-A", "#3b82f6");
const adapterB = new FirebaseAdapter(modularConfig, "Teammate-B", "#10b981");

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
      <div>⚡ Powered by @pyric/pad/react Hooks over the Pyric Realtime Database sandbox</div>
      <div>Zero Virtual DOM Render Lag · Sub-Pixel Collaborative Carets · 60fps Convergence</div>
    </footer>
  );
}

function EditorPane({ title, adapter, userColor, userId, initialDoc, onCMCreated }: { title: string; adapter: any; userColor: string; userId: string; initialDoc?: string; onCMCreated?: (cm: any) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [cmInstance, setCmInstance] = useState<any>(null);

  useEffect(() => {
    const isReady = Boolean(containerRef.current && !cmInstance && typeof (window as any).CodeMirror === "function");
    if (isReady) {
      const cm = (window as any).CodeMirror(containerRef.current!, { lineNumbers: true, mode: "javascript", theme: "dracula", value: "" }); // defaultText seeds the shared document; pre-filling the editor would skip it
      setCmInstance(cm);
      const hasCB = typeof onCMCreated === "function";
      if (hasCB) onCMCreated!(cm);
    }
  }, [containerRef, cmInstance, initialDoc, onCMCreated]);

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
    }, 16);
  };

  const handleSpawnAgent = () => {
    const event: AgentivePresenceEvent = { agentId: "Jules-AI", status: "Refactoring AST for deep seam boundaries", ghostDiff: { diff: "+ const leverage = true;" }, explanation: "Enhancing modular depth" };
    adapterA.broadcastAgentive(event).catch((err) => console.warn("broadcastAgentive failed:", err));
  };

  return (
    <PyrepadProvider adapter={adapterA}>
      <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        <StudioHeader renderCount={parentRenderCount} onBurst={handleBurstTyping} onSpawnAgent={handleSpawnAgent} onForceRender={() => startTransition(() => setParentRenderCount((p) => p + 1))} />
        <main style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem", padding: "2.5rem" }}>
          <EditorPane title="Editor A" adapter={adapterA} userId="React-Dev-A" userColor="#3b82f6" initialDoc={sampleText} onCMCreated={setCmA} />
          {/* Only one pane seeds: two clients seeding an empty document at once both commit it. */}
          <EditorPane title="Editor B" adapter={adapterB} userId="Teammate-B" userColor="#10b981" />
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
