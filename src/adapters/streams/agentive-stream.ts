/**
 * Independent protocol stream handler for AI tentative ghost diffs and agent status updates.
 */
import {
  RefLike,
  SnapLike,
  AgentivePresenceEvent,
  getSnapKey,
  getSnapVal,
  isValidRef,
  toSafeJSON,
} from "../types.js";
import { ReactiveStream } from "../reactive-stream.js";

export class AgentiveStreamHandler {
  readonly stream = new ReactiveStream<AgentivePresenceEvent>();
  private ref: RefLike | null;
  private onAgentive?: (event: AgentivePresenceEvent) => void;

  constructor(
    ref: RefLike | null,
    onAgentive?: (event: AgentivePresenceEvent) => void,
  ) {
    this.ref = ref;
    this.onAgentive = onAgentive;
  }

  startMonitoring(): void {
    const refValid = isValidRef(this.ref);
    if (!refValid) return;

    const agentiveRef = this.ref!.child("agentive");
    agentiveRef.on("child_added", (snap: SnapLike) =>
      this.handleAgentiveUpdate(snap),
    );
    agentiveRef.on("child_changed", (snap: SnapLike) =>
      this.handleAgentiveUpdate(snap),
    );
  }

  private handleAgentiveUpdate(snap: SnapLike): void {
    const key = getSnapKey(snap);
    const data = (getSnapVal(snap) as Record<string, unknown>) || {};
    const slot =
      typeof data.slot === "string" && data.slot ? data.slot : undefined;
    const agentId =
      slot && typeof data.agentId === "string" && data.agentId
        ? data.agentId
        : key;
    const hasValidAgentId = Boolean(agentId);
    if (!hasValidAgentId) return;

    const hasStatus = typeof data.status === "string";
    if (!hasStatus) return;

    const event: AgentivePresenceEvent = {
      agentId: agentId!,
      status: data.status as string,
      ghostDiff:
        data.ghostDiff !== undefined
          ? (data.ghostDiff as Record<string, unknown>)
          : null,
      explanation: typeof data.explanation === "string" ? data.explanation : "",
    };
    if (slot) event.slot = slot;
    this.stream.push(event);
    this.onAgentive?.(event);
  }

  broadcastAgentive(event: AgentivePresenceEvent): Promise<void>;
  /** @deprecated Pass a single `AgentivePresenceEvent` instead. */
  broadcastAgentive(
    agentId: string,
    status: string,
    ghostDiff?: unknown,
    explanation?: string,
  ): Promise<void>;
  broadcastAgentive(
    eventOrAgentId: AgentivePresenceEvent | string,
    status?: string,
    ghostDiffArg?: unknown,
    explanationArg?: string,
  ): Promise<void> {
    const refInvalid = !isValidRef(this.ref);
    if (refInvalid) return Promise.resolve();

    const isEvent = typeof eventOrAgentId === "object";
    const agentId = isEvent ? eventOrAgentId.agentId : eventOrAgentId;
    const ghostDiff = isEvent ? eventOrAgentId.ghostDiff : ghostDiffArg;
    const explanation = isEvent ? eventOrAgentId.explanation : explanationArg;
    const nextStatus = isEvent ? eventOrAgentId.status : status;

    const diffData = ghostDiff ? toSafeJSON(ghostDiff) : null;
    const slot = isEvent ? eventOrAgentId.slot : undefined;
    const agentiveRef = this.ref!.child(
      "agentive/" + (slot ? agentId + "~" + slot : agentId),
    );
    const payload: Record<string, unknown> = {
      status: nextStatus,
      ghostDiff: diffData,
      explanation: explanation || "",
      timestamp: Date.now(),
    };
    if (slot) {
      payload.agentId = agentId;
      payload.slot = slot;
    }
    return Promise.resolve(agentiveRef.set(payload));
  }

  dispose(): void {
    const refValid = isValidRef(this.ref);
    if (refValid) {
      try {
        this.ref!.child("agentive").off();
      } catch (err) {
        console.warn("Unexpected error during agentive stream teardown:", err);
      }
    }
  }
}
