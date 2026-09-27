/**
 * useAgentiveDiffs: the latest status of each AI agent, from the SyncSeam
 * `agentive` stream.
 */
import { useEffect, useState, useTransition } from "react";
import { SyncSeam } from "../adapters/types.ts";
import { useResolvedAdapter } from "./context.tsx";
import { consumeStream } from "./consume-stream.ts";

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
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!adapter) return;
    const stop = consumeStream(adapter.agentive, (event) => {
      const isValid = Boolean(event.agentId && event.agentId.trim().length > 0);
      if (!isValid) return;
      const updated: AgentiveDiffState = {
        agentId: event.agentId,
        status: event.status,
        ghostDiff: event.ghostDiff,
        explanation: event.explanation,
        timestamp: Date.now(),
      };
      startTransition(() =>
        setAgents((current) =>
          Object.assign({}, current, { [event.agentId]: updated }),
        ),
      );
    });
    return () => {
      stop();
      setAgents({});
    };
  }, [adapter]);

  return Object.values(agents);
}
