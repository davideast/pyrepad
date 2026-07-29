/**
 * Single-file custom reactive hook: useAgentiveDiffs.
 * Tracks live AI coding agent co-pilots over dedicated protocol stream channels.
 */
import { useEffect, useState, useRef, useTransition } from "react";
import { SyncSeam } from "../adapters/types.ts";
import { useResolvedAdapter } from "./context.tsx";

export interface AgentiveDiffState {
  agentId: string;
  status: string;
  ghostDiff?: unknown;
  explanation?: string;
  timestamp: number;
}

export function useAgentiveDiffs(
  custom?: SyncSeam | null,
): AgentiveDiffState[] {
  const adapter = useResolvedAdapter(custom);
  const [agents, setAgents] = useState<Record<string, AgentiveDiffState>>({});
  const mapRef = useRef<Record<string, AgentiveDiffState>>({});
  const [_, startTransition] = useTransition();

  useEffect(() => {
    const hasAdapter = Boolean(adapter);
    if (!hasAdapter) {
      mapRef.current = {};
      startTransition(() => setAgents({}));
      return;
    }

    const handleAgentive = (
      agentId: string,
      status: string,
      ghostDiff?: unknown,
      exp?: string,
    ) => {
      const isValid = Boolean(agentId && agentId.trim().length > 0);
      if (!isValid) return;
      const updated: AgentiveDiffState = {
        agentId: agentId,
        status: status,
        ghostDiff: ghostDiff,
        explanation: exp,
        timestamp: Date.now(),
      };
      const copy = Object.assign({}, mapRef.current, { [agentId]: updated });
      mapRef.current = copy;
      startTransition(() => setAgents(copy));
    };

    const hasOn = typeof (adapter as any).on === "function";
    if (hasOn) {
      try {
        (adapter as any).on("agentive", handleAgentive);
      } catch (err) {
        console.warn("Adapter did not accept agentive event listener:", err);
      }
    }

    return () => {
      const hasOff = typeof (adapter as any).off === "function";
      if (hasOff) {
        try {
          (adapter as any).off("agentive", handleAgentive);
        } catch (err) {
          console.warn("Error removing useAgentiveDiffs listener:", err);
        }
      }
    };
  }, [adapter]);

  return Object.keys(agents).map((key) => agents[key]);
}
