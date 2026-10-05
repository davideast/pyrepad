import {
  EditorSelection,
  EditorState,
  Prec,
  StateEffect,
  type Extension,
  type Range,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import type { Text } from "@codemirror/state";
import { classHighlighter, highlightTree } from "@lezer/highlight";

/** Languages offered in a code block's selector; any other name still highlights if known. */
export const CODE_LANGUAGES: { id: string; label: string }[] = [
  { id: "", label: "Plain text" },
  { id: "js", label: "JavaScript" },
  { id: "ts", label: "TypeScript" },
  { id: "jsx", label: "JSX" },
  { id: "tsx", label: "TSX" },
  { id: "python", label: "Python" },
  { id: "json", label: "JSON" },
  { id: "html", label: "HTML" },
  { id: "css", label: "CSS" },
  { id: "sql", label: "SQL" },
  { id: "bash", label: "Shell" },
  { id: "go", label: "Go" },
  { id: "rust", label: "Rust" },
  { id: "java", label: "Java" },
  { id: "c", label: "C" },
  { id: "cpp", label: "C++" },
  { id: "csharp", label: "C#" },
  { id: "php", label: "PHP" },
  { id: "ruby", label: "Ruby" },
  { id: "swift", label: "Swift" },
  { id: "kotlin", label: "Kotlin" },
  { id: "yaml", label: "YAML" },
  { id: "xml", label: "XML" },
  { id: "markdown", label: "Markdown" },
  { id: "diff", label: "Diff" },
];

const FENCE = /^\s*```\s*([\w+#.-]*)\s*$/;
const CLOSE = /^\s*```\s*$/;
const HEADING = /^(#{1,6})[ \t]+/;

export type BlockType = "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "code";

export interface CodeBlock {
  open: number;
  close: number | null;
  lang: string;
  infoFrom: number;
  infoTo: number;
}

/** Fenced blocks in document order; an unclosed block runs to the end. */
export function scanBlocks(doc: Text): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  let cur: CodeBlock | null = null;
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (cur) {
      if (CLOSE.test(line.text)) {
        cur.close = n;
        blocks.push(cur);
        cur = null;
      }
      continue;
    }
    const m = FENCE.exec(line.text);
    if (!m) continue;
    const after = line.from + line.text.indexOf("```") + 3;
    const ws = /^\s*/.exec(line.text.slice(after - line.from))![0].length;
    cur = {
      open: n,
      close: null,
      lang: m[1],
      infoFrom: after + ws,
      infoTo: after + ws + m[1].length,
    };
  }
  if (cur) blocks.push(cur);
  return blocks;
}
const langLoaded = StateEffect.define<null>();
const descriptions = new Map<string, LanguageDescription | null>();
const loading = new Set<LanguageDescription>();

function describe(id: string): LanguageDescription | null {
  if (!id) return null;
  const key = id.toLowerCase();
  if (!descriptions.has(key))
    descriptions.set(
      key,
      LanguageDescription.matchLanguageName(languages, key, true),
    );
  return descriptions.get(key) ?? null;
}

class LanguagePicker extends WidgetType {
  constructor(
    readonly lang: string,
    readonly from: number,
    readonly to: number,
    readonly canPick: boolean,
  ) {
    super();
  }
  eq(o: LanguagePicker): boolean {
    return (
      o.lang === this.lang &&
      o.from === this.from &&
      o.to === this.to &&
      o.canPick === this.canPick
    );
  }
  toDOM(view: EditorView): HTMLElement {
    const select = document.createElement("select");
    select.className = "cm-md-lang";
    select.setAttribute("aria-label", "Code language");
    select.disabled = !this.canPick;
    const known = CODE_LANGUAGES.some((l) => l.id === this.lang);
    const options = known
      ? CODE_LANGUAGES
      : [...CODE_LANGUAGES, { id: this.lang, label: this.lang }];
    for (const l of options) {
      const o = document.createElement("option");
      o.value = l.id;
      o.textContent = l.label;
      select.append(o);
    }
    select.value = this.lang;
    select.addEventListener("change", () => {
      view.dispatch({
        changes: { from: this.from, to: this.to, insert: select.value },
        userEvent: "input",
      });
    });
    return select;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

function touches(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}

/** Bold, italic and code within one line, with the markers hidden away from the cursor. */
function inline(
  state: EditorState,
  text: string,
  offset: number,
  out: Range<Decoration>[],
): void {
  const taken: [number, number][] = [];
  const free = (a: number, b: number) =>
    !taken.some(([x, y]) => a < y && b > x);
  const apply = (re: RegExp, cls: string, mark: number) => {
    for (const m of text.matchAll(re)) {
      const a = m.index!;
      const b = a + m[0].length;
      if (!free(a, b)) continue;
      taken.push([a, b]);
      const from = offset + a;
      const to = offset + b;
      const hide = touches(state, from, to)
        ? Decoration.mark({ class: "cm-md-mark" })
        : Decoration.replace({});
      out.push(hide.range(from, from + mark), hide.range(to - mark, to));
      out.push(Decoration.mark({ class: cls }).range(from + mark, to - mark));
    }
  };
  apply(/`[^`\n]+`/g, "cm-md-code", 1);
  apply(/\*\*[^*\n]+\*\*/g, "cm-md-bold", 2);
  apply(/(?<![*\w])\*[^*\s][^*\n]*\*(?![*\w])/g, "cm-md-italic", 1);
  apply(/(?<![_\w])_[^_\s][^_\n]*_(?![_\w])/g, "cm-md-italic", 1);
}

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const doc = state.doc;
  const out: Range<Decoration>[] = [];
  const blocks = scanBlocks(doc);
  const inBlock = new Set<number>();

  for (const block of blocks) {
    const endLine = block.close ?? doc.lines;
    const closed = block.close !== null;
    const first = doc.line(block.open);
    const last = doc.line(endLine);
    const rawOpen = touches(state, first.from, first.to);
    const rawClose = closed && touches(state, last.from, last.to);
    for (let n = block.open; n <= endLine; n++) {
      inBlock.add(n);
      const l = doc.line(n);
      const isOpen = n === block.open;
      const isClose = closed && n === endLine;
      const cls = [
        "cm-md-codeline",
        isOpen ? "cm-md-first" : "",
        n === endLine ? "cm-md-last" : "",
        isOpen && !rawOpen ? "cm-md-head" : "",
        isClose && !rawClose ? "cm-md-foot" : "",
        (isOpen && rawOpen) || (isClose && rawClose) ? "cm-md-fence" : "",
      ]
        .filter(Boolean)
        .join(" ");
      out.push(Decoration.line({ class: cls }).range(l.from));
    }
    if (!rawOpen && first.to > first.from)
      out.push(Decoration.replace({}).range(first.from, first.to));
    if (closed && !rawClose && last.to > last.from)
      out.push(Decoration.replace({}).range(last.from, last.to));
    out.push(
      Decoration.widget({
        widget: new LanguagePicker(
          block.lang,
          block.infoFrom,
          block.infoTo,
          !state.readOnly,
        ),
        side: 1,
      }).range(first.to),
    );
    const contentFrom = first.to + 1;
    const contentTo = closed ? last.from - 1 : last.to;
    const desc = describe(block.lang);
    if (desc && contentTo > contentFrom) {
      if (desc.support) {
        const code = doc.sliceString(contentFrom, contentTo);
        const tree = desc.support.language.parser.parse(code);
        highlightTree(tree, classHighlighter, (x, y, cls) => {
          if (cls)
            out.push(
              Decoration.mark({ class: cls }).range(
                contentFrom + x,
                contentFrom + y,
              ),
            );
        });
      } else if (!loading.has(desc)) {
        loading.add(desc);
        void desc.load().then(() => {
          loading.delete(desc);
          view.dispatch({ effects: langLoaded.of(null) });
        });
      }
    }
  }

  for (let n = 1; n <= doc.lines; n++) {
    if (inBlock.has(n)) continue;
    const line = doc.line(n);
    const h = HEADING.exec(line.text);
    if (h) {
      const level = h[1].length;
      out.push(
        Decoration.line({ class: `cm-md-h cm-md-h${level}` }).range(line.from),
      );
      const marker = h[0].length;
      if (marker > 0 && line.to > line.from)
        out.push(Decoration.replace({}).range(line.from, line.from + marker));
      inline(state, line.text.slice(marker), line.from + marker, out);
    } else if (line.text) {
      inline(state, line.text, line.from, out);
    }
  }
  return Decoration.set(out, true);
}

/** Renders Markdown as you type: headings, inline styles and highlighted code blocks. */
export function markdownLive(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
      }
      update(u: ViewUpdate) {
        if (
          u.docChanged ||
          u.selectionSet ||
          u.transactions.some((t) => t.effects.some((e) => e.is(langLoaded)))
        )
          this.decorations = build(u.view);
      }
    },
    {
      decorations: (v) => v.decorations,
      provide: (plugin) =>
        EditorView.atomicRanges.of(
          (view) => view.plugin(plugin)?.decorations ?? Decoration.none,
        ),
    },
  );
}

function blockAt(state: EditorState, pos: number): CodeBlock | undefined {
  const n = state.doc.lineAt(pos).number;
  return scanBlocks(state.doc).find(
    (b) => n >= b.open && n <= (b.close ?? state.doc.lines),
  );
}

/** Puts the cursor on a line after the block, adding one if the block ends the document. */
function exitBlock(view: EditorView, block: CodeBlock, drop?: number): boolean {
  const { doc } = view.state;
  const endLine = doc.line(block.close ?? doc.lines);
  const changes: { from: number; to?: number; insert?: string }[] = [];
  if (drop !== undefined) {
    const l = doc.line(drop);
    changes.push({ from: Math.max(0, l.from - 1), to: l.to });
  }
  let anchor: number;
  if (endLine.to === doc.length) {
    changes.push({ from: doc.length, insert: "\n" });
    anchor = doc.length + 1;
  } else anchor = endLine.to + 1;
  if (drop !== undefined) {
    const l = doc.line(drop);
    anchor -= l.to - Math.max(0, l.from - 1);
  }
  view.dispatch({
    changes,
    selection: { anchor },
    userEvent: "input",
    scrollIntoView: true,
  });
  return true;
}

function unwrapBlock(view: EditorView, block: CodeBlock): boolean {
  const { doc } = view.state;
  const open = doc.line(block.open);
  const changes = [{ from: open.from, to: Math.min(doc.length, open.to + 1) }];
  if (block.close !== null) {
    const close = doc.line(block.close);
    changes.push({ from: Math.max(open.to + 1, close.from - 1), to: close.to });
  }
  view.dispatch({
    changes,
    selection: {
      anchor: Math.min(doc.length, open.to + 1) - (open.to + 1 - open.from),
    },
    userEvent: "delete",
  });
  return true;
}

/** Code-block editing keys: Enter after a fence opens it; Enter on an empty last line, ArrowDown and Mod-Enter leave it; Backspace at its start unwraps it. */
export function codeFenceEnter(): Extension {
  const guard = (view: EditorView) =>
    view.state.selection.main.empty && !view.state.readOnly;
  return Prec.high(
    keymap.of([
      {
        key: "Mod-Enter",
        run(view) {
          if (!guard(view)) return false;
          const b = blockAt(view.state, view.state.selection.main.head);
          return b ? exitBlock(view, b) : false;
        },
      },
      {
        key: "ArrowDown",
        run(view) {
          if (!guard(view)) return false;
          const { state } = view;
          const b = blockAt(state, state.selection.main.head);
          if (!b) return false;
          const n = state.doc.lineAt(state.selection.main.head).number;
          const lastContent = (b.close ?? state.doc.lines + 1) - 1;
          return n === lastContent && b.close !== null
            ? exitBlock(view, b)
            : false;
        },
      },
      {
        key: "Backspace",
        run(view) {
          if (!guard(view)) return false;
          const { state } = view;
          const head = state.selection.main.head;
          const line = state.doc.lineAt(head);
          const h = HEADING.exec(line.text);
          if (
            h &&
            (head === line.from + h[0].length || head === line.from) &&
            !blockAt(state, head)
          ) {
            view.dispatch({
              changes: { from: line.from, to: line.from + h[0].length },
              selection: { anchor: line.from },
              userEvent: "delete",
            });
            return true;
          }
          const b = blockAt(state, head);
          if (b && line.number === b.open + 1 && head === line.from)
            return unwrapBlock(view, b);
          return false;
        },
      },
      {
        key: "Enter",
        run(view) {
          const { state } = view;
          const sel = state.selection.main;
          if (!sel.empty || state.readOnly) return false;
          const inside = blockAt(state, sel.head);
          if (inside && inside.close !== null) {
            const n = state.doc.lineAt(sel.head).number;
            if (
              n > inside.open &&
              n === inside.close - 1 &&
              state.doc.line(n).text === "" &&
              n - 1 > inside.open
            )
              return exitBlock(view, inside, n);
          }
          const line = state.doc.lineAt(sel.head);
          if (sel.head !== line.to || !/^```[\w+#.-]*$/.test(line.text))
            return false;
          let fences = 0;
          for (let n = 1; n < line.number; n++)
            if (/^\s*```/.test(state.doc.line(n).text)) fences++;
          if (fences % 2 === 1) return false;
          let closed = false;
          for (let n = line.number + 1; n <= state.doc.lines; n++)
            if (/^\s*```\s*$/.test(state.doc.line(n).text)) {
              closed = true;
              break;
            }
          if (closed) return false;
          view.dispatch({
            changes: { from: sel.head, insert: "\n\n```" },
            selection: { anchor: sel.head + 1 },
            userEvent: "input",
            scrollIntoView: true,
          });
          return true;
        },
      },
    ]),
  );
}

export function insertCodeBlock(view: EditorView, lang = ""): void {
  const { from, to } = view.state.selection.main;
  const text = view.state.doc.sliceString(from, to);
  const before =
    from > 0 && view.state.doc.sliceString(from - 1, from) !== "\n";
  const lead = before ? "\n" : "";
  const head = `${lead}\`\`\`${lang}\n`;
  view.dispatch({
    changes: { from, to, insert: `${head}${text}\n\`\`\`\n` },
    selection: {
      anchor: from + head.length,
      head: from + head.length + text.length,
    },
    userEvent: "input",
    scrollIntoView: true,
  });
  view.focus();
}

const STRUCTURE =
  /<(h[1-6]|pre|strong|b|em|i|a|ul|ol|li|blockquote|code)[\s>]/i;

/** Rich text from a web page or another editor, as Markdown. */
export function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const walk = (node: Node, inPre = false): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent ?? "";
      return inPre ? t : t.replace(/\s+/g, " ");
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const kids = () =>
      Array.from(el.childNodes)
        .map((c) => walk(c, inPre))
        .join("");
    switch (tag) {
      case "script":
      case "style":
      case "head":
        return "";
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        return `\n\n${"#".repeat(Number(tag[1]))} ${kids().trim()}\n\n`;
      case "pre": {
        const code = el.querySelector("code");
        const lang =
          /language-([\w+#.-]+)/.exec(code?.className ?? el.className)?.[1] ??
          "";
        const body = (el.textContent ?? "").replace(/\n$/, "");
        return `\n\n\`\`\`${lang}\n${body}\n\`\`\`\n\n`;
      }
      case "code":
        return inPre ? kids() : `\`${el.textContent}\``;
      case "strong":
      case "b":
        return kids().trim() ? `**${kids().trim()}**` : "";
      case "em":
      case "i":
        return kids().trim() ? `*${kids().trim()}*` : "";
      case "a": {
        const href = el.getAttribute("href");
        return href && kids().trim() ? `[${kids().trim()}](${href})` : kids();
      }
      case "br":
        return "\n";
      case "li": {
        const parent = el.parentElement?.tagName.toLowerCase();
        const mark =
          parent === "ol"
            ? `${Array.from(el.parentElement!.children).indexOf(el) + 1}. `
            : "- ";
        return `\n${mark}${kids().trim()}`;
      }
      case "ul":
      case "ol":
        return `\n\n${kids()}\n\n`;
      case "blockquote":
        return `\n\n${kids()
          .trim()
          .split("\n")
          .map((l) => `> ${l}`)
          .join("\n")}\n\n`;
      case "p":
        return `\n\n${kids().trim()}\n\n`;
      case "div":
      case "section":
      case "article":
      case "tr":
        return `\n${kids()}\n`;
      default:
        return kids();
    }
  };
  return walk(doc.body)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Pasting formatted text (headings, code, bold, links) keeps its structure as Markdown. */
export function pasteAsMarkdown(): Extension {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const html = event.clipboardData?.getData("text/html");
      if (!html || !STRUCTURE.test(html) || view.state.readOnly) return false;
      const md = htmlToMarkdown(html);
      if (!md) return false;
      event.preventDefault();
      view.dispatch({
        ...view.state.replaceSelection(md),
        userEvent: "input.paste",
        scrollIntoView: true,
      });
      return true;
    },
  });
}

export function blockTypeAt(state: EditorState, pos?: number): BlockType {
  const head = pos ?? state.selection.main.head;
  if (blockAt(state, head)) return "code";
  const h = HEADING.exec(state.doc.lineAt(head).text);
  return h ? (`h${h[1].length}` as BlockType) : "p";
}

/** Reports the block type under the cursor whenever it may have changed. */
export function blockTypeWatcher(
  onChange: (type: BlockType) => void,
): Extension {
  return EditorView.updateListener.of((u) => {
    if (u.docChanged || u.selectionSet) onChange(blockTypeAt(u.state));
  });
}

/** Turns the selected lines into a paragraph, a heading or a code block. */
export function setBlockType(view: EditorView, type: BlockType): void {
  const { state } = view;
  if (state.readOnly) return;
  const sel = state.selection.main;
  const current = blockAt(state, sel.head);
  if (type === "code") {
    if (current) return;
    const a = state.doc.lineAt(sel.from);
    const b = state.doc.lineAt(sel.to);
    const stripped = state.doc
      .sliceString(a.from, b.to)
      .replace(/^#{1,6}[ \t]+/gm, "");
    view.dispatch({
      changes: {
        from: a.from,
        to: b.to,
        insert: `\`\`\`\n${stripped}\n\`\`\``,
      },
      selection: { anchor: a.from + 4 },
      userEvent: "input",
    });
    view.focus();
    return;
  }
  if (current) {
    unwrapBlock(view, current);
    if (type === "p") {
      view.focus();
      return;
    }
  }
  const s = view.state;
  const at = s.selection.main;
  const a = s.doc.lineAt(at.from);
  const b = s.doc.lineAt(at.to);
  const changes = [];
  for (let n = a.number; n <= b.number; n++) {
    const l = s.doc.line(n);
    const old = HEADING.exec(l.text)?.[0].length ?? 0;
    changes.push({
      from: l.from,
      to: l.from + old,
      insert: type === "p" ? "" : `${"#".repeat(Number(type[1]))} `,
    });
  }
  view.dispatch({ changes, userEvent: "input" });
  view.focus();
}
