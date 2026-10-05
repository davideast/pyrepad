/**
 * useCollaborators: the peers currently present, from the SyncSeam `presence`
 * stream. Only presence events re-render; document edits do not.
 */
import { useEffect, useState, useTransition } from "react";
import { SyncSeam, PresenceEvent } from "../adapters/types.js";
import { useResolvedAdapter } from "./context.js";
import { consumeStream } from "./consume-stream.js";

export interface CollaboratorPresence {
  userId: string;
  color: string;
  name?: string;
  cursor: unknown;
  lastSeen: number;
}

type CollaboratorMap = Record<string, CollaboratorPresence>;

function reducePresence(
  current: CollaboratorMap,
  event: PresenceEvent,
): CollaboratorMap {
  const isGone = event.state === "disconnected" || event.cursor === null;
  if (isGone) {
    const next = Object.assign({}, current);
    delete next[event.userId];
    return next;
  }
  const updated: CollaboratorPresence = {
    userId: event.userId,
    cursor: event.cursor,
    color: event.color || "#3b82f6",
    ...(event.name ? { name: event.name } : {}),
    lastSeen: Date.now(),
  };
  return Object.assign({}, current, { [event.userId]: updated });
}

export function useCollaborators(
  custom?: SyncSeam | null,
): CollaboratorPresence[] {
  const adapter = useResolvedAdapter(custom);
  const [collaborators, setCollaborators] = useState<CollaboratorMap>({});
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!adapter) return;
    const stop = consumeStream(adapter.presence, (event) => {
      const isValid = Boolean(event.userId && event.userId.trim().length > 0);
      if (!isValid) return;
      startTransition(() =>
        setCollaborators((current) => reducePresence(current, event)),
      );
    });
    return () => {
      stop();
      setCollaborators({});
    };
  }, [adapter]);

  return Object.values(collaborators);
}
