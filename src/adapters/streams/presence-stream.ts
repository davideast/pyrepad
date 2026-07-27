/**
 * Independent protocol stream handler for collaborative user cursor presence.
 */
import { Cursor } from "../../core/index.ts";
import {
  RefLike,
  SnapLike,
  PresenceEvent,
  getSnapKey,
  getSnapVal,
} from "../types.ts";
import { ReactiveStream } from "../reactive-stream.ts";

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
    const hasValidRef =
      this.ref !== null && typeof this.ref.child === "function";
    if (!hasValidRef) return;

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

    this.stream.push({ userId, cursor, color, state });
    this.onCursorChange(userId, cursor, color);
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

  broadcastPresence(cursor: unknown): Promise<void> {
    const isMissingRef =
      this.ref === null || typeof this.ref.child !== "function";
    if (isMissingRef) return Promise.resolve();

    const userRef = this.ref!.child("users/" + this.getUserId());
    const isRemovingCursor = cursor === null || cursor === undefined;
    if (isRemovingCursor) {
      userRef.remove();
    } else {
      const cursorData =
        cursor &&
        typeof (cursor as Record<string, unknown>).toJSON === "function"
          ? (cursor as { toJSON(): unknown }).toJSON()
          : cursor;
      userRef.set({
        cursor: cursorData,
        color: this.getColor(),
      });
    }
    return Promise.resolve();
  }

  dispose(): void {
    const hasValidRef =
      this.ref !== null && typeof this.ref.child === "function";
    if (hasValidRef) {
      try {
        this.ref!.child("users").off();
        const currentUserId = this.getUserId();
        const hasUserId = Boolean(currentUserId);
        if (hasUserId) {
          this.ref!.child("users/" + currentUserId).remove();
        }
      } catch (err) {
        console.warn("Unexpected error during presence stream teardown:", err);
      }
    }
  }
}
