/**
 * Single-file custom reactive hook: useCollaborators.
 * Subscribes solely to segregated teammate presence streams without triggering
 * re-renders during high-frequency operational typing bursts.
 */
import { useEffect, useState, useRef, useTransition } from "react";
import { SyncSeam } from "../adapters/types.ts";
import { useResolvedAdapter } from "./context.tsx";

export interface CollaboratorPresence {
  userId: string;
  color: string;
  cursor: unknown;
  lastSeen: number;
}

export function useCollaborators(
  custom?: SyncSeam | null,
): CollaboratorPresence[] {
  const adapter = useResolvedAdapter(custom);
  const [collaborators, setCollaborators] = useState<
    Record<string, CollaboratorPresence>
  >({});
  const mapRef = useRef<Record<string, CollaboratorPresence>>({});
  const [_, startTransition] = useTransition();

  useEffect(() => {
    const hasAdapter = Boolean(adapter);
    if (!hasAdapter) {
      mapRef.current = {};
      startTransition(() => setCollaborators({}));
      return;
    }

    const handleCursor = (userId: string, cursor: unknown, color?: string) => {
      const isValid = Boolean(userId && userId.trim().length > 0);
      if (!isValid) return;
      const defaultColor = color || "#3b82f6";
      const updated: CollaboratorPresence = {
        userId: userId,
        cursor: cursor,
        color: defaultColor,
        lastSeen: Date.now(),
      };
      const copy = Object.assign({}, mapRef.current, { [userId]: updated });
      mapRef.current = copy;
      startTransition(() => setCollaborators(copy));
    };

    const hasOn = typeof (adapter as any).on === "function";
    if (hasOn) {
      try {
        (adapter as any).on("cursor", handleCursor);
      } catch (err) {
        console.warn("Adapter did not accept cursor event listener:", err);
      }
    }

    return () => {
      const hasOff = typeof (adapter as any).off === "function";
      if (hasOff) {
        try {
          (adapter as any).off("cursor", handleCursor);
        } catch (err) {
          console.warn(
            "Error removing useCollaborators presence listener:",
            err,
          );
        }
      }
    };
  }, [adapter]);

  const keys = Object.keys(collaborators);
  return keys.map((key) => collaborators[key]);
}
