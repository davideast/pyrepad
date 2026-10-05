/**
 * Watches a document as it is typed and asks a proposer to review finished
 * text. Typing never waits on it: requests run in the background, and their
 * results are placed by quote against whatever the text has become.
 */
import { Emitter } from "../core/emitter.js";
import { pickChunk } from "./chunker.js";
import { Coverage } from "./coverage.js";
import {
  askDirect,
  insertDirect,
  placeComment,
  type CommentSink,
  type DirectContext,
} from "./direct.js";
import { mapPos } from "./range-map.js";
import { reviseSuggestion } from "./revision.js";
import type {
  AnalyzerEvents,
  AnalyzerOptions,
  DocumentUpdate,
  InflightChunk,
} from "./analyzer-types.js";

export type * from "./analyzer-types.js";
import type {
  ProposedEdit,
  ResponseMode,
  Proposer,
  Suggestion,
  TextChange,
} from "./types.js";

interface Running extends InflightChunk {
  controller: AbortController;
  generation: number;
}

const RETRY_AFTER_ERROR_MS = 3000;

export class SuggestionAnalyzer extends Emitter<AnalyzerEvents> {
  readonly agentId: string;
  private readonly coverage = new Coverage();
  private readonly running = new Map<string, Running>();
  private text = "";
  private cursor = 0;
  private settled = false;
  private backoffUntil = 0;
  private cancelIdle: (() => void) | null = null;
  private enabled = true;
  private generation = 0;
  private lastDispatch = -Infinity;
  private cancelTimer: (() => void) | null = null;
  private counter = 0;
  private readonly opts: Required<
    Pick<
      AnalyzerOptions,
      | "minChars"
      | "maxChars"
      | "maxInFlight"
      | "minGapMs"
      | "contextBefore"
      | "contextAfter"
    >
  > &
    AnalyzerOptions;

  constructor(options: AnalyzerOptions) {
    super();
    this.agentId = options.agentId ?? "assistant";
    this.opts = {
      minChars: 40,
      maxChars: 600,
      maxInFlight: 2,
      minGapMs: 300,
      contextBefore: 300,
      contextAfter: 150,
      ...options,
    };
  }

  /** Feed every document update, including cursor-only ones (empty `changes`). */
  update(update: DocumentUpdate): void {
    this.text = update.text;
    this.cursor = update.cursor;
    this.armIdle();
    if (update.changes.length > 0) {
      this.coverage.applyChanges(update.changes, update.fromAssistant === true);
      for (const chunk of this.running.values()) {
        chunk.from = mapPos(chunk.from, update.changes, 1);
        chunk.to = mapPos(chunk.to, update.changes, -1);
      }
      this.trigger("change");
    }
    this.pump();
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (enabled) this.pump();
    else this.abortAll();
    this.trigger("change");
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Forget what was reviewed and review everything again (e.g. new instructions). */
  reset(): void {
    this.abortAll();
    this.coverage.clear();
    this.trigger("change");
    this.pump();
  }

  /** The text of every reviewed span, so a later session can skip it. */
  reviewedText(): string[] {
    return this.coverage
      .list()
      .map((span) => this.text.slice(span.from, span.to));
  }

  /** Marks each fragment, where it occurs in the current text, as already reviewed. */
  restoreReviewed(fragments: readonly string[]): void {
    for (const fragment of fragments) {
      const at = fragment ? this.text.indexOf(fragment) : -1;
      if (at >= 0) this.coverage.add(at, at + fragment.length);
    }
    this.trigger("change");
  }

  /** A revised edit for `suggestion` that addresses a reviewer's comment. */
  revise(
    suggestion: Suggestion,
    comment: string,
  ): Promise<ProposedEdit | null> {
    return reviseSuggestion({
      proposer: this.opts.proposer,
      suggestion,
      comment,
      text: this.text,
      instructions: this.opts.getInstructions(),
      kinds: this.opts.getKinds(),
      contextBefore: this.opts.contextBefore,
      contextAfter: this.opts.contextAfter,
    });
  }

  /** Reviews `range` right now because the author asked, whatever was reviewed before. */
  async ask(
    range: { from: number; to: number },
    request: string,
    kinds: readonly string[],
    signal?: AbortSignal,
  ): Promise<Suggestion[]> {
    const placed = await askDirect(this.direct(), range, {
      request,
      kinds,
      signal,
    });
    this.trigger("change");
    return placed;
  }

  /** Proposes `text` as a pure insertion at `at`, even in an empty document. */
  insert(
    at: number,
    text: string,
    reason: string,
    kind: string,
  ): Suggestion | null {
    const suggestion = insertDirect(this.direct(), at, { text, reason, kind });
    this.trigger("change");
    return suggestion;
  }

  private direct(): DirectContext {
    return {
      proposer: this.opts.proposer,
      book: this.opts.book,
      agentId: this.agentId,
      text: this.text,
      instructions: this.opts.getInstructions(),
      contextBefore: this.opts.contextBefore,
      contextAfter: this.opts.contextAfter,
      onComment: this.opts.onComment,
      proposed: (suggestion) => this.trigger("proposed", suggestion),
    };
  }

  /** Spans currently out for review, tracked through edits. */
  inflight(): InflightChunk[] {
    return [...this.running.values()].map(({ id, from, to }) => ({
      id,
      from,
      to,
    }));
  }

  dispose(): void {
    this.cancelIdle?.();
    this.abortAll();
    this.off();
  }

  private abortAll(): void {
    this.generation++;
    this.cancelTimer?.();
    this.cancelTimer = null;
    for (const chunk of this.running.values()) {
      chunk.controller.abort();
      this.coverage.remove(chunk.from, chunk.to);
    }
    this.running.clear();
  }

  private readonly schedule = (fn: () => void, ms: number): (() => void) => {
    if (this.opts.schedule) return this.opts.schedule(fn, ms);
    const handle = setTimeout(fn, ms);
    return () => clearTimeout(handle);
  };

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  private pump(): void {
    if (!this.enabled) return;
    while (this.running.size < this.opts.maxInFlight) {
      const chunk = pickChunk(
        this.text,
        this.coverage,
        this.settled ? -1 : this.cursor,
        this.opts,
      );
      if (!chunk) return;
      const wait =
        Math.max(this.lastDispatch + this.opts.minGapMs, this.backoffUntil) -
        this.now();
      if (wait > 0) {
        this.armTimer(wait);
        return;
      }
      this.dispatch(chunk.from, chunk.to);
    }
  }

  private armIdle(): void {
    this.cancelIdle?.();
    this.settled = false;
    this.cancelIdle = this.schedule(() => {
      this.cancelIdle = null;
      this.settled = true;
      this.pump();
    }, this.opts.idleMs ?? 1200);
  }

  private armTimer(ms: number): void {
    if (this.cancelTimer) return;
    this.cancelTimer = this.schedule(() => {
      this.cancelTimer = null;
      this.pump();
    }, ms);
  }

  private dispatch(from: number, to: number): void {
    const id = `${this.agentId}-${++this.counter}`;
    const controller = new AbortController();
    const running: Running = {
      id,
      from,
      to,
      controller,
      generation: this.generation,
    };
    this.running.set(id, running);
    this.coverage.add(from, to);
    this.lastDispatch = this.now();

    const text = this.text.slice(from, to);
    this.trigger("dispatched", { id, from, to, text });
    this.trigger("change");

    const request = {
      text,
      before: this.text.slice(
        Math.max(0, from - this.opts.contextBefore),
        from,
      ),
      after: this.text.slice(to, to + this.opts.contextAfter),
      instructions: this.opts.getInstructions(),
      kinds: this.opts.getKinds(),
      mode: this.opts.getMode?.() ?? "suggest",
    };
    this.opts.proposer(request, controller.signal).then(
      (edits) => this.settle(running, edits),
      (error) => this.fail(running, error),
    );
  }

  private settle(running: Running, edits: ProposedEdit[]): void {
    if (running.generation !== this.generation) return;
    this.running.delete(running.id);
    const window = { from: running.from, to: running.to };
    const kinds = this.opts.getKinds();
    for (const edit of edits) {
      if (placeComment({ ...this.opts, text: this.text }, edit, window))
        continue;
      if (kinds.length > 0 && !kinds.includes(edit.kind)) continue;
      const placed = this.opts.book.add(
        { ...edit, agentId: this.agentId },
        this.text,
        { window, hint: window.from },
      );
      if (placed) this.trigger("proposed", placed);
    }
    this.trigger("change");
    this.pump();
  }

  private fail(running: Running, error: unknown): void {
    if (running.generation !== this.generation) return;
    this.running.delete(running.id);
    this.coverage.remove(running.from, running.to);
    this.backoffUntil = this.now() + RETRY_AFTER_ERROR_MS;
    this.trigger("error", error);
    this.trigger("change");
    this.pump();
  }
}
