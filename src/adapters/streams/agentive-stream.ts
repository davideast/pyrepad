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
} from "../types.ts";
import { ReactiveStream } from "../reactive-stream.ts";

export class AgentiveStreamHandler {
  readonly stream = new ReactiveStream<AgentivePresenceEvent>();
  private ref: RefLike | null;

  constructor(ref: RefLike | null) {
    this.ref = ref;
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
    const agentId = getSnapKey(snap);
    const hasValidAgentId = Boolean(agentId);
    if (!hasValidAgentId) return;

    const data = (getSnapVal(snap) as Record<string, unknown>) || {};
    const hasStatus = typeof data.status === "string";
    if (!hasStatus) return;

    this.stream.push({
      agentId: agentId!,
      status: data.status as string,
      ghostDiff:
        data.ghostDiff !== undefined
          ? (data.ghostDiff as Record<string, unknown>)
          : null,
      explanation: typeof data.explanation === "string" ? data.explanation : "",
    });
  }

  broadcastAgentive(
    agentId: string,
    status: string,
    ghostDiff?: unknown,
    explanation?: string,
  ): Promise<void> {
    const refInvalid = !isValidRef(this.ref);
    if (refInvalid) return Promise.resolve();

    const diffData = ghostDiff ? toSafeJSON(ghostDiff) : null;
    const agentiveRef = this.ref!.child("agentive/" + agentId);
    return Promise.resolve(
      agentiveRef.set({
        status,
        ghostDiff: diffData,
        explanation: explanation || "",
        timestamp: Date.now(),
      }),
    );
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
