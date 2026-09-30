/**
 * Shared contracts for the suggestion assistant: text-anchored edit proposals
 * that ride the agentive stream and never write to the document until accepted.
 */

/** One replaced span in old-document coordinates (`from <= to`). */
export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

export type SuggestionStatus = "pending" | "accepted" | "rejected" | "stale";

export interface Suggestion {
  id: string;
  agentId: string;
  /** Free-form label the proposer chose, e.g. "typo" or "tone". */
  kind: string;
  reason: string;
  /** Current span in this client's document; kept up to date as text changes. */
  from: number;
  to: number;
  /** The text that occupied `from..to` when the suggestion was placed. */
  original: string;
  replacement: string;
  status: SuggestionStatus;
}

/** What the proposer is asked to review. `before`/`after` are read-only context. */
export interface ProposeRequest {
  text: string;
  before: string;
  after: string;
  /** The user's free-text instruction for this session. */
  instructions: string;
  /** Kind labels the proposer may use; others are dropped by the caller. */
  kinds: readonly string[];
  /** Set when `text` is the span of an earlier suggestion that a reviewer commented on. */
  revision?: { replacement: string; comment: string };
}

/** An edit expressed as an exact quote of `text` plus its replacement. */
export interface ProposedEdit {
  find: string;
  replacement: string;
  reason: string;
  kind: string;
}

export type Proposer = (
  request: ProposeRequest,
  signal?: AbortSignal,
) => Promise<ProposedEdit[]>;
