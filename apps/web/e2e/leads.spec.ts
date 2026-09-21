import { expect, test } from "./fixtures";

const shots = process.env.E2E_SCREENSHOTS === "1";

test.describe("lead engine", () => {
  test("overview renders metrics from real data", async ({ page }) => {
    await page.goto("/app");
    await expect(page.getByText("New leads").first()).toBeVisible();
    await expect(page.getByText("Conversion funnel")).toBeVisible();
    if (shots) await page.screenshot({ path: "e2e/screenshots/overview.png", fullPage: true });
  });

  test("discover finds, enriches and scores leads", async ({ page }) => {
    await page.goto("/app/discover");
    await page.getByRole("radio", { name: "Describe it" }).click();
    await page.getByLabel("What are you looking for?").fill("Find bakeries in Noida with 2+ locations that may need custom branded boxes");
    await page.getByRole("button", { name: "Find leads" }).click();
    await expect(page.getByText(/Searching for/)).toBeVisible();
    // "Save search" is disabled until the run completes.
    await expect(page.getByRole("button", { name: "Save search" })).toBeEnabled({ timeout: 60_000 });
    await expect(page.locator("tbody tr a").first()).toBeVisible();
    if (shots) await page.screenshot({ path: "e2e/screenshots/discover.png", fullPage: true });
  });

  test("leads table filters and opens a lead workspace with a transparent score", async ({ page }) => {
    await page.goto("/app/leads");
    await expect(page.getByRole("heading", { name: "Leads" })).toBeVisible();
    await expect(page.locator("tbody tr a").first()).toBeVisible();
    if (shots) await page.screenshot({ path: "e2e/screenshots/leads.png" });

    await page.getByRole("button", { name: /^Qualified/ }).click();
    await expect(page).toHaveURL(/status=QUALIFIED/);
    await expect(page.locator("tbody tr a").first()).toBeVisible();
    await page.locator("tbody tr a").first().click();
    await expect(page.getByText("Lead score")).toBeVisible();
    await page.getByText("ICP match").click();
    await expect(page.getByText(/target category/).first()).toBeVisible();
    if (shots) await page.screenshot({ path: "e2e/screenshots/lead-detail.png", fullPage: true });

    await page.getByRole("tab", { name: /Activity/ }).click();
    await expect(page.getByText("Lead discovered").first()).toBeVisible();
    await page.getByRole("tab", { name: /Sources/ }).click();
    await expect(page.getByText("Every place this business was found")).toBeVisible();
  });

  test("command menu searches leads", async ({ page }) => {
    await page.goto("/app");
    await page.keyboard.press("Control+k");
    await expect(page.getByPlaceholder(/Search leads/)).toBeVisible();
    await page.keyboard.type("caf");
    await expect(page.getByRole("option").first()).toBeVisible();
    if (shots) await page.screenshot({ path: "e2e/screenshots/command-menu.png" });
    await page.keyboard.press("Escape");
  });
});
