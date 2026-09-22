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
  // The dev server also runs background jobs in-process (inline queue); more workers starve them.
  workers: devServer ? 2 : undefined,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
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
  // Tests run against their own dev server with simulated providers (demo mode), separate from
  // the real-provider server on :3000 you use by hand.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npx next dev --port 3100",
        url: "http://localhost:3100/login",
        reuseExistingServer: true,
        timeout: 180_000,
        env: {
          NEXT_DIST_DIR: ".next-e2e",
          APP_URL: "http://localhost:3100",
          BETTER_AUTH_URL: "http://localhost:3100",
          DEMO_MODE: "true",
          DEMO_SIMULATE_EVENTS: "true",
          LEAD_PROVIDER: "mock",
          ENRICHMENT_WEBSITE_FETCH_ENABLED: "false",
          AI_DEFAULT_PROVIDER: "mock",
          EMAIL_PROVIDER: "mock",
          WHATSAPP_PROVIDER: "mock",
          VOICE_PROVIDER: "mock",
          QUEUE_DRIVER: "inline",
        },
      },
});
