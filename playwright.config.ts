import { defineConfig, devices } from "@playwright/test";

// Each parallel worktree needs its own dev server; override with PW_PORT.
const port = process.env.PW_PORT || "5188";

export default defineConfig({
  testDir: "./test/e2e-playwright",
  timeout: 30000,
  expect: {
    timeout: 5000,
  },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `bun run build && bun run vite --port ${port} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${port}/test/e2e-playwright/fixture.html`,
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
    stderr: "pipe",
    timeout: 30000,
  },
});
