import { expect, test } from "./fixtures";

const shots = process.env.E2E_SCREENSHOTS === "1";

test.describe("Analytics & AI insights", () => {
  test("analytics: metrics with their counts, URL filters and CSV export", async ({ page }) => {
    await page.goto("/app/analytics?days=90");
    await expect(page.getByRole("heading", { name: "Analytics", exact: true })).toBeVisible();
    await expect(page.getByText("Reply rate", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Conversion funnel")).toBeVisible();
    // Rates show the counts behind them.
    await expect(page.getByText(/\d+ of \d+/).first()).toBeVisible();
    if (shots) await page.screenshot({ path: "e2e/screenshots/analytics.png", fullPage: true });

    await page.getByRole("radio", { name: "30d" }).click();
    await expect(page).toHaveURL(/days=30/);

    await page.getByRole("button", { name: "Export" }).click();
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: "By channel" }).click()]);
    expect(download.suggestedFilename()).toMatch(/^breakdown_channel_.*\.csv$/);
  });

  test("insights: each finding shows its evidence; earlier and dismissed views", async ({ page }) => {
    await page.goto("/app/ai-insights");
    await expect(page.getByRole("heading", { name: "AI insights" })).toBeVisible();
    const evidence = page.getByRole("button", { name: "Show evidence" }).first();
    await expect(evidence).toBeVisible();
    await evidence.click();
    await expect(page.getByText("Method:").first()).toBeVisible();
    if (shots) await page.screenshot({ path: "e2e/screenshots/insights.png", fullPage: true });

    await page.getByRole("radio", { name: "Dismissed" }).click();
    await expect(page.getByRole("radio", { name: "Dismissed" })).toHaveAttribute("aria-checked", "true");
  });
});

test.describe("Marketing site", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("landing page renders the product story and links to sign-up", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Find the right buyers");
    await expect(page.getByRole("link", { name: /Start free/ }).first()).toHaveAttribute("href", "/signup");
    await page.getByRole("heading", { name: /Start free\. Upgrade when/ }).scrollIntoViewIfNeeded();
    await expect(page.getByText("Recommended")).toBeVisible();
    if (shots) await page.screenshot({ path: "e2e/screenshots/landing.png" });
  });

  test("signed-in visitors go straight to their workspace", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "e2e/.auth/demo.json" });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page).toHaveURL(/\/app$/);
    await context.close();
  });
});
