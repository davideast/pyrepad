/**
 * Unsaved local edits persisted across reloads, and their rebase onto the
 * history written since.
 */
import { TextOperation } from "../../core/index.js";

/** Local edits the server had not accepted, relative to the document at `revision`. */
export interface UnsavedSnapshot {
  docId: string;
  /** Revisions the client had received when the snapshot was taken. */
  revision: number;
  /** Length of the document at `revision`. */
  baseLength: number;
  /** The op that was written but not yet acknowledged; it may have landed. */
  sent: unknown[] | null;
  /** Every later local edit, applying after `sent`. */
  rest: unknown[] | null;
  savedAt: number;
}

/** One history entry, as stored: author and serialized op. */
export interface HistoryRecord {
  author: string;
  op: unknown;
}

export interface RebaseResult {
  /** The edits still to apply on top of the history, or null if none remain. */
  op: TextOperation | null;
  /** Indexes (from the snapshot's revision) of entries that could not be applied. */
  skipped: number[];
}

function decode(raw: unknown[] | null): TextOperation | null {
  return raw ? TextOperation.fromJSON(raw) : null;
}

/**
 * Rebases `snapshot` over `entries` (the history from `snapshot.revision` on).
 * An entry by `userId` equal to the sent op is that op having landed before the
 * reload, so it is dropped rather than applied twice. Entries that don't fit
 * the document are skipped, exactly as live clients skip them.
 */
export function rebaseUnsaved(
  snapshot: UnsavedSnapshot,
  entries: readonly HistoryRecord[],
  userId: string,
): RebaseResult {
  let sent = decode(snapshot.sent);
  let rest = decode(snapshot.rest);
  let length = snapshot.baseLength;
  const skipped: number[] = [];
  entries.forEach((entry, index) => {
    let remote: TextOperation;
    try {
      remote = TextOperation.fromJSON(entry.op);
      if (remote.baseLength !== length) throw new Error("length mismatch");
    } catch {
      skipped.push(index);
      return;
    }
    length = remote.targetLength;
    if (sent && entry.author === userId && sent.equals(remote)) {
      sent = null;
      return;
    }
    if (sent) [sent, remote] = TextOperation.transform(sent, remote);
    if (rest) [rest] = TextOperation.transform(rest, remote);
  });
  const op = sent && rest ? sent.compose(rest) : (sent ?? rest);
  return { op: op && !op.isNoop() ? op : null, skipped };
}
