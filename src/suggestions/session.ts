/**
 * Connects a SuggestionBook to an editor and to the agentive stream: local
 * suggestions are broadcast, remote ones are placed by quote in this client's
 * own copy of the document, and accept/reject flow back to every client.
 */
import type { AgentivePresenceEvent } from "../adapters/types.js";
import {
  decodeMessage,
  encodeResolved,
  encodeSuggesting,
  type Resolution,
  type SuggestionMessage,
} from "./protocol.js";
import type { SuggestionBook } from "./suggestion-book.js";
import type { Suggestion, TextChange } from "./types.js";

export interface SuggestionHost {
  getText(): string;
  /** Applies the change through the editor so it syncs like any typed edit. */
  applyChange(change: TextChange): void;
}

export interface SuggestionSessionOptions {
  book: SuggestionBook;
  host: SuggestionHost;
  broadcast: (event: AgentivePresenceEvent) => void;
}

const CONTEXT = 40;
const MAX_DEFERRED = 100;

type SuggestingMessage = Extract<SuggestionMessage, { type: "suggesting" }>;

/** What the view needs from a session. */
export interface SessionLike {
  readonly applying: boolean;
  accept(id: string): void;
  reject(id: string): void;
  /** Places suggestions received before their text had loaded. */
  retryDeferred?(): void;
}

export class SuggestionSession implements SessionLike {
  readonly host: SuggestionHost;
  /** True while an accepted suggestion is being applied to the editor. */
  applying = false;
  private readonly book: SuggestionBook;
  private readonly broadcast: (event: AgentivePresenceEvent) => void;
  private ingesting = false;
  private readonly deferred = new Map<string, SuggestingMessage>();

  constructor(options: SuggestionSessionOptions) {
    this.book = options.book;
    this.host = options.host;
    this.broadcast = options.broadcast;
    this.book.on("added", (suggestion) => this.onAdded(suggestion));
  }

  /** Feed every event from the adapter's agentive stream. */
  ingest(event: AgentivePresenceEvent): void {
    const message = decodeMessage(event);
    if (!message) return;
    if (message.type === "resolved") {
      this.deferred.delete(message.id);
      this.book.remove(message.id);
      return;
    }
    if (this.book.get(message.id)) return;
    if (!this.place(message)) this.remember(message);
  }

  /** Tries again to place suggestions that arrived before the document text. */
  retryDeferred(): void {
    for (const [id, message] of this.deferred) {
      if (this.book.get(id) || this.place(message)) this.deferred.delete(id);
    }
  }

  private remember(message: SuggestingMessage): void {
    if (this.deferred.size >= MAX_DEFERRED) {
      this.deferred.delete(this.deferred.keys().next().value!);
    }
    this.deferred.set(message.id, message);
  }

  private place(message: SuggestingMessage): boolean {
    this.ingesting = true;
    try {
      return (
        this.book.add(
          { ...message.edit, id: message.id, agentId: message.agentId },
          this.host.getText(),
          { before: message.before, hint: message.hint },
        ) !== null
      );
    } finally {
      this.ingesting = false;
    }
  }

  accept(id: string): void {
    const suggestion = this.book.get(id);
    const change = this.book.accept(id);
    if (!suggestion || !change) return;
    this.applying = true;
    try {
      this.host.applyChange(change);
    } finally {
      this.applying = false;
    }
    this.resolved(suggestion, "accepted");
  }

  reject(id: string): void {
    const suggestion = this.book.reject(id);
    if (suggestion) this.resolved(suggestion, "rejected");
  }

  /** Rejects every pending suggestion, here and in the shared store, e.g. after the instructions change. */
  rejectAll(): void {
    for (const suggestion of this.book.list()) this.reject(suggestion.id);
    for (const message of this.deferred.values()) {
      this.broadcast(encodeResolved(message.agentId, message.id, "rejected"));
    }
    this.deferred.clear();
  }

  private resolved(suggestion: Suggestion, resolution: Resolution): void {
    this.broadcast(
      encodeResolved(suggestion.agentId, suggestion.id, resolution),
    );
  }

  private onAdded(suggestion: Suggestion): void {
    if (this.ingesting) return;
    const doc = this.host.getText();
    const before = doc.slice(
      Math.max(0, suggestion.from - CONTEXT),
      suggestion.from,
    );
    this.broadcast(encodeSuggesting(suggestion, before));
  }
}
