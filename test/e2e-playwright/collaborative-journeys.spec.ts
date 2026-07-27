import { test, expect, Page } from "@playwright/test";

async function getEditorText(page: Page, client: "A" | "B"): Promise<string> {
  const content = await page.evaluate((clientKey: string) => {
    const harness = (window as any).testHarness;
    const isClientA = clientKey === "A";
    if (isClientA) return harness.cmA.getValue();
    return harness.cmB.getValue();
  }, client);
  return content;
}

test.describe("Tier C: Multi-Client Collaborative Acceptance Journeys (Issue #10)", () => {
  test.beforeEach(async ({ page }) => {
    page.on("console", (msg) =>
      console.log(`[Browser Console]: ${msg.text()}`),
    );
    page.on("pageerror", (err) =>
      console.error(`[Browser Error]: ${err.message}`),
    );
    await page.goto("/test/e2e-playwright/fixture.html");
    await page.waitForFunction(
      () => Boolean((window as any).testHarness),
      null,
      { timeout: 10000 },
    );

    // Wait for initial convergence between Client Alice and Client Bob
    await expect(
      page.locator("#editor-container-b .CodeMirror-lines"),
    ).toContainText("Initial shared collaboration text.", { timeout: 10000 });
  });

  test("Multi-client collaborative editing journey asserting DOM text convergence and presence overlay positioning", async ({
    page,
  }) => {
    // 1. Client Alice clicks her editor and inputs authentic keyboard characters
    await page.click("#editor-container-a .CodeMirror-lines");
    await page.evaluate(() => {
      const { cmA } = (window as any).testHarness;
      cmA.setCursor(cmA.lineCount() - 1, 0);
    });
    await page.keyboard.type("Hello from Alice over SyncSeam! ");

    // 2. Assert Client Bob converges visually and receives Alice's remote presence cursor overlay
    await expect(
      page.locator("#editor-container-b .CodeMirror-lines"),
    ).toContainText("Hello from Alice over SyncSeam!");
    await expect(
      page.locator("#editor-container-b .other-client.firepad-client-cursor"),
    ).toBeAttached();
    await expect(
      page.locator("#editor-container-b .other-client.firepad-client-cursor"),
    ).toHaveAttribute("data-clientid", "Alice");

    const textBAfterAlice = await getEditorText(page, "B");
    expect(textBAfterAlice).toContain("Hello from Alice over SyncSeam!");

    // 3. Client Bob clicks his editor and inputs authentic keyboard responses
    await page.click("#editor-container-b .CodeMirror-lines");
    await page.evaluate(() => {
      const { cmB } = (window as any).testHarness;
      cmB.setCursor(cmB.lineCount() - 1, 0);
    });
    await page.keyboard.type("Reply from Bob! ");

    // 4. Assert Client Alice automatically converges and receives Bob's remote presence cursor overlay
    await expect(
      page.locator("#editor-container-a .CodeMirror-lines"),
    ).toContainText("Reply from Bob!");
    await expect(
      page.locator("#editor-container-a .other-client.firepad-client-cursor"),
    ).toBeAttached();
    await expect(
      page.locator("#editor-container-a .other-client.firepad-client-cursor"),
    ).toHaveAttribute("data-clientid", "Bob");

    const finalTextA = await getEditorText(page, "A");
    const finalTextB = await getEditorText(page, "B");
    expect(finalTextA).toBe(finalTextB);
  });

  test("Network disconnection journey verifying tentative offline buffering and clean recovery upon reconnection", async ({
    page,
  }) => {
    // 1. Disconnect Client Alice from the collaborative synchronization seam
    const btnDisconnectA = page.locator("#btn-disconnect-a");
    const statusBadgeA = page.locator("#status-a");

    await btnDisconnectA.click();
    await expect(statusBadgeA).toHaveText("offline");
    await expect(statusBadgeA).toHaveClass(/offline/);

    // 2. Client Alice drafts tentative offline edits while disconnected
    await page.click("#editor-container-a .CodeMirror-lines");
    await page.evaluate(() => {
      const { cmA } = (window as any).testHarness;
      cmA.setCursor(cmA.lineCount() - 1, 0);
    });
    await page.keyboard.type("Offline draft by Alice. ");

    // Verify Alice's local editor displays her draft immediately
    await expect(
      page.locator("#editor-container-a .CodeMirror-lines"),
    ).toContainText("Offline draft by Alice.");

    // Give time to prove Client Bob does NOT receive Alice's offline edit
    await page.waitForTimeout(100);
    const textBOffline = await getEditorText(page, "B");
    expect(textBOffline).not.toContain("Offline draft by Alice.");

    // 3. Reconnect Client Alice to trigger tentative operation queue drain
    const btnReconnectA = page.locator("#btn-reconnect-a");
    await btnReconnectA.click();
    await expect(statusBadgeA).toHaveText("online");
    await expect(statusBadgeA).toHaveClass(/online/);

    // 4. Assert Client Bob converges cleanly upon Alice's reconnection
    await expect(
      page.locator("#editor-container-b .CodeMirror-lines"),
    ).toContainText("Offline draft by Alice.");

    const finalA = await getEditorText(page, "A");
    const finalB = await getEditorText(page, "B");
    expect(finalA).toBe(finalB);
  });
});
