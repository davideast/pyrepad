/**
 * Drop-in declarative React collaborative editor component: <CollaborativeEditor />.
 * Features premium glassmorphic dark-mode styling with vibrant teammate badges and zero Virtual DOM render lag.
 */
import React from "react";
import { SyncSeam } from "../adapters/types.ts";
import { usePyrepadEditor } from "./use-pyrepad-editor.ts";
import { useCollaborators, CollaboratorPresence } from "./use-collaborators.ts";
import { useAgentiveDiffs, AgentiveDiffState } from "./use-agentive-diffs.ts";

export interface CollaborativeEditorProps {
  adapter?: SyncSeam | null;
  editor?: unknown | null;
  type?: "cm5" | "cm6";
  userId?: string;
  userColor?: string;
  className?: string;
  style?: React.CSSProperties;
  showCollaboratorBar?: boolean;
  children?: React.ReactNode;
}

const containerStyle: React.CSSProperties = {
  background: "rgba(15, 23, 42, 0.85)",
  border: "1px solid rgba(59, 130, 246, 0.3)",
  borderRadius: "16px",
  overflow: "hidden",
  boxShadow: "0 10px 30px rgba(0, 0, 0, 0.4)",
  backdropFilter: "blur(12px)",
  display: "flex",
  flexDirection: "column",
  color: "#f8fafc",
  fontFamily: "'Inter', -apple-system, sans-serif",
  minHeight: "380px",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "0.75rem 1.25rem",
  background: "rgba(255, 255, 255, 0.03)",
  borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
};

interface BarProps {
  type: string;
  renderCount: number;
  collaborators: CollaboratorPresence[];
  aiAgents: AgentiveDiffState[];
}

function CollaboratorStatusBar({ type, renderCount, collaborators, aiAgents }: BarProps): React.ReactElement {
  const hasCollaborators = collaborators.length > 0;
  const hasAgents = aiAgents.length > 0;

  return (
    <div className="pyrepad-collaborator-header" style={headerStyle}>
      <div style={{ fontWeight: 600, fontSize: "0.95rem", color: "#60a5fa" }}>
        <span>⚡ Pyrepad Live Editor ({type === "cm6" ? "CodeMirror 6" : "CodeMirror 5"})</span>
        <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", color: "#94a3b8" }}>
          [Renders: {renderCount}]
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
        {hasCollaborators ? (
          collaborators.map((c) => (
            <span
              key={c.userId}
              style={{
                padding: "0.3rem 0.6rem",
                borderRadius: "9999px",
                background: "rgba(59, 130, 246, 0.15)",
                color: c.color,
                border: `1px solid ${c.color}`,
                fontSize: "0.8rem",
                fontWeight: 600,
              }}
            >
              ● {c.userId}
            </span>
          ))
        ) : (
          <span style={{ fontSize: "0.8rem", color: "#64748b" }}>● Ready to sync</span>
        )}
        {hasAgents &&
          aiAgents.map((a) => (
            <span
              key={a.agentId}
              style={{
                padding: "0.3rem 0.6rem",
                borderRadius: "8px",
                background: "linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)",
                color: "#ffffff",
                fontSize: "0.8rem",
                fontWeight: 700,
              }}
            >
              🤖 {a.agentId}: {a.status}
            </span>
          ))}
      </div>
    </div>
  );
}

export function CollaborativeEditor(props: CollaborativeEditorProps): React.ReactElement {
  const {
    adapter,
    editor,
    type = "cm6",
    userId = "react-client",
    userColor = "#3b82f6",
    className,
    style,
    showCollaboratorBar = true,
    children,
  } = props;

  const editorState = usePyrepadEditor({
    adapter: adapter || null,
    editor: editor || null,
    type: type,
    userId: userId,
    userColor: userColor,
  });

  const collaborators = useCollaborators(adapter || null);
  const aiAgents = useAgentiveDiffs(adapter || null);
  const shouldRenderBar = Boolean(showCollaboratorBar);
  const mergedStyle = Object.assign({}, containerStyle, style || {});

  return (
    <div className={className ? `pyrepad-editor-wrapper ${className}` : "pyrepad-editor-wrapper"} style={mergedStyle}>
      {shouldRenderBar ? (
        <CollaboratorStatusBar
          type={type}
          renderCount={editorState.renderCount}
          collaborators={collaborators}
          aiAgents={aiAgents}
        />
      ) : null}
      <div className="pyrepad-editor-mount" style={{ flex: 1, position: "relative" }}>
        {children}
      </div>
    </div>
  );
}
