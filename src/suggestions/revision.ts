/**
 * Asks the proposer to redo one suggestion in light of a reviewer's comment.
 */
import type { ProposedEdit, Proposer, Suggestion } from "./types.js";

export interface RevisionContext {
  proposer: Proposer;
  suggestion: Suggestion;
  comment: string;
  /** The whole document, to cut context from around the suggestion. */
  text: string;
  instructions: string;
  kinds: readonly string[];
  contextBefore: number;
  contextAfter: number;
}

/** A replacement for the suggestion's whole span, or null if the proposer offered none. */
export async function reviseSuggestion(
  ctx: RevisionContext,
): Promise<ProposedEdit | null> {
  const { suggestion: s, text } = ctx;
  const edits = await ctx.proposer({
    text: s.original,
    before: text.slice(Math.max(0, s.from - ctx.contextBefore), s.from),
    after: text.slice(s.to, s.to + ctx.contextAfter),
    instructions: ctx.instructions,
    kinds: ctx.kinds,
    revision: { replacement: s.replacement, comment: ctx.comment },
  });
  const edit = edits.find((e) => e.replacement !== s.replacement) ?? null;
  if (!edit) return null;
  return { ...edit, find: s.original, kind: s.kind };
}
