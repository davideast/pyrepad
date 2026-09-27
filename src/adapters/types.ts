/**
 * Type definitions and interfaces for @pyric/pad/adapters synchronization seam.
 */
import { TextOperation, Cursor } from "../core/index.ts";

export interface TextOperationEvent {
  revision: number;
  operation: TextOperation;
  author: string;
  timestamp: number;
}

export interface PresenceEvent {
  userId: string;
  cursor: Cursor | Record<string, unknown> | null;
  color: string;
  state: "active" | "disconnected";
}

export interface AgentivePresenceEvent {
  agentId: string;
  status: "idle" | "thinking" | "suggesting" | "refactoring" | string;
  ghostDiff: Record<string, unknown> | TextOperation | null;
  explanation?: string;
}

export interface CommitAck {
  revision: number;
  committed: boolean;
}

export interface SnapLike {
  val(): unknown;
  key?: string | null;
  name?(): string | null;
}

export function getSnapKey(snap: SnapLike | null | undefined): string | null {
  const hasSnap = snap !== null && snap !== undefined;
  if (!hasSnap) return null;
  const keyProp = snap!.key;
  const hasKeyProp = keyProp !== undefined && keyProp !== null;
  if (hasKeyProp) return keyProp!;
  const hasNameMethod = typeof snap!.name === "function";
  if (hasNameMethod) return snap!.name!();
  return null;
}

export function getSnapVal(snap: unknown): unknown {
  const isSnapObj = typeof snap === "object" && snap !== null;
  if (isSnapObj) {
    const hasValMethod = typeof (snap as SnapLike).val === "function";
    if (hasValMethod) return (snap as SnapLike).val();
  }
  return snap ?? null;
}

export function isValidRef(ref: unknown): boolean {
  const isObjectRef = typeof ref === "object" && ref !== null;
  if (!isObjectRef) return false;
  const hasChildMethod =
    typeof (ref as { child?: unknown }).child === "function";
  return hasChildMethod;
}

export function toSafeJSON(payload: unknown): unknown {
  const isObjectPayload = typeof payload === "object" && payload !== null;
  if (!isObjectPayload) return payload;
  const hasToJSON =
    typeof (payload as { toJSON?: unknown }).toJSON === "function";
  if (hasToJSON) {
    return (payload as { toJSON(): unknown }).toJSON();
  }
  return payload;
}

export interface OnDisconnectLike {
  remove(): Promise<void> | void;
  cancel(): Promise<void> | void;
}

export interface RefLike {
  child(path: string): RefLike;
  root?: RefLike;
  on(event: string, callback: (snap: SnapLike) => void): void;
  once(event: string, callback: (snap: SnapLike) => void): void;
  off(event?: string, callback?: (snap: SnapLike) => void): void;
  set(value: unknown): Promise<void> | void;
  remove(): Promise<void> | void;
  onDisconnect?(): OnDisconnectLike;
  transaction?(
    updateFn: (current: unknown) => unknown,
    onComplete?: (
      err: Error | null,
      committed: boolean,
      snap?: SnapLike,
    ) => void,
  ): void;
}

export interface SyncSeam {
  readonly operations: AsyncIterable<TextOperationEvent>;
  readonly presence: AsyncIterable<PresenceEvent>;
  readonly agentive: AsyncIterable<AgentivePresenceEvent>;

  /**
   * Resolves once the initial document is composed; rejects if the adapter is
   * disposed first. `operations` does not replay the composed document, so
   * subscribe before awaiting this or immediately after it resolves.
   */
  whenReady(): Promise<void>;
  /** True when the composed history has no revisions; throws before ready. */
  isHistoryEmpty(): boolean;
  commitOperation(operation: unknown, author?: string): Promise<CommitAck>;
  broadcastPresence(cursor: unknown): Promise<void>;
  broadcastAgentive(event: AgentivePresenceEvent): Promise<void>;
  /** @deprecated Pass a single `AgentivePresenceEvent` instead. */
  broadcastAgentive(
    agentId: string,
    status: string,
    ghostDiff?: unknown,
    explanation?: string,
  ): Promise<void>;
  dispose(): Promise<void>;
}

/** Listener argument tuples for the events AbstractSyncAdapter triggers. */
export type AdapterEvents = {
  ready: [];
  operation: [op: unknown];
  ack: [];
  retry: [];
  cursor: [userId: string, cursor: unknown, color?: string];
  agentive: [event: AgentivePresenceEvent];
  worker_sync: [payload: unknown];
};

/**
 * "conflict" event raised by OfflineDurableAdapter when a queued offline op cannot be
 * rebased onto the canonical history and is dropped from the queue.
 */
export interface OfflineConflictEvent {
  recordId: string;
  author: string;
  revision: number;
  operation: unknown;
  error: Error;
}

export interface AdapterCallbacks {
  ack?(): void;
  retry?(): void;
  operation?(op: unknown): void;
  cursor?(userId: string, cursor: unknown, color?: string): void;
}
