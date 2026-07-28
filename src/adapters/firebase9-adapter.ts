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

class ModularRefProxy implements RefLike {
  private target: unknown;
  private config: Firebase9ModularConfig;
  readonly root: RefLike | undefined;

  constructor(target: unknown, config: Firebase9ModularConfig, root?: RefLike) {
    this.target = target;
    this.config = config;
    this.root = root;
  }

  child(path: string): RefLike {
    const hasChildFn = typeof this.config.child === "function";
    if (hasChildFn) {
      const nextRef = this.config.child!(this.target, path);
      return new ModularRefProxy(nextRef, this.config, this.root || this);
    }
    const isTargetRef = isValidRef(this.target);
    if (isTargetRef) {
      const legacyChild = (this.target as RefLike).child(path);
      return new ModularRefProxy(legacyChild, this.config, this.root || this);
    }
    const virtualTarget = {
      path: `${(this.target as any)?.path || ""}/${path}`,
    };
    return new ModularRefProxy(virtualTarget, this.config, this.root || this);
  }

  on(event: string, callback: (snap: SnapLike) => void): void {
    const hasOnValue = typeof this.config.onValue === "function";
    if (hasOnValue && (event === "value" || !isValidRef(this.target))) {
      this.config.onValue!(this.target, callback);
      return;
    }
    const isTargetRef = isValidRef(this.target);
    if (isTargetRef) (this.target as RefLike).on(event, callback);
  }

  once(event: string, callback: (snap: SnapLike) => void): void {
    const hasOnceFn = typeof this.config.once === "function";
    if (hasOnceFn) {
      this.config.once!(this.target, callback);
      return;
    }
    const isTargetRef = isValidRef(this.target);
    if (isTargetRef) (this.target as RefLike).once(event, callback);
  }

  off(event?: string, callback?: (snap: SnapLike) => void): void {
    const hasOffFn = typeof this.config.off === "function";
    if (hasOffFn) {
      this.config.off!(this.target, callback);
      return;
    }
    const isTargetRef = isValidRef(this.target);
    if (isTargetRef) (this.target as RefLike).off(event, callback);
  }

  set(value: unknown): Promise<void> | void {
    const hasSetFn = typeof this.config.set === "function";
    if (hasSetFn) {
      return this.config.set!(this.target, value);
    }
    const isTargetRef = isValidRef(this.target);
    if (isTargetRef) return (this.target as RefLike).set(value);
  }

  remove(): Promise<void> | void {
    const hasRemoveFn = typeof this.config.remove === "function";
    if (hasRemoveFn) {
      return this.config.remove!(this.target);
    }
    const isTargetRef = isValidRef(this.target);
    if (isTargetRef) return (this.target as RefLike).remove();
  }
}

export class Firebase9Adapter extends AbstractSyncAdapter {
  constructor(refOrConfig: unknown, userId?: string, userColor?: string) {
    super();
    const normalized = this.normalizeReference(refOrConfig);
    this.setupStreams(normalized, "fb9", userColor || "#3b82f6", userId);
    this.initializeConnection();
  }

  private normalizeReference(target: unknown): RefLike | null {
    const isNullOrUndef = target === null || target === undefined;
    if (isNullOrUndef) return null;

    const config = target as Firebase9ModularConfig;
    const isModularConfig = Boolean(
      config && (config.ref || typeof config.onValue === "function"),
    );
    if (isModularConfig) {
      return new ModularRefProxy(config.ref || target, config);
    }

    const isDirectRef = isValidRef(target);
    if (isDirectRef) return target as RefLike;
    return null;
  }
}

export type FirestoreAdapter = Firebase9Adapter;
export const FirestoreAdapter = Firebase9Adapter;
