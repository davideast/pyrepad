/**
 * The margin card for one suggestion, laid out like a Docs comment thread:
 * who proposed it with accept / reject icons, the diff and reason, the
 * reviewer's comments so far, and a single reply field at the bottom.
 */
import type { SuggestionAuthor } from "./cm6-suggestions.js";
import type { Suggestion } from "./types.js";

export interface CardHandlers {
  /** Null hides the accept and reject buttons (a reader who may not resolve). */
  accept: (() => void) | null;
  reject: (() => void) | null;
  /** Resolves true once the suggestion was replaced by a revised one. Null hides the reply field. */
  comment: ((text: string) => Promise<boolean>) | null;
}

export interface CardThread {
  /** Who the reviewer's comments are shown as coming from. */
  user: SuggestionAuthor;
  comments: readonly string[];
}

const CHECK = "M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z";
const CLOSE =
  "M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6z";
const SEND = "M3 20v-6l8-2-8-2V4l19 8z";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function iconButton(
  className: string,
  label: string,
  path: string,
  onClick: () => void,
): HTMLButtonElement {
  const b = el("button", className);
  b.type = "button";
  b.title = label;
  b.setAttribute("aria-label", label);
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  const p = document.createElementNS(ns, "path");
  p.setAttribute("d", path);
  svg.append(p);
  b.append(svg);
  b.addEventListener("mousedown", (e) => e.preventDefault());
  b.addEventListener("click", onClick);
  return b;
}

function avatarFor(who: SuggestionAuthor): HTMLElement {
  const avatar = el(
    "span",
    "pad-card-avatar",
    who.name.charAt(0).toUpperCase(),
  );
  avatar.style.background = who.color;
  return avatar;
}

function commentRow(who: SuggestionAuthor, text: string): HTMLElement {
  const row = el("div", "pad-comment");
  const body = el("div", "pad-comment-body");
  body.append(
    el("div", "pad-comment-name", who.name),
    el("div", "pad-comment-text", text),
  );
  row.append(avatarFor(who), body);
  return row;
}

interface ReplyParts {
  card: HTMLElement;
  thread: HTMLElement;
  note: HTMLElement;
  user: SuggestionAuthor;
}

function replyField(
  { card, thread, note, user }: ReplyParts,
  send: (text: string) => Promise<boolean>,
): HTMLElement {
  const form = el("form", "pad-reply");
  const input = el("input", "pad-reply-input");
  input.placeholder = "Reply to Scribe…";
  input.setAttribute("aria-label", "Ask Scribe to change this suggestion");
  const submit = iconButton("pad-reply-send", "Send", SEND, () =>
    form.requestSubmit(),
  );
  form.append(input, submit);
  const sync = () =>
    form.classList.toggle("pad-reply-ready", !!input.value.trim());
  input.addEventListener("input", sync);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") input.blur();
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || card.classList.contains("pad-revising")) return;
    thread.append(commentRow(user, text));
    input.value = "";
    sync();
    note.textContent = "Scribe is revising…";
    card.classList.add("pad-revising");
    void send(text).then((ok) => {
      if (ok) return;
      card.classList.remove("pad-revising");
      note.textContent = "Scribe couldn’t find a better wording.";
    });
  });
  return form;
}

export function buildCard(
  s: Suggestion,
  author: SuggestionAuthor | undefined,
  handlers: CardHandlers,
  thread: CardThread,
): HTMLElement {
  const who = author ?? { name: s.agentId, color: "#5f6368" };
  const card = el("div", "pad-card");
  card.dataset.sug = s.id;
  const anchor = "--card-" + s.id.replace(/[^A-Za-z0-9_-]/g, "_");
  card.dataset.cardName = anchor;
  card.style.setProperty("anchor-name", anchor);

  const head = el("div", "pad-card-head");
  const who$ = el("div", "pad-card-who");
  who$.append(
    el("span", "pad-card-name", who.name),
    el("span", "pad-card-kind", s.kind),
  );
  const actions = el("div", "pad-card-actions");
  if (handlers.accept && handlers.reject) {
    actions.append(
      iconButton("pad-accept", "Accept", CHECK, handlers.accept),
      iconButton("pad-reject", "Reject", CLOSE, handlers.reject),
    );
  }
  head.append(avatarFor(who), who$, actions);

  const diff = el("div", "pad-card-diff");
  diff.append(el("del", "", s.original), " ", el("ins", "", s.replacement));
  const note = el("div", "pad-card-reason", s.reason);
  card.append(head, diff, note);

  const { comment } = handlers;
  if (comment) {
    const comments = el("div", "pad-thread");
    for (const text of thread.comments) {
      comments.append(commentRow(thread.user, text));
    }
    card.append(comments);
    card.append(
      replyField({ card, thread: comments, note, user: thread.user }, comment),
    );
  }
  return card;
}
