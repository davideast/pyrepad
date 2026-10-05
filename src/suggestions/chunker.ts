/**
 * Decides which finished text is worth sending for review: whole sentences the
 * assistant has not seen yet, never the one being typed.
 */
import type { Coverage, Span } from "./coverage.js";

export interface Sentence extends Span {
  /** Ended by terminal punctuation plus whitespace, or by a line break. */
  complete: boolean;
}

const CLOSERS = new Set(['"', "'", ")", "]", "”", "’"]);
const TERMINATORS = new Set([".", "!", "?", "…"]);

/** Splits text into sentences without their surrounding whitespace. */
export function sentenceSpans(text: string): Sentence[] {
  const sentences: Sentence[] = [];
  let start = -1;
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === "\n") {
      if (start !== -1) {
        sentences.push({
          from: start,
          to: trimEnd(text, start, i),
          complete: true,
        });
        start = -1;
      }
      i++;
      continue;
    }
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (start === -1) start = i;
    if (TERMINATORS.has(ch)) {
      let end = i + 1;
      while (
        end < text.length &&
        (TERMINATORS.has(text[end]!) || CLOSERS.has(text[end]!))
      ) {
        end++;
      }
      const next = text[end];
      if (next === undefined || /\s/.test(next)) {
        sentences.push({ from: start, to: end, complete: true });
        start = -1;
        i = end;
        continue;
      }
      i = end;
      continue;
    }
    i++;
  }
  if (start !== -1) {
    sentences.push({
      from: start,
      to: trimEnd(text, start, text.length),
      complete: false,
    });
  }
  return sentences;
}

function trimEnd(text: string, from: number, to: number): number {
  let end = to;
  while (end > from && /\s/.test(text[end - 1]!)) end--;
  return end;
}

export interface ChunkOptions {
  /** A chunk this short waits for more text (unless a paragraph just ended). */
  minChars: number;
  /** A chunk stops growing at this length. */
  maxChars: number;
}

/** The first run of unreviewed finished sentences that is ready to send. */
export function pickChunk(
  text: string,
  coverage: Coverage,
  cursor: number,
  options: ChunkOptions,
): Span | null {
  const sentences = sentenceSpans(text);
  let run: Span | null = null;
  for (const sentence of sentences) {
    const beingEdited = cursor > sentence.from && cursor <= sentence.to;
    const eligible =
      sentence.complete &&
      !beingEdited &&
      sentence.to > sentence.from &&
      !coverage.covers(sentence.from, sentence.to);
    if (!eligible) {
      if (run) break;
      continue;
    }
    if (run && sentence.to - run.from > options.maxChars) break;
    run = run
      ? { from: run.from, to: sentence.to }
      : { from: sentence.from, to: sentence.to };
  }
  if (!run) return null;
  const length = run.to - run.from;
  const endsParagraph = /^[^\S\n]*\n/.test(text.slice(run.to));
  if (length >= options.minChars || (endsParagraph && length >= 8)) return run;
  return null;
}
