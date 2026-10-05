/**
 * Text anchoring. Suggestions travel between clients as an exact quote plus a
 * little surrounding context, so each client can find the span in its own copy
 * of the document without sharing revision numbers.
 */

export interface QuoteHint {
  /** Text expected immediately before the quote. */
  before?: string;
  /** Approximate position of the quote; breaks ties between equal candidates. */
  hint?: number;
  /** Only search inside this window. */
  window?: { from: number; to: number };
}

export interface Located {
  from: number;
  to: number;
}

/** Finds `find` in `doc`, preferring a context match, then the occurrence nearest `hint`. */
export function locateQuote(
  doc: string,
  find: string,
  options: QuoteHint = {},
): Located | null {
  if (find.length === 0) return null;
  const windowFrom = Math.max(0, options.window?.from ?? 0);
  const windowTo = Math.min(doc.length, options.window?.to ?? doc.length);
  const before = options.before ?? "";
  const hint = options.hint ?? 0;

  let best: { from: number; contextMatch: boolean; distance: number } | null =
    null;
  let at = doc.indexOf(find, windowFrom);
  while (at !== -1 && at + find.length <= windowTo) {
    const contextMatch =
      before.length === 0 ||
      doc.slice(Math.max(0, at - before.length), at) === before;
    const distance = Math.abs(at - hint);
    const better =
      best === null ||
      (contextMatch && !best.contextMatch) ||
      (contextMatch === best.contextMatch && distance < best.distance);
    if (better) best = { from: at, contextMatch, distance };
    at = doc.indexOf(find, at + 1);
  }
  return best ? { from: best.from, to: best.from + find.length } : null;
}

/** Where a pure insertion goes: right after `before` (nearest `hint`), else at `hint`. */
export function locateInsertion(doc: string, options: QuoteHint = {}): number {
  const hint = Math.min(Math.max(0, options.hint ?? 0), doc.length);
  const before = options.before ?? "";
  if (before.length === 0) return hint;
  let best = -1;
  for (
    let at = doc.indexOf(before);
    at !== -1;
    at = doc.indexOf(before, at + 1)
  ) {
    const end = at + before.length;
    if (best === -1 || Math.abs(end - hint) < Math.abs(best - hint)) best = end;
  }
  return best === -1 ? hint : best;
}
