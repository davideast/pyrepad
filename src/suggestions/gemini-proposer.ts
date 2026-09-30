/**
 * A `Proposer` backed by a Firebase AI Logic GenerativeModel (real Gemini in
 * Pyric's passthrough mode, the scripted engine in the sandbox). It asks for
 * structured JSON and reduces whatever comes back to safe, verbatim-quoted edits.
 */
import type { ProposedEdit, ProposeRequest, Proposer } from "./types.js";

/** The slice of a Firebase AI Logic `GenerativeModel` the proposer uses. */
export interface GenerativeModelLike {
  generateContent(
    request: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ): Promise<{ response: { text(): string } }>;
}

export interface GeminiProposerOptions {
  /** Most edits kept from one response. Default 8. */
  maxEdits?: number;
}

const DEFAULT_MAX_EDITS = 8;

const SYSTEM_INSTRUCTION = [
  "You are an editing assistant inside a live collaborative document. You never rewrite the document; you propose suggestions that a person accepts or rejects one at a time.",
  "Rules:",
  '- Reply with a JSON array of edits and nothing else. Each edit is {"find","replacement","reason","kind"}. Return [] when nothing should change.',
  '- "find" must be a verbatim, character-exact substring of the TEXT TO REVIEW, unique in it. Never quote text from the context sections.',
  '- "replacement" is the exact text that should replace "find" (an empty string deletes it). Size the edit to the INSTRUCTIONS: for proofreading or fixing mistakes keep edits minimal (just the words that are wrong); for a rewrite, translation, or change of tone, voice or style, replace whole sentences so the result fully reads in the requested voice, and cover every sentence that does not already comply.',
  '- "reason" is one short sentence explaining the change to the author.',
  '- "kind" must be one of the ALLOWED KINDS.',
  "- CONTEXT BEFORE and CONTEXT AFTER are read-only; use them only to understand the text.",
  "- Follow the user's INSTRUCTIONS for what to look for. If the instructions ask for something unrelated to editing, return [].",
  "- Do not invent facts, and do not make edits the instructions did not ask for.",
].join("\n");

function responseSchema(kinds: readonly string[]): Record<string, unknown> {
  const kind: Record<string, unknown> = { type: "string" };
  if (kinds.length > 0) kind.enum = [...kinds];
  return {
    type: "array",
    items: {
      type: "object",
      properties: {
        find: { type: "string" },
        replacement: { type: "string" },
        reason: { type: "string" },
        kind,
      },
      required: ["find", "replacement", "reason", "kind"],
    },
  };
}

function revisionLines(request: ProposeRequest): string[] {
  const { revision } = request;
  if (!revision) return [];
  return [
    "REVISION REQUEST: TEXT TO REVIEW is the exact passage an earlier suggestion replaces.",
    `That suggestion proposed replacing it with: ${JSON.stringify(revision.replacement)}`,
    `The reviewer commented: ${JSON.stringify(revision.comment)}`,
    'Return exactly one edit whose "find" is the whole TEXT TO REVIEW and whose "replacement" is a revised version that follows the reviewer comment. The comment is a direct request from the author and takes priority over the INSTRUCTIONS; always return one edit unless the comment makes no sense.',
    "",
  ];
}

function userPrompt(request: ProposeRequest): string {
  return [
    ...revisionLines(request),
    "INSTRUCTIONS:",
    request.instructions.trim() || "Fix mistakes.",
    "",
    `ALLOWED KINDS: ${request.kinds.join(", ") || "edit"}`,
    "",
    "CONTEXT BEFORE (read-only):",
    request.before,
    "",
    "TEXT TO REVIEW:",
    request.text,
    "",
    "CONTEXT AFTER (read-only):",
    request.after,
  ].join("\n");
}

function abortError(signal?: AbortSignal): Error {
  const reason: unknown = signal?.reason;
  if (reason instanceof Error) return reason;
  return new DOMException("The proposal request was aborted.", "AbortError");
}

function stripFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```$/.exec(trimmed);
  return fenced ? fenced[1]!.trim() : trimmed;
}

function asEditArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "object" || value === null) return [];
  const record = value as Record<string, unknown>;
  if (typeof record.find === "string") return [record];
  const arrays = Object.values(record).filter(Array.isArray);
  return arrays.length === 1 ? (arrays[0] as unknown[]) : [];
}

/** Reduces model output to verbatim-quoted edits; never throws. */
export function parseProposedEdits(
  raw: string,
  text: string,
  maxEdits: number = DEFAULT_MAX_EDITS,
): ProposedEdit[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    return [];
  }
  const edits: ProposedEdit[] = [];
  const seen = new Set<string>();
  for (const entry of asEditArray(parsed)) {
    if (edits.length >= maxEdits) break;
    if (typeof entry !== "object" || entry === null) continue;
    const { find, replacement, reason, kind } = entry as Record<
      string,
      unknown
    >;
    if (
      typeof find !== "string" ||
      typeof replacement !== "string" ||
      typeof reason !== "string" ||
      typeof kind !== "string"
    ) {
      continue;
    }
    if (find.length === 0 || find === replacement) continue;
    if (!text.includes(find)) continue;
    const key = `${find}\u0000${replacement}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edits.push({ find, replacement, reason, kind });
  }
  return edits;
}

export function createGeminiProposer(
  model: GenerativeModelLike,
  options: GeminiProposerOptions = {},
): Proposer {
  const maxEdits = options.maxEdits ?? DEFAULT_MAX_EDITS;
  return async (request, signal) => {
    if (signal?.aborted) throw abortError(signal);
    const call = model.generateContent(
      {
        systemInstruction: SYSTEM_INSTRUCTION,
        contents: [{ role: "user", parts: [{ text: userPrompt(request) }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: responseSchema(request.kinds),
          temperature: 0.2,
        },
      },
      signal ? { signal } : undefined,
    );
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      if (!signal) return;
      onAbort = () => reject(abortError(signal));
      signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      const result = await (signal ? Promise.race([call, aborted]) : call);
      call.catch(() => undefined);
      return parseProposedEdits(result.response.text(), request.text, maxEdits);
    } finally {
      if (signal && onAbort) signal.removeEventListener("abort", onAbort);
    }
  };
}
