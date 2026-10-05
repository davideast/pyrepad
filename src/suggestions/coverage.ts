/**
 * The parts of the document the assistant has already reviewed. Edits carve
 * holes in coverage (so changed text is reviewed again) and shift what remains.
 */
import { changeSpansAfter, mapPos } from "./range-map.js";
import type { TextChange } from "./types.js";

export interface Span {
  from: number;
  to: number;
}

export class Coverage {
  private spans: Span[] = [];

  add(from: number, to: number): void {
    if (to <= from) return;
    this.spans.push({ from, to });
    this.spans = merge(this.spans);
  }

  /** True when `from..to` lies entirely inside reviewed text. */
  covers(from: number, to: number): boolean {
    return this.spans.some((span) => span.from <= from && span.to >= to);
  }

  /**
   * Rebases coverage through a transaction. Text inside an edit loses coverage;
   * with `coverInserted` the newly inserted text is marked reviewed instead
   * (used for the assistant's own accepted suggestions).
   */
  applyChanges(changes: readonly TextChange[], coverInserted = false): void {
    if (changes.length === 0) return;
    const pieces: Span[] = [];
    for (const span of this.spans) {
      let cursor = span.from;
      for (const change of changes) {
        const isInsertion = change.from === change.to;
        const splits = isInsertion
          ? change.from > span.from && change.from < span.to
          : change.from < span.to && change.to > span.from;
        if (!splits) continue;
        if (change.from > cursor)
          pieces.push({ from: cursor, to: change.from });
        cursor = Math.max(cursor, Math.min(change.to, span.to));
      }
      if (cursor < span.to) pieces.push({ from: cursor, to: span.to });
    }
    const mapped = pieces
      .map((piece) => ({
        from: mapPos(piece.from, changes, 1),
        to: mapPos(piece.to, changes, -1),
      }))
      .filter((piece) => piece.to > piece.from);
    const inserted = coverInserted ? changeSpansAfter(changes) : [];
    this.spans = merge([...mapped, ...inserted]);
  }

  /** Forgets `from..to`, so that text is reviewed again. */
  remove(from: number, to: number): void {
    const pieces: Span[] = [];
    for (const span of this.spans) {
      if (span.from < from)
        pieces.push({ from: span.from, to: Math.min(span.to, from) });
      if (span.to > to)
        pieces.push({ from: Math.max(span.from, to), to: span.to });
    }
    this.spans = merge(pieces.filter((piece) => piece.to > piece.from));
  }

  clear(): void {
    this.spans = [];
  }

  list(): Span[] {
    return this.spans.map((span) => ({ ...span }));
  }
}

function merge(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.from - b.from);
  const merged: Span[] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last && span.from <= last.to) last.to = Math.max(last.to, span.to);
    else merged.push({ ...span });
  }
  return merged;
}
