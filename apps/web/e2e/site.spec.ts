import { test as plain } from "@playwright/test";
import { expect, test } from "./fixtures";

const shots = process.env.E2E_SCREENSHOTS === "1";

test.describe("Public website", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("navigates from the menu to a product page and on to pricing", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Services" }).click();
    await page.getByRole("link", { name: /AI calling/ }).first().click();
    await expect(page).toHaveURL(/\/product\/ai-calling$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("meeting on the calendar");
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("AI calling");
    if (shots) await page.screenshot({ path: "e2e/screenshots/product-page.png" });

    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Plans" }).click();
    await expect(page).toHaveURL(/\/pricing$/);
    await expect(page.getByRole("columnheader", { name: /Pro/ })).toBeVisible();
    await expect(page.getByRole("rowheader", { name: /Lead credits/ })).toBeVisible();
  });

  test("site search finds features and questions", async ({ page }) => {
    await page.goto("/pricing");
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("combobox").fill("whatsapp templates");
    await expect(dialog.getByRole("option").first()).toContainText(/WhatsApp/);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/product\/ai-outreach/);
  });

  test("contact form validates and sends", async ({ page }) => {
    await page.goto("/contact?topic=partnership");
    await expect(page.getByRole("radio", { name: /Partnerships/ })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText("Check the highlighted fields")).toBeVisible();

    await page.getByLabel("Your name").fill("E2E Visitor");
    await page.getByLabel("Work email").fill(`visitor-${Date.now()}@example.com`);
    await page.getByLabel("Message").fill("We sell POS software to cafés and want to try discovery.");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByRole("status")).toContainText("message received");
    if (shots) await page.screenshot({ path: "e2e/screenshots/contact-sent.png" });
  });

});

// The shared fixture fails on any HTTP error page, so the 404 check uses plain Playwright.
plain.describe("Public website errors", () => {
  plain.use({ storageState: { cookies: [], origins: [] } });

  plain("unknown pages show the 404 page", async ({ page }) => {
    const response = await page.goto("/this-page-does-not-exist");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "This page wandered off" })).toBeVisible();
  });
});
