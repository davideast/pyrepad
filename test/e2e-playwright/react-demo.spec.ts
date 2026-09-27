import { test, expect, Page } from "@playwright/test";

// The React demo (examples/react-collaborative-demo.html) over the hosted
// Pyric sandbox: two CollaborativeEditors, each with its own adapter on one
// shared database path. `?room=` gives every run an empty path so the
// `defaultText` seed is observable.

const SEED_FIRST_LINE =
  "// Welcome to the @pyric/pad/react pure ES Module developer studio!";

type CM5 = {
  getValue(): string;
  lineCount(): number;
  setCursor(line: number, ch: number): void;
};

function pane(page: Page, index: 0 | 1) {
  return page.locator(".pyrepad-editor-wrapper").nth(index);
}

async function editorText(page: Page, index: 0 | 1): Promise<string> {
  return page.evaluate((i: number) => {
    const el = document.querySelectorAll(".pyrepad-editor-wrapper .CodeMirror")[
      i
    ] as (Element & { CodeMirror?: CM5 }) | undefined;
    return el && el.CodeMirror ? el.CodeMirror.getValue() : "";
  }, index);
}

async function typeAtEnd(
  page: Page,
  index: 0 | 1,
  text: string,
): Promise<void> {
  await pane(page, index).locator(".CodeMirror-lines").click();
  await page.evaluate((i: number) => {
    const el = document.querySelectorAll(".pyrepad-editor-wrapper .CodeMirror")[
      i
    ] as Element & { CodeMirror: CM5 };
    el.CodeMirror.setCursor(el.CodeMirror.lineCount() - 1, 0);
  }, index);
  // One keystroke per acked commit: until the src OT client lands (T15), a
  // second local op sent before the first is acked races it and is lost.
  await page.keyboard.type(text);
}

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

test.describe("React demo over the hosted sandbox", () => {
  test("seeds once, syncs both editors, shows the agentive badge, logs no errors or warnings", async ({
    page,
  }) => {
    const problems: string[] = [];
    page.on("console", (msg) => {
      const isProblem = msg.type() === "error" || msg.type() === "warning";
      if (isProblem) problems.push(`[${msg.type()}] ${msg.text()}`);
    });
    page.on("pageerror", (err) => problems.push(`[pageerror] ${err.message}`));

    const room = `react-demo-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await page.goto(`/examples/react-collaborative-demo.html?room=${room}`);

    // 1. defaultText is seeded exactly once and reaches both editors.
    for (const index of [0, 1] as const) {
      await expect(
        pane(page, index).locator(".CodeMirror-lines"),
      ).toContainText(SEED_FIRST_LINE, { timeout: 15000 });
    }
    await page.waitForTimeout(500);
    for (const index of [0, 1] as const) {
      expect(occurrences(await editorText(page, index), SEED_FIRST_LINE)).toBe(
        1,
      );
    }

    // 2. Sequential edits: A types, B sees; then B types, A sees.
    await typeAtEnd(page, 0, "// typed in A");
    await expect.poll(() => editorText(page, 1)).toContain("// typed in A");
    await typeAtEnd(page, 1, "// typed in B");
    await expect.poll(() => editorText(page, 0)).toContain("// typed in B");
    const textB = await editorText(page, 1);
    await expect.poll(() => editorText(page, 0)).toBe(textB);

    // 3. broadcastAgentive shows the agent badge in both panes.
    await page.getByRole("button", { name: /Spawn AI Co-Pilot/ }).click();
    await expect(pane(page, 0)).toContainText("🤖 Jules-AI:");
    await expect(pane(page, 1)).toContainText("🤖 Jules-AI:");

    // 4. Nothing logged an error or a warning along the way.
    expect(problems).toEqual([]);
  });
});
