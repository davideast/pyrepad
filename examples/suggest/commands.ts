import type { GenerativeModelLike } from "../../src/suggestions/index.ts";

export type Command =
  | { type: "accept_all" }
  | { type: "reject_all" }
  | { type: "set_instructions"; instructions: string }
  | { type: "new_tab"; title: string }
  | { type: "new_tab_from_suggestions"; title: string }
  | { type: "name_tabs" }
  | { type: "write"; request: string }
  | { type: "reply"; message: string };

const HELP =
  "I can write new text as a suggestion, accept or reject all suggestions, change the instructions, create a tab (including one from the suggestions), or name your tabs from their content.";

/** Offline parser: covers the common phrasings so the composer works without a model. */
export function parseCommand(input: string): Command {
  const text = input.trim();
  const lower = text.toLowerCase();
  if (/\baccept\b.*\ball\b|\ball\b.*\baccept/.test(lower))
    return { type: "accept_all" };
  if (
    /\b(reject|deny|dismiss|decline)\b.*\ball\b|\ball\b.*\b(reject|deny|dismiss)/.test(
      lower,
    )
  ) {
    return { type: "reject_all" };
  }
  if (
    /\b(name|rename|title|label)\b.*\btabs?\b/.test(lower) &&
    !/\b(called|named)\b/.test(lower)
  )
    return { type: "name_tabs" };
  const named = /(?:called|named|titled)\s+["“]?(.+?)["”]?$/i.exec(text)?.[1];
  if (/\btab\b.*\bsuggestions?\b/.test(lower)) {
    return {
      type: "new_tab_from_suggestions",
      title: named ?? "With suggestions",
    };
  }
  if (/\b(new|create|add|open)\b.*\btab\b/.test(lower)) {
    return { type: "new_tab", title: named ?? "Untitled tab" };
  }
  if (
    /^(?:please\s+)?(?:write|draft|compose|continue|add|insert|type|generate)\b/i.test(
      text,
    )
  )
    return { type: "write", request: text };
  const instr =
    /^(?:change|set|update|switch)\b.*?\binstructions?\b\s*(?:to|:)?\s*(.+)$/i.exec(
      text,
    )?.[1];
  if (instr) return { type: "set_instructions", instructions: instr };
  return { type: "reply", message: HELP };
}

const SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: [
        "accept_all",
        "reject_all",
        "set_instructions",
        "new_tab",
        "new_tab_from_suggestions",
        "name_tabs",
        "write",
        "reply",
      ],
    },
    instructions: { type: "string" },
    title: { type: "string" },
    message: { type: "string" },
    request: { type: "string" },
  },
  required: ["action"],
};

const SYSTEM = [
  "You route a writer's request in a document editor to exactly one action.",
  "accept_all: apply every pending suggestion. reject_all: dismiss every pending suggestion.",
  'set_instructions: change what the writing assistant looks for; put the complete new instructions in "instructions".',
  'new_tab: create an empty tab; put a short name in "title".',
  'new_tab_from_suggestions: create a tab holding the text with all pending suggestions applied; put a short name in "title".',
  "name_tabs: give tabs that still have default names a title based on their content.",
  'write: the writer wants new text written into the document (even an empty one); put their request in "request". Never ask clarifying questions for a writing request; pick a reasonable angle. ',
  'reply: anything else; answer briefly in "message" and say what you can do.',
].join("\n");

export async function interpret(
  input: string,
  model: GenerativeModelLike | null,
  context: { instructions: string; pending: number },
): Promise<Command> {
  if (!model) return parseCommand(input);
  try {
    const result = await model.generateContent({
      systemInstruction: SYSTEM,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Current instructions: ${JSON.stringify(context.instructions)}\nPending suggestions: ${context.pending}\nRequest: ${JSON.stringify(input)}`,
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: SCHEMA,
      },
    });
    const out = JSON.parse(result.response.text()) as Record<string, string>;
    switch (out.action) {
      case "accept_all":
      case "reject_all":
      case "name_tabs":
        return { type: out.action };
      case "set_instructions":
        if (out.instructions?.trim())
          return {
            type: "set_instructions",
            instructions: out.instructions.trim(),
          };
        break;
      case "new_tab":
      case "new_tab_from_suggestions":
        return { type: out.action, title: out.title?.trim() || "Untitled tab" };
      case "write":
        return { type: "write", request: out.request?.trim() || input };
      case "reply":
        if (out.message) return { type: "reply", message: out.message };
    }
  } catch {
    // model unavailable or malformed: fall back to the offline parser
  }
  return parseCommand(input);
}

const MAX_TITLE = 40;

/** Offline title: the first few words of the text. */
export function titleFromText(text: string): string {
  const words = text
    .replace(/[#*_`>\[\]()]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .join(" ")
    .replace(/[.,;:!?]+$/, "");
  const title =
    words.length > MAX_TITLE ? `${words.slice(0, MAX_TITLE - 1)}…` : words;
  return title ? title[0].toUpperCase() + title.slice(1) : "";
}

/** Titles for tabs by id, from a sample of each tab's text. */
export async function nameTabs(
  items: { id: string; text: string }[],
  model: GenerativeModelLike | null,
): Promise<Record<string, string>> {
  const fallback = () =>
    Object.fromEntries(
      items
        .map((i) => [i.id, titleFromText(i.text)] as const)
        .filter(([, t]) => t),
    );
  if (!model || items.length === 0) return fallback();
  try {
    const result = await model.generateContent({
      systemInstruction:
        "Give each document tab a short, descriptive title (2 to 5 words, no quotes, no trailing punctuation) based on its text.",
      contents: [
        {
          role: "user",
          parts: [
            {
              text: JSON.stringify(
                items.map((i) => ({ id: i.id, text: i.text.slice(0, 600) })),
              ),
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "array",
          items: {
            type: "object",
            properties: { id: { type: "string" }, title: { type: "string" } },
            required: ["id", "title"],
          },
        },
      },
    });
    const out = JSON.parse(result.response.text()) as {
      id: string;
      title: string;
    }[];
    const known = new Set(items.map((i) => i.id));
    const named: Record<string, string> = {};
    for (const { id, title } of out) {
      const t = title?.trim().slice(0, MAX_TITLE);
      if (known.has(id) && t) named[id] = t;
    }
    if (Object.keys(named).length) return { ...fallback(), ...named };
  } catch {
    // model unavailable or malformed: use the offline titles
  }
  return fallback();
}

/** Drafts new text for a "write ..." request; plain text, no commentary. */
export async function draftText(
  request: string,
  model: GenerativeModelLike | null,
  context: { instructions: string; before: string; after: string },
): Promise<string> {
  if (!model) return `${request.replace(/^(?:please\s+)?\w+\s+/i, "")}.`;
  const result = await model.generateContent({
    systemInstruction:
      "You write text for a document. Reply with only the text to insert, in Markdown if formatting helps. No preamble, no questions, no commentary. Pick a reasonable angle if the request is open-ended. Follow the writer's standing instructions when they concern voice or style.",
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Standing instructions: ${JSON.stringify(context.instructions)}\nText before the insertion point: ${JSON.stringify(context.before.slice(-800))}\nText after: ${JSON.stringify(context.after.slice(0, 400))}\nRequest: ${JSON.stringify(request)}`,
          },
        ],
      },
    ],
  });
  return result.response.text().trim();
}
