/**
 * Independent protocol stream handler for collaborative user cursor presence.
 */
import { Cursor } from "../../core/index.js";
import {
  RefLike,
  SnapLike,
  PresenceEvent,
  SyncError,
  getSnapKey,
  getSnapVal,
  isValidRef,
  toSafeJSON,
} from "../types.js";
import { ReactiveStream } from "../reactive-stream.js";

export class PresenceStreamHandler {
  readonly stream = new ReactiveStream<PresenceEvent>();
  private ref: RefLike | null;
  private getUserId: () => string;
  private getColor: () => string;
  private onCursorChange: (
    userId: string,
    cursor: unknown,
    color?: string,
  ) => void;
  getName: () => string = () => "";

  getThrottleMs: () => number = () => 0;
  private lastWrite = 0;
  private trailing: ReturnType<typeof setTimeout> | null = null;
  private latest: unknown = null;
  private hasDisconnectCleanup = false;

  /** Receives failed presence writes. */
  onError: (error: SyncError) => void = () => {};

  constructor(
    ref: RefLike | null,
    getUserId: () => string,
    getColor: () => string,
    onCursorChange: (userId: string, cursor: unknown, color?: string) => void,
  ) {
    this.ref = ref;
    this.getUserId = getUserId;
    this.getColor = getColor;
    this.onCursorChange = onCursorChange;
  }

  startMonitoring(): void {
    const refValid = isValidRef(this.ref);
    if (!refValid) return;

    const usersRef = this.ref!.child("users");
    usersRef.on("child_added", (snap: SnapLike) =>
      this.handleUserUpdate(snap, "active"),
    );
    usersRef.on("child_changed", (snap: SnapLike) =>
      this.handleUserUpdate(snap, "active"),
    );
    usersRef.on("child_removed", (snap: SnapLike) =>
      this.handleUserRemoved(snap),
    );
  }

  private handleUserUpdate(
    snap: SnapLike,
    state: "active" | "disconnected",
  ): void {
    const userId = getSnapKey(snap);
    const isSelfOrInvalid = !userId || userId === this.getUserId();
    if (isSelfOrInvalid) return;

    const data = (getSnapVal(snap) as Record<string, unknown>) || {};
    const hasCursorData = Boolean(data && data.cursor);
    if (!hasCursorData) return;

    const cursorObj = data.cursor as { position: number; selectionEnd: number };
    const cursor =
      typeof cursorObj.position === "number"
        ? Cursor.fromJSON(cursorObj)
        : cursorObj;
    const color = typeof data.color === "string" ? data.color : "#ff0000";

    const name =
      typeof data.name === "string" ? data.name.slice(0, 60) : undefined;
    this.stream.push({
      userId: userId!,
      cursor,
      color,
      ...(name ? { name } : {}),
      state,
    });
    this.onCursorChange(userId!, cursor, color);
  }

  private handleUserRemoved(snap: SnapLike): void {
    const userId = getSnapKey(snap);
    const isValidPeer = Boolean(userId && userId !== this.getUserId());
    if (!isValidPeer) return;

    this.stream.push({
      userId: userId!,
      cursor: null,
      color: "#ff0000",
      state: "disconnected",
    });
    this.onCursorChange(userId!, null);
  }

  async broadcastPresence(cursor: unknown): Promise<void> {
    const throttleMs = this.getThrottleMs();
    const isRemoving = cursor === null || cursor === undefined;
    if (this.trailing) clearTimeout(this.trailing);
    this.trailing = null;
    if (throttleMs <= 0 || isRemoving) return this.writePresence(cursor);
    const wait = this.lastWrite + throttleMs - Date.now();
    if (wait <= 0) return this.writePresence(cursor);
    this.latest = cursor;
    this.trailing = setTimeout(() => {
      this.trailing = null;
      void this.writePresence(this.latest);
    }, wait);
  }

  private async writePresence(cursor: unknown): Promise<void> {
    this.lastWrite = Date.now();
    const refInvalid = !isValidRef(this.ref);
    if (refInvalid) return;

    const userRef = this.ref!.child("users/" + this.getUserId());
    const isRemovingCursor = cursor === null || cursor === undefined;
    if (isRemovingCursor) this.hasDisconnectCleanup = false;
    try {
      if (isRemovingCursor) {
        await userRef.remove();
      } else {
        this.registerDisconnectCleanup(userRef);
        const name = this.getName();
        await userRef.set({
          cursor: toSafeJSON(cursor),
          color: this.getColor(),
          ...(name ? { name } : {}),
        });
      }
    } catch (cause) {
      this.onError({
        kind: "presence-failed",
        message: "The cursor position could not be shared.",
        cause,
      });
    }
  }

  private registerDisconnectCleanup(userRef: RefLike): void {
    const hasOnDisconnect = typeof userRef.onDisconnect === "function";
    if (!hasOnDisconnect || this.hasDisconnectCleanup) return;
    this.hasDisconnectCleanup = true;
    const pending = userRef.onDisconnect!().remove();
    Promise.resolve(pending).catch((cause) => {
      this.hasDisconnectCleanup = false;
      this.onError({
        kind: "presence-failed",
        message: "Disconnect cleanup for this cursor could not be registered.",
        cause,
      });
    });
  }

  dispose(): void {
    if (this.trailing) clearTimeout(this.trailing);
    this.trailing = null;
    const refValid = isValidRef(this.ref);
    if (refValid) {
      try {
        this.ref!.child("users").off();
        const currentUserId = this.getUserId();
        const hasUserId = Boolean(currentUserId);
        if (hasUserId) {
          const pending = this.ref!.child("users/" + currentUserId).remove();
          Promise.resolve(pending).catch((err) =>
            console.warn("Presence removal failed during teardown:", err),
          );
        }
      } catch (err) {
        console.warn("Unexpected error during presence stream teardown:", err);
      }
    }
  }
}
