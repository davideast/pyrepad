/**
 * The pending suggestions for one document. Each suggestion is a tracked span
 * plus a replacement; as the text changes underneath (local typing or remote
 * operations) the span is rebased, and an edit inside the span retires it.
 * Nothing here writes to the document: `accept` only reports the change to apply.
 */
import { Emitter } from "../core/emitter.js";
import { locateQuote, type QuoteHint } from "./anchor.js";
import { mapRange } from "./range-map.js";
import type { ProposedEdit, Suggestion, TextChange } from "./types.js";

export type BookEvents = {
  change: [];
  added: [suggestion: Suggestion];
  removed: [suggestion: Suggestion];
};

export interface NewSuggestion extends ProposedEdit {
  agentId: string;
  id?: string;
}

const isSpace = (ch: string | undefined): boolean =>
  ch === undefined || /\s/.test(ch);

/** Narrows a quote/replacement pair to the words that actually differ. */
function trimToChange(find: string, replacement: string) {
  let head = 0;
  const max = Math.min(find.length, replacement.length);
  while (head < max && find[head] === replacement[head]) head++;
  while (head > 0 && !isSpace(find[head - 1])) head--;
  let tail = 0;
  const room = max - head;
  while (
    tail < room &&
    find[find.length - 1 - tail] === replacement[replacement.length - 1 - tail]
  ) {
    tail++;
  }
  while (tail > 0 && !isSpace(find[find.length - tail])) tail--;
  const original = find.slice(head, find.length - tail);
  const next = replacement.slice(head, replacement.length - tail);
  return original === "" ? null : { head, tail, original, next };
}

export class SuggestionBook extends Emitter<BookEvents> {
  private readonly pending = new Map<string, Suggestion>();
  private counter = 0;

  /**
   * Places `edit` by locating its quote in `doc`. Returns null when the quote
   * is gone, when it overlaps a pending suggestion, or when it changes nothing.
   * Re-adding an id that is already pending returns the existing suggestion.
   */
  add(
    edit: NewSuggestion,
    doc: string,
    hint: QuoteHint = {},
  ): Suggestion | null {
    if (edit.id !== undefined) {
      const existing = this.pending.get(edit.id);
      if (existing) return existing;
    }
    if (edit.find === edit.replacement) return null;
    const at = locateQuote(doc, edit.find, hint);
    if (!at) return null;
    const trimmed = trimToChange(edit.find, edit.replacement);
    const span = trimmed
      ? { from: at.from + trimmed.head, to: at.to - trimmed.tail }
      : at;
    if (this.overlaps(span.from, span.to)) return null;

    const suggestion: Suggestion = {
      id:
        edit.id ??
        `s${++this.counter}-${Math.random().toString(36).slice(2, 7)}`,
      agentId: edit.agentId,
      kind: edit.kind,
      reason: edit.reason,
      from: span.from,
      to: span.to,
      original: trimmed ? trimmed.original : edit.find,
      replacement: trimmed ? trimmed.next : edit.replacement,
      status: "pending",
    };
    this.pending.set(suggestion.id, suggestion);
    this.trigger("added", suggestion);
    this.trigger("change");
    return suggestion;
  }

  /** Rebases every pending suggestion through one transaction's changes. */
  applyChanges(changes: readonly TextChange[]): void {
    if (changes.length === 0 || this.pending.size === 0) return;
    const retired: Suggestion[] = [];
    for (const suggestion of this.pending.values()) {
      const mapped = mapRange(suggestion.from, suggestion.to, changes);
      if (mapped.touched || mapped.to < mapped.from) {
        suggestion.status = "stale";
        retired.push(suggestion);
        continue;
      }
      suggestion.from = mapped.from;
      suggestion.to = mapped.to;
    }
    for (const suggestion of retired) this.pending.delete(suggestion.id);
    for (const suggestion of retired) this.trigger("removed", suggestion);
    this.trigger("change");
  }

  /** The change that applies the suggestion, or null if it is not pending. */
  accept(id: string): TextChange | null {
    const suggestion = this.pending.get(id);
    if (!suggestion) return null;
    suggestion.status = "accepted";
    this.pending.delete(id);
    this.trigger("removed", suggestion);
    this.trigger("change");
    return {
      from: suggestion.from,
      to: suggestion.to,
      insert: suggestion.replacement,
    };
  }

  reject(id: string): Suggestion | null {
    return this.retire(id, "rejected");
  }

  /** Drops a suggestion without judging it, e.g. one resolved on another client. */
  remove(id: string): Suggestion | null {
    return this.retire(id, "stale");
  }

  clear(): void {
    if (this.pending.size === 0) return;
    const all = [...this.pending.values()];
    this.pending.clear();
    for (const suggestion of all) {
      suggestion.status = "stale";
      this.trigger("removed", suggestion);
    }
    this.trigger("change");
  }

  get(id: string): Suggestion | undefined {
    return this.pending.get(id);
  }

  /** Pending suggestions in document order. */
  list(): Suggestion[] {
    return [...this.pending.values()].sort((a, b) => a.from - b.from);
  }

  private retire(id: string, status: "rejected" | "stale"): Suggestion | null {
    const suggestion = this.pending.get(id);
    if (!suggestion) return null;
    suggestion.status = status;
    this.pending.delete(id);
    this.trigger("removed", suggestion);
    this.trigger("change");
    return suggestion;
  }

  private overlaps(from: number, to: number): boolean {
    for (const other of this.pending.values()) {
      if (from < other.to && to > other.from) return true;
    }
    return false;
  }
}
