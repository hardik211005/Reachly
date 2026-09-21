import { expect, test as base } from "@playwright/test";

/**
 * Shared test fixture: fails the test on uncaught page errors, React hydration errors
 * and console errors, so UI regressions can't hide behind a passing assertion.
 */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
      page.on("response", (response) => {
        if (response.status() >= 400 && !response.url().includes("/api/")) errors.push(`http ${response.status()}: ${response.url()}`);
      });
      page.on("console", (message) => {
        if (message.type() !== "error") return;
        const text = message.text();
        // Aborted fetches during navigation are not application errors.
        // Resource failures are reported with their URL by the response listener above.
        if (/Failed to load resource|net::ERR_ABORTED|AbortError/.test(text)) return;
        errors.push(`console: ${text}`);
      });
      await use(errors);
      expect(errors, "page produced errors").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
