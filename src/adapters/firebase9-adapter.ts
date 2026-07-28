/**
 * Firebase v9+ Modular network adapter implementing SyncSeam.
 * Supports tree-shakable ES Module database bindings and reference structures.
 */
import { RefLike, SnapLike, isValidRef } from "./types.ts";
import { AbstractSyncAdapter } from "./base-adapter.ts";

export interface Firebase9ModularConfig {
  ref?: unknown;
  onValue?(ref: unknown, callback: (snap: SnapLike) => void): void;
  once?(ref: unknown, callback: (snap: SnapLike) => void): void;
  off?(ref: unknown, callback?: (snap: SnapLike) => void): void;
  set?(ref: unknown, value: unknown): Promise<void> | void;
  remove?(ref: unknown): Promise<void> | void;
  child?(ref: unknown, path: string): unknown;
}

export class Firebase9Adapter extends AbstractSyncAdapter {
  constructor(refOrConfig: unknown, userId?: string, userColor?: string) {
    super();
    const normalized = this.normalizeReference(refOrConfig);
    this.setupStreams(normalized, "fb9", userColor || "#3b82f6");
    const hasCustomId = Boolean(userId && userId.trim().length > 0);
    if (hasCustomId) {
      this.userId = userId!;
    }
    this.initializeConnection();
  }

  private normalizeReference(target: unknown): RefLike | null {
    const isNullOrUndef = target === null || target === undefined;
    if (isNullOrUndef) return null;

    const isDirectRef = isValidRef(target);
    if (isDirectRef) return target as RefLike;

    const config = target as Firebase9ModularConfig;
    const hasConfigRef = Boolean(
      config && config.ref && isValidRef(config.ref),
    );
    if (hasConfigRef) return config.ref as RefLike;
    return null;
  }
}

export type FirestoreAdapter = Firebase9Adapter;
export const FirestoreAdapter = Firebase9Adapter;
