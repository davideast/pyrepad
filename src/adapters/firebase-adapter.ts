/**
 * Modern tree-shakable Firebase modular network adapter implementing SyncSeam.
 * Supports evolving ES Module database bindings and modular reference structures.
 */
import { RefLike, SnapLike, isValidRef } from "./types.ts";
import { AbstractSyncAdapter } from "./base-adapter.ts";

type SnapCallback = (snap: SnapLike) => void;
type Unsubscribe = () => void;
type ModularListen = (
  ref: unknown,
  callback: SnapCallback,
) => Unsubscribe | void;

/**
 * The Firebase v9+ modular free functions the adapter needs. Pass them straight from
 * `firebase/database` (`ref`, `child`, `onValue`, `onChildAdded`, `get`, `set`, ...).
 */
export interface FirebaseModularConfig {
  ref?: unknown;
  onValue?: ModularListen;
  onChildAdded?: ModularListen;
  onChildChanged?: ModularListen;
  onChildRemoved?: ModularListen;
  get?(ref: unknown): Promise<SnapLike>;
  /** Legacy shim; prefer `get`. */
  once?(ref: unknown, callback: SnapCallback): void;
  off?(ref: unknown, eventType?: string, callback?: SnapCallback): void;
  set?(ref: unknown, value: unknown): Promise<void> | void;
  remove?(ref: unknown): Promise<void> | void;
  runTransaction?(
    ref: unknown,
    update: (current: unknown) => unknown,
  ): Promise<{ committed: boolean; snapshot: SnapLike }>;
  child?(ref: unknown, path: string): unknown;
}

const LISTENER_FOR_EVENT: Record<string, keyof FirebaseModularConfig> = {
  value: "onValue",
  child_added: "onChildAdded",
  child_changed: "onChildChanged",
  child_removed: "onChildRemoved",
};

interface Registration {
  event: string;
  callback: SnapCallback;
  unsubscribe: Unsubscribe | null;
}

/** The config plus live subscriptions keyed by proxy path, shared across one proxy tree. */
interface ProxyTree {
  config: FirebaseModularConfig;
  registry: Map<string, Registration[]>;
}

class ModularRefProxy implements RefLike {
  private target: unknown;
  private tree: ProxyTree;
  private config: FirebaseModularConfig;
  private registry: Map<string, Registration[]>;
  private path: string;
  private rootProxy: ModularRefProxy | undefined;

  constructor(
    target: unknown,
    tree: ProxyTree,
    root?: ModularRefProxy | "self",
    path = "",
  ) {
    this.target = target;
    this.tree = tree;
    this.config = tree.config;
    this.registry = tree.registry;
    this.path = path;
    this.rootProxy = root === "self" ? this : (root ?? this.databaseRoot());
  }

  get root(): RefLike | undefined {
    return this.rootProxy;
  }

  /** Modular refs expose the database root as `.root`; `.info/connected` lives there. */
  private databaseRoot(): ModularRefProxy | undefined {
    const dbRoot = (this.target as { root?: unknown } | null)?.root;
    const hasDbRoot =
      typeof dbRoot === "object" && dbRoot !== null && dbRoot !== this.target;
    if (!hasDbRoot) return undefined;
    return new ModularRefProxy(dbRoot, this.tree, "self", "@root");
  }

  child(path: string): RefLike {
    const root = this.rootProxy || this;
    const childPath = `${this.path}/${path}`;
    const hasChildFn = typeof this.config.child === "function";
    if (hasChildFn) {
      const nextRef = this.config.child!(this.target, path);
      return this.wrap(nextRef, root, childPath);
    }
    const isTargetRef = isValidRef(this.target);
    if (isTargetRef) {
      const legacyChild = (this.target as RefLike).child(path);
      return this.wrap(legacyChild, root, childPath);
    }
    const virtualTarget = {
      path: `${(this.target as any)?.path || ""}/${path}`,
    };
    return this.wrap(virtualTarget, root, childPath);
  }

  private wrap(
    target: unknown,
    root: ModularRefProxy,
    path: string,
  ): ModularRefProxy {
    return new ModularRefProxy(target, this.tree, root, path);
  }

  private modularListener(event: string): ModularListen | null {
    const name = LISTENER_FOR_EVENT[event];
    const fn = name ? this.config[name] : undefined;
    return typeof fn === "function" ? (fn as ModularListen) : null;
  }

  on(event: string, callback: SnapCallback): void {
    const listen = this.modularListener(event);
    if (listen) {
      const unsubscribe = listen(this.target, callback);
      const registrations = this.registry.get(this.path) || [];
      registrations.push({
        event,
        callback,
        unsubscribe: typeof unsubscribe === "function" ? unsubscribe : null,
      });
      this.registry.set(this.path, registrations);
      return;
    }
    const isTargetRef = isValidRef(this.target);
    if (isTargetRef) (this.target as RefLike).on(event, callback);
  }

  once(event: string, callback: SnapCallback): void {
    const hasGetFn = typeof this.config.get === "function";
    if (event === "value" && hasGetFn) {
      void this.config.get!(this.target).then(callback);
      return;
    }
    const hasOnceFn = typeof this.config.once === "function";
    if (hasOnceFn) {
      this.config.once!(this.target, callback);
      return;
    }
    const isTargetRef = isValidRef(this.target);
    if (isTargetRef) (this.target as RefLike).once(event, callback);
  }

  off(event?: string, callback?: SnapCallback): void {
    const registrations = this.registry.get(this.path) || [];
    const matches = (r: Registration) =>
      (event === undefined || r.event === event) &&
      (callback === undefined || r.callback === callback);
    const removed = registrations.filter(matches);
    const kept = registrations.filter((r) => !matches(r));
    if (kept.length > 0) this.registry.set(this.path, kept);
    else this.registry.delete(this.path);

    const hasOffFn = typeof this.config.off === "function";
    for (const r of removed) {
      if (r.unsubscribe) r.unsubscribe();
      else if (hasOffFn) this.config.off!(this.target, r.event, r.callback);
    }
    if (removed.length > 0) return;

    if (hasOffFn) {
      this.config.off!(this.target, event, callback);
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

  transaction(
    updateFn: (current: unknown) => unknown,
    onComplete?: (
      err: Error | null,
      committed: boolean,
      snap?: SnapLike,
    ) => void,
  ): void {
    const hasRunTransaction = typeof this.config.runTransaction === "function";
    if (hasRunTransaction) {
      this.config.runTransaction!(this.target, updateFn).then(
        (result) => onComplete?.(null, result.committed, result.snapshot),
        (err: Error) => onComplete?.(err, false),
      );
      return;
    }
    const legacy = this.target as RefLike;
    const hasLegacyTransaction =
      isValidRef(this.target) && typeof legacy.transaction === "function";
    if (hasLegacyTransaction) {
      legacy.transaction!(updateFn, onComplete);
      return;
    }
    onComplete?.(new Error("Transaction unsupported"), false);
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

export class FirebaseAdapter extends AbstractSyncAdapter {
  constructor(refOrConfig: unknown, userId?: string, userColor?: string) {
    super();
    const normalized = this.normalizeReference(refOrConfig);
    this.setupStreams(normalized, "firebase", userColor || "#3b82f6", userId);
    this.initializeConnection();
  }

  private normalizeReference(target: unknown): RefLike | null {
    const isNullOrUndef = target === null || target === undefined;
    if (isNullOrUndef) return null;

    const config = target as FirebaseModularConfig;
    const isModularConfig = Boolean(
      config && (config.ref || typeof config.onValue === "function"),
    );
    if (isModularConfig) {
      return new ModularRefProxy(config.ref || target, {
        config,
        registry: new Map(),
      });
    }

    const isDirectRef = isValidRef(target);
    if (isDirectRef) return target as RefLike;
    return null;
  }
}

export type FirebaseModularAdapter = FirebaseAdapter;
export const FirebaseModularAdapter = FirebaseAdapter;
