/** Public shapes of the suggestion analyzer. */
import type { SuggestionBook } from "./suggestion-book.js";
import type { CommentSink } from "./direct.js";
import type {
  ResponseMode,
  Proposer,
  Suggestion,
  TextChange,
} from "./types.js";

export interface AnalyzerOptions {
  proposer: Proposer;
  book: SuggestionBook;
  agentId?: string;
  getInstructions: () => string;
  getKinds: () => readonly string[];
  /** Default "suggest". Direct requests via `ask` always allow both. */
  getMode?: () => ResponseMode;
  /** A remark on `from..to`, produced instead of an edit. */
  onComment?: CommentSink;
  minChars?: number;
  maxChars?: number;
  maxInFlight?: number;
  /** Minimum time between two requests. */
  minGapMs?: number;
  contextBefore?: number;
  contextAfter?: number;
  /** After this many ms without edits the sentence under the cursor is reviewed too. */
  idleMs?: number;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => () => void;
}

export interface DocumentUpdate {
  text: string;
  /** Changes that produced `text`, in old-document coordinates. */
  changes: readonly TextChange[];
  cursor: number;
  /** The changes were the assistant's own accepted suggestion: don't re-review them. */
  fromAssistant?: boolean;
}

export interface InflightChunk {
  id: string;
  from: number;
  to: number;
}

export type AnalyzerEvents = {
  change: [];
  /** A chunk went out for review. */
  dispatched: [chunk: InflightChunk & { text: string }];
  /** A suggestion this analyzer produced was placed in the book. */
  proposed: [suggestion: Suggestion];
  error: [error: unknown];
};
