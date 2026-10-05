/**
 * CodeMirror 6 view for the suggestion assistant: shimmer over text under
 * review, strikethrough plus inserted text for each pending suggestion, and
 * one card per suggestion in a margin element. Each card is tied to a
 * zero-width anchor at its suggestion with CSS anchor positioning
 * (`position-anchor`), so it rides alongside the text as the editor scrolls.
 * Without support for it the cards stack as a plain list.
 */
import { StateEffect, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { SuggestionAnalyzer } from "./analyzer.js";
import { buildCard } from "./suggestion-card.js";
import type { SessionLike, SuggestionHost } from "./session.js";
import type { SuggestionBook } from "./suggestion-book.js";
import type { Suggestion, TextChange } from "./types.js";

export interface SuggestionAuthor {
  name: string;
  color: string;
}

export interface SuggestionViewOptions {
  /** Who a suggestion is shown as coming from; defaults to the agent id. */
  author?: (agentId: string) => SuggestionAuthor;
  /** Who the reviewer's card comments are shown as; defaults to "You". */
  user?: SuggestionAuthor;
  book: SuggestionBook;
  session: SessionLike;
  /** False hides accept and reject on the cards. Defaults to true. */
  canResolve?: boolean;
  /** Only the client that runs the assistant passes one. */
  analyzer?: SuggestionAnalyzer | null;
  /**
   * Element the cards render into. Their containing block must also contain
   * the editor (CSS anchor positioning requires it), e.g. a positioned wrapper
   * around both.
   */
  margin: HTMLElement;
}

/** Local transactions: synced via OT, undoable as `input.accept`. */
export function cm6SuggestionHost(view: EditorView): SuggestionHost {
  return {
    getText: () => view.state.doc.toString(),
    applyChange: (c) =>
      view.dispatch({ changes: c, userEvent: "input.accept" }),
  };
}

const refresh = StateEffect.define<null>();

const anchorName = (id: string): string =>
  "--sug-" + id.replace(/[^A-Za-z0-9_-]/g, "_");

class AnchorWidget extends WidgetType {
  constructor(readonly id: string) {
    super();
  }
  eq(other: AnchorWidget): boolean {
    return other.id === this.id;
  }
  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "pad-sug-anchor";
    el.dataset.sug = this.id;
    el.style.setProperty("anchor-name", anchorName(this.id));
    return el;
  }
}

class InsertWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: InsertWidget): boolean {
    return other.text === this.text;
  }
  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "pad-sug-ins";
    el.textContent = this.text;
    return el;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

function toTextChanges(update: ViewUpdate): TextChange[] {
  const out: TextChange[] = [];
  update.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    out.push({
      from: fromA,
      to: toA,
      insert: update.state.doc.sliceString(fromB, toB),
    });
  });
  return out;
}

const supportsAnchors = (): boolean =>
  typeof CSS !== "undefined" &&
  typeof CSS.supports === "function" &&
  CSS.supports("anchor-name: --a");

class SuggestionPlugin {
  private readonly book: SuggestionBook;
  private readonly analyzer: SuggestionAnalyzer | null;
  private readonly canResolve: boolean;
  private readonly session: SessionLike;
  private readonly author: SuggestionViewOptions["author"];
  private readonly user: SuggestionAuthor;
  private readonly threads = new Map<string, string[]>();
  private readonly margin: HTMLElement;
  decorations: DecorationSet = Decoration.none;
  private inUpdate = false;
  private dirty = false;
  private readonly cards = new Map<string, HTMLElement>();
  private readonly stop: Array<() => void> = [];

  constructor(
    private readonly view: EditorView,
    options: SuggestionViewOptions,
  ) {
    const { book, analyzer, margin } = options;
    this.book = book;
    this.analyzer = analyzer ?? null;
    this.session = options.session;
    this.canResolve = options.canResolve !== false;
    this.author = options.author;
    this.user = options.user ?? { name: "You", color: "#1a73e8" };
    this.margin = margin;
    const poke = () => this.poke();
    book.on("change", poke);
    this.stop.push(() => book.off("change", poke));
    if (analyzer) {
      analyzer.on("change", poke);
      this.stop.push(() => analyzer.off("change", poke));
      analyzer.update({
        text: view.state.doc.toString(),
        changes: [],
        cursor: view.state.selection.main.head,
      });
    }
    margin.classList.toggle("pad-anchored", supportsAnchors());
    this.build();
  }

  update(u: ViewUpdate): void {
    this.inUpdate = true;
    try {
      if (u.docChanged || u.selectionSet) {
        const changes = u.docChanged ? toTextChanges(u) : [];
        if (u.docChanged) {
          this.book.applyChanges(changes);
          this.session.retryDeferred?.();
        }
        this.analyzer?.update({
          text: u.state.doc.toString(),
          changes,
          cursor: u.state.selection.main.head,
          fromAssistant: u.docChanged && this.session.applying,
        });
      }
    } finally {
      this.inUpdate = false;
      this.dirty = false;
    }
    this.build();
  }

  destroy(): void {
    for (const stop of this.stop) stop();
    for (const card of this.cards.values()) card.remove();
    this.cards.clear();
    this.view.dom.classList.remove("pad-analyzing-active");
  }

  private poke(): void {
    if (this.inUpdate) {
      this.dirty = true;
      return;
    }
    queueMicrotask(() => {
      if (this.view.dom.isConnected) {
        this.view.dispatch({ effects: refresh.of(null) });
      }
    });
  }

  private build(): void {
    const doc = this.view.state.doc;
    const ranges = [];
    const spans = this.analyzer?.inflight() ?? [];
    for (const span of spans) {
      const from = Math.min(span.from, doc.length);
      const to = Math.min(span.to, doc.length);
      if (to > from) {
        ranges.push(
          Decoration.mark({ class: "pad-analyzing" }).range(from, to),
        );
      }
    }
    const pending = this.book.list();
    for (const s of pending) {
      if (s.to > s.from) {
        ranges.push(
          Decoration.mark({ class: "pad-sug-del" }).range(s.from, s.to),
        );
      }
      if (s.replacement) {
        ranges.push(
          Decoration.widget({
            widget: new InsertWidget(s.replacement),
            side: 1,
          }).range(s.to),
        );
      }
      ranges.push(
        Decoration.widget({
          widget: new AnchorWidget(s.id),
          side: -1,
        }).range(s.from),
      );
    }
    this.decorations = Decoration.set(ranges, true);
    this.view.dom.classList.toggle("pad-analyzing-active", spans.length > 0);
    this.renderCards(pending);
  }

  private renderCards(pending: Suggestion[]): void {
    const live = new Set(pending.map((s) => s.id));
    for (const [id, card] of this.cards) {
      if (!live.has(id)) {
        card.remove();
        this.cards.delete(id);
      }
    }
    let prev: HTMLElement | null = null;
    for (const s of pending) {
      let card = this.cards.get(s.id);
      if (!card) {
        card = this.createCard(s);
        this.cards.set(s.id, card);
      }
      card.style.setProperty("position-anchor", anchorName(s.id));
      card.style.setProperty("--card-prev", prev?.dataset.cardName ?? "--none");
      if (card.parentElement !== this.margin || card.previousSibling !== prev) {
        this.margin.insertBefore(
          card,
          prev ? prev.nextSibling : this.margin.firstChild,
        );
      }
      prev = card;
    }
    this.view.requestMeasure({
      read: () => {
        const visible = new Set<string>();
        for (const el of this.view.contentDOM.querySelectorAll<HTMLElement>(
          ".pad-sug-anchor",
        )) {
          if (el.dataset.sug) visible.add(el.dataset.sug);
        }
        return visible;
      },
      write: (visible) => {
        for (const [id, card] of this.cards) {
          card.hidden = this.margin.classList.contains("pad-anchored")
            ? !visible.has(id)
            : false;
        }
      },
    });
  }

  private createCard(s: Suggestion): HTMLElement {
    const analyzer = this.analyzer;
    const comments = this.threads.get(s.id) ?? [];
    return buildCard(
      s,
      this.author?.(s.agentId),
      {
        accept: this.canResolve ? () => this.session.accept(s.id) : null,
        reject: this.canResolve ? () => this.session.reject(s.id) : null,
        comment: analyzer ? (text) => this.revise(analyzer, s.id, text) : null,
      },
      { user: this.user, comments },
    );
  }

  /** Replaces a suggestion with one revised to address `comment`, keeping its thread. */
  private async revise(
    analyzer: SuggestionAnalyzer,
    id: string,
    comment: string,
  ): Promise<boolean> {
    const thread = [...(this.threads.get(id) ?? []), comment];
    this.threads.set(id, thread);
    const before = this.book.get(id);
    if (!before) return false;
    const edit = await analyzer.revise(before, comment).catch(() => null);
    const now = this.book.get(id);
    if (!edit || !now) return false;
    this.session.reject(id);
    const text = this.view.state.doc.toString();
    const window = { from: now.from, to: now.to };
    const added = this.book.add({ ...edit, agentId: now.agentId }, text, {
      window,
      hint: now.from,
    });
    if (added) this.threads.set(added.id, thread);
    this.threads.delete(id);
    return added !== null;
  }
}

export function suggestionExtension(options: SuggestionViewOptions): Extension {
  return ViewPlugin.define((view) => new SuggestionPlugin(view, options), {
    decorations: (v) => v.decorations,
  });
}
