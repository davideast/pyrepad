export interface TextOperationEvent {
  revision: number;
  operation: any;
  author: string;
  timestamp: number;
}

export interface PresenceEvent {
  userId: string;
  cursor: any | null;
  color: string;
  state: 'active' | 'disconnected';
}

export interface AgentivePresenceEvent {
  agentId: string;
  status: 'idle' | 'thinking' | 'suggesting' | 'refactoring';
  ghostDiff: any | null;
  explanation?: string;
}

export interface CommitAck {
  revision: number;
  committed: boolean;
}

export interface SyncSeam {
  readonly operations: AsyncIterable<TextOperationEvent>;
  readonly presence: AsyncIterable<PresenceEvent>;
  readonly agentive: AsyncIterable<AgentivePresenceEvent>;
  
  commitOperation(operation: any, author?: string): Promise<CommitAck>;
  broadcastPresence(cursor: any): Promise<void>;
  broadcastAgentive(agentId: string, status: string, ghostDiff?: any, explanation?: string): Promise<void>;
  dispose(): Promise<void>;
}

export class PyricSandboxAdapter implements SyncSeam {
  readonly operations: AsyncIterable<TextOperationEvent>;
  readonly presence: AsyncIterable<PresenceEvent>;
  readonly agentive: AsyncIterable<AgentivePresenceEvent>;
  constructor(ref: any, userId?: string, userColor?: string);
  commitOperation(operation: any, author?: string): Promise<CommitAck>;
  broadcastPresence(cursor: any): Promise<void>;
  broadcastAgentive(agentId: string, status: string, ghostDiff?: any, explanation?: string): Promise<void>;
  dispose(): Promise<void>;
  on(event: string, callback: (...args: any[]) => void): void;
  trigger(event: string, ...args: any[]): void;
  sendOperation(operation: any, callback?: (err: Error | null, committed?: boolean) => void, author?: string): void;
  sendCursor(cursor: any): void;
}
