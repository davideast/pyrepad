/** Author-initiated work: direct requests, insertions and comment placement. */
import { locateQuote } from "./anchor.js";
import type { SuggestionBook } from "./suggestion-book.js";
import type { ProposedEdit, Proposer, Suggestion } from "./types.js";

export interface Window {
  from: number;
  to: number;
}

export interface CommentSink {
  (comment: { quote: string; from: number; text: string; kind: string }): void;
}

export interface DirectContext {
  proposer: Proposer;
  book: SuggestionBook;
  agentId: string;
  text: string;
  instructions: string;
  contextBefore: number;
  contextAfter: number;
  onComment?: CommentSink;
  proposed: (suggestion: Suggestion) => void;
}

/** Places a comment edit; false when `edit` is an ordinary edit. */
export function placeComment(
  ctx: Pick<DirectContext, "text" | "onComment">,
  edit: ProposedEdit,
  window: Window,
): boolean {
  if (edit.type !== "comment") return false;
  const at = locateQuote(ctx.text, edit.find, { window, hint: window.from });
  if (at)
    ctx.onComment?.({
      quote: edit.find,
      from: at.from,
      text: edit.reason,
      kind: edit.kind,
    });
  return true;
}

/** Reviews `range` because the author asked; places every proposed edit. */
export async function askDirect(
  ctx: DirectContext,
  range: Window,
  ask: { request: string; kinds: readonly string[]; signal?: AbortSignal },
): Promise<Suggestion[]> {
  const { request, kinds, signal } = ask;
  const snapshot = ctx.text;
  const window = {
    from: Math.max(0, range.from),
    to: Math.min(snapshot.length, range.to),
  };
  const edits = await ctx.proposer(
    {
      text: snapshot.slice(window.from, window.to),
      before: snapshot.slice(
        Math.max(0, window.from - ctx.contextBefore),
        window.from,
      ),
      after: snapshot.slice(window.to, window.to + ctx.contextAfter),
      instructions: `${ctx.instructions.trim()}\n\nDirect request from the author, which takes priority over the instructions above: ${request}`,
      kinds,
      mode: "both",
    },
    signal,
  );
  const placed: Suggestion[] = [];
  for (const edit of edits) {
    if (placeComment(ctx, edit, window)) continue;
    const suggestion = ctx.book.add(
      { ...edit, agentId: ctx.agentId },
      ctx.text,
      { window, hint: window.from },
    );
    if (suggestion) {
      placed.push(suggestion);
      ctx.proposed(suggestion);
    }
  }
  return placed;
}

/** Proposes `text` as a pure insertion at `at`, even in an empty document. */
export function insertDirect(
  ctx: DirectContext,
  at: number,
  edit: { text: string; reason: string; kind: string },
): Suggestion | null {
  const { text, reason, kind } = edit;
  const doc = ctx.text;
  const pos = Math.min(Math.max(0, at), doc.length);
  const suggestion = ctx.book.add(
    { find: "", replacement: text, reason, kind, agentId: ctx.agentId },
    doc,
    { hint: pos, before: doc.slice(Math.max(0, pos - 40), pos) },
  );
  if (suggestion) ctx.proposed(suggestion);
  return suggestion;
}
