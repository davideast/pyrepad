/**
 * useAgentiveDiffs: the latest status of each AI agent, from the SyncSeam
 * `agentive` stream.
 */
import { useEffect, useState, useTransition } from "react";
import { SyncSeam } from "../adapters/types.js";
import { useResolvedAdapter } from "./context.js";
import { consumeStream } from "./consume-stream.js";

export interface AgentiveDiffState {
  agentId: string;
  slot?: string;
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
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!adapter) return;
    const stop = consumeStream(adapter.agentive, (event) => {
      const isValid = Boolean(event.agentId && event.agentId.trim().length > 0);
      if (!isValid) return;
      const updated: AgentiveDiffState = {
        agentId: event.agentId,
        slot: event.slot,
        status: event.status,
        ghostDiff: event.ghostDiff,
        explanation: event.explanation,
        timestamp: Date.now(),
      };
      const key = event.slot ? event.agentId + "~" + event.slot : event.agentId;
      startTransition(() =>
        setAgents((current) => Object.assign({}, current, { [key]: updated })),
      );
    });
    return () => {
      stop();
      setAgents({});
    };
  }, [adapter]);

  return Object.values(agents);
}
