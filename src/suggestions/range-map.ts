/**
 * Position mapping through simultaneous text changes. Changes are sorted,
 * non-overlapping and expressed in old-document coordinates, which is how both
 * a CodeMirror ChangeSet and a TextOperation describe one transaction.
 */
import type { TextChange } from "./types.js";

/**
 * Maps `pos` through `changes`. A position sitting on an insertion moves after
 * it when `assoc > 0` and stays before it otherwise; a position inside a
 * deleted or replaced span collapses to its start (`assoc < 0`) or past the
 * replacement text (`assoc > 0`).
 */
export function mapPos(
  pos: number,
  changes: readonly TextChange[],
  assoc: -1 | 1,
): number {
  let delta = 0;
  for (const change of changes) {
    if (pos < change.from) break;
    const isInsertion = change.from === change.to;
    if (isInsertion && pos === change.from) {
      if (assoc < 0) break;
      delta += change.insert.length;
      continue;
    }
    const wasReplaced = change.to - change.from;
    if (pos > change.to || (pos === change.to && !isInsertion)) {
      delta += change.insert.length - wasReplaced;
      continue;
    }
    if (pos === change.from) break;
    return change.from + delta + (assoc > 0 ? change.insert.length : 0);
  }
  return pos + delta;
}

export interface MappedRange {
  from: number;
  to: number;
  /** An edit landed strictly inside the range, so its text no longer matches. */
  touched: boolean;
}

/** Maps a span; typing at either edge keeps the span on its original text. */
export function mapRange(
  from: number,
  to: number,
  changes: readonly TextChange[],
): MappedRange {
  const touched = changes.some((change) =>
    change.from === change.to
      ? change.from > from && change.from < to
      : change.from < to && change.to > from,
  );
  return {
    from: mapPos(from, changes, 1),
    to: mapPos(to, changes, -1),
    touched,
  };
}

/** Where each change's inserted text sits in the new document (empty inserts omitted). */
export function changeSpansAfter(
  changes: readonly TextChange[],
): Array<{ from: number; to: number }> {
  const spans: Array<{ from: number; to: number }> = [];
  let delta = 0;
  for (const change of changes) {
    const start = change.from + delta;
    if (change.insert.length > 0) {
      spans.push({ from: start, to: start + change.insert.length });
    }
    delta += change.insert.length - (change.to - change.from);
  }
  return spans;
}
