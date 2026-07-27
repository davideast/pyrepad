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

export interface RefLike {
  child(path: string): RefLike;
  root?: RefLike;
  on(event: string, callback: (snap: SnapLike) => void): void;
  once(event: string, callback: (snap: SnapLike) => void): void;
  off(event?: string, callback?: (snap: SnapLike) => void): void;
  set(value: unknown): Promise<void> | void;
  remove(): Promise<void> | void;
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

  commitOperation(operation: unknown, author?: string): Promise<CommitAck>;
  broadcastPresence(cursor: unknown): Promise<void>;
  broadcastAgentive(
    agentId: string,
    status: string,
    ghostDiff?: unknown,
    explanation?: string,
  ): Promise<void>;
  dispose(): Promise<void>;
}

export interface AdapterCallbacks {
  ack?(): void;
  retry?(): void;
  operation?(op: unknown): void;
  cursor?(userId: string, cursor: unknown, color?: string): void;
}
