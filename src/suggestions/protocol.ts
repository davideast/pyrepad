/**
 * Suggestion messages carried on the agentive stream, one slot per suggestion.
 * Every message is idempotent by id because the database echoes local writes.
 */
import type { AgentivePresenceEvent } from "../adapters/types.js";
import type { ProposedEdit, Suggestion } from "./types.js";

export type Resolution = "accepted" | "rejected" | "stale";

export type SuggestionMessage =
  | {
      type: "suggesting";
      id: string;
      agentId: string;
      edit: ProposedEdit;
      before: string;
      hint: number;
    }
  | {
      type: "resolved";
      id: string;
      agentId: string;
      resolution: Resolution;
    };

const RESOLUTIONS: readonly string[] = ["accepted", "rejected", "stale"];

export function encodeSuggesting(
  suggestion: Suggestion,
  before: string,
): AgentivePresenceEvent {
  return {
    agentId: suggestion.agentId,
    slot: suggestion.id,
    status: "suggesting",
    ghostDiff: {
      find: suggestion.original,
      replacement: suggestion.replacement,
      reason: suggestion.reason,
      kind: suggestion.kind,
      before,
      hint: suggestion.from,
    },
    explanation: suggestion.reason,
  };
}

export function encodeResolved(
  agentId: string,
  id: string,
  resolution: Resolution,
): AgentivePresenceEvent {
  return {
    agentId,
    slot: id,
    status: "resolved",
    ghostDiff: { resolution },
  };
}

const isString = (v: unknown): v is string => typeof v === "string";
const isNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

export function decodeMessage(
  event: AgentivePresenceEvent,
): SuggestionMessage | null {
  const { agentId, slot: id } = event;
  if (!id || !agentId) return null;
  const d = event.ghostDiff as Record<string, unknown> | null;
  if (!d || typeof d !== "object") return null;

  if (event.status === "suggesting") {
    if (
      !isString(d.find) ||
      !isString(d.replacement) ||
      !isString(d.reason) ||
      !isString(d.kind)
    )
      return null;
    return {
      type: "suggesting",
      id,
      agentId,
      edit: {
        find: d.find,
        replacement: d.replacement,
        reason: d.reason,
        kind: d.kind,
      },
      before: isString(d.before) ? d.before : "",
      hint: isNumber(d.hint) ? d.hint : 0,
    };
  }
  if (event.status === "resolved") {
    if (!isString(d.resolution) || !RESOLUTIONS.includes(d.resolution))
      return null;
    return {
      type: "resolved",
      id,
      agentId,
      resolution: d.resolution as Resolution,
    };
  }
  return null;
}
