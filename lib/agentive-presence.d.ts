import { SyncSeam } from './sync-seam';

export interface GhostDiffJSON {
  agentId: string;
  baseRevision: number;
  operation: any;
  explanation: string;
  status: 'suggesting' | 'invalidated';
}

export class GhostDiff {
  agentId: string;
  baseRevision: number;
  operation: any;
  explanation: string;
  status: 'suggesting' | 'invalidated';
  constructor(agentId: string, baseRevision: number, operation: any, explanation?: string);
  rebase(humanOperation: any, newRevision: number): boolean;
  toJSON(): GhostDiffJSON;
}

export class AgentivePresenceManager {
  constructor(syncSeam: SyncSeam);
  proposeGhostDiff(agentId: string, baseRevision: number, operation: any, explanation?: string): GhostDiff;
  dismissGhostDiff(agentId: string): void;
  acceptGhostDiff(agentId: string): Promise<any>;
  getActiveGhost(agentId: string): GhostDiff | null;
  getAllGhosts(): GhostDiff[];
  dispose(): void;
  on(event: string, fn: (...args: any[]) => void): void;
}
