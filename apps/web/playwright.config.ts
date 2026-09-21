import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against a running app (seeded demo workspace).
 * Locally they use the installed Chrome (no browser download); CI installs Chromium.
 */
// The dev server compiles each route on its first request (up to ~20s on a cold cache).
const devServer = !process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "./e2e",
  timeout: devServer ? 90_000 : 60_000,
  expect: { timeout: devServer ? 30_000 : 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "app",
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        channel: process.env.CI ? undefined : "chrome",
        storageState: "e2e/.auth/demo.json",
      },
      testIgnore: /auth\.setup\.ts|signup\.spec\.ts/,
    },
    {
      name: "signup",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, channel: process.env.CI ? undefined : "chrome" },
      testMatch: /signup\.spec\.ts/,
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: "npm run dev", url: "http://localhost:3000/login", reuseExistingServer: true, timeout: 120_000 },
});
