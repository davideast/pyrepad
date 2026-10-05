import {
  RangeSetBuilder,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

export interface CommentAnchor {
  id: string;
  quote: string;
  from: number;
  resolved: boolean;
}

export const setAnchors = StateEffect.define<CommentAnchor[]>();
export const setActive = StateEffect.define<string | null>();

interface Found {
  id: string;
  from: number;
  to: number;
}

interface HighlightState {
  anchors: CommentAnchor[];
  active: string | null;
  found: Found[];
  deco: DecorationSet;
}

/** The occurrence of the quote nearest to where it was first commented on. */
function locate(text: string, anchor: CommentAnchor): Found | null {
  if (!anchor.quote) return null;
  let best = -1;
  for (
    let at = text.indexOf(anchor.quote);
    at !== -1;
    at = text.indexOf(anchor.quote, at + 1)
  ) {
    if (
      best === -1 ||
      Math.abs(at - anchor.from) < Math.abs(best - anchor.from)
    )
      best = at;
  }
  return best === -1
    ? null
    : { id: anchor.id, from: best, to: best + anchor.quote.length };
}

function build(
  state: EditorState,
  anchors: CommentAnchor[],
  active: string | null,
): Pick<HighlightState, "found" | "deco"> {
  const text = state.doc.toString();
  const found = anchors.flatMap((a) => locate(text, a) ?? []);
  const shown = found
    .filter((f) => anchors.find((a) => a.id === f.id && !a.resolved))
    .sort((a, b) => a.from - b.from || a.to - b.to);
  const builder = new RangeSetBuilder<Decoration>();
  for (const f of shown) {
    builder.add(
      f.from,
      f.to,
      Decoration.mark({
        class:
          f.id === active ? "sg-comment-hl sg-comment-active" : "sg-comment-hl",
        attributes: { "data-cid": f.id },
      }),
    );
  }
  return { found, deco: builder.finish() };
}

const field = StateField.define<HighlightState>({
  create: () => ({
    anchors: [],
    active: null,
    found: [],
    deco: Decoration.none,
  }),
  update(value, tr) {
    let { anchors, active } = value;
    let changed = tr.docChanged;
    for (const e of tr.effects) {
      if (e.is(setAnchors)) {
        anchors = e.value;
        changed = true;
      }
      if (e.is(setActive)) {
        active = e.value;
        changed = true;
      }
    }
    if (!changed) return value;
    return { anchors, active, ...build(tr.state, anchors, active) };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

export function commentRange(
  state: EditorState,
  id: string,
): { from: number; to: number } | null {
  return state.field(field).found.find((f) => f.id === id) ?? null;
}

export function commentHighlights(onPick: (id: string) => void): Extension {
  return [
    field,
    EditorView.domEventHandlers({
      click(event) {
        const id = (event.target as HTMLElement)
          .closest?.("[data-cid]")
          ?.getAttribute("data-cid");
        if (id) onPick(id);
      },
    }),
  ];
}
