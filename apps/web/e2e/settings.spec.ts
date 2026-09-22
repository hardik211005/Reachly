import { expect, test } from "./fixtures";

const shots = process.env.E2E_SCREENSHOTS === "1";

test.describe("Settings, integrations, billing and health", () => {
  test("every sidebar destination opens a working page", async ({ page }) => {
    for (const [path, heading] of [
      ["/app/settings", "Settings"],
      ["/app/integrations", "Integrations"],
      ["/app/billing", "Billing & plan"],
      ["/app/system", "System health"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    }
    await expect(page.getByText("All systems normal").or(page.getByText("Some things need attention"))).toBeVisible();
  });

  test("business & services shows the catalog and the ideal customer profile", async ({ page }) => {
    await page.goto("/app/settings/business");
    await expect(page.getByText("Products & services")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ideal customer profile" })).toBeVisible();
    if (shots) await page.screenshot({ path: "e2e/screenshots/settings-business.png", fullPage: true });
  });

  test("invite a teammate, then withdraw the invitation", async ({ page }) => {
    const email = `e2e-invite-${Date.now()}@example.com`;
    await page.goto("/app/settings/team");
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Send invite" }).click();
    await expect(page.getByText(`Invitation sent to ${email}`)).toBeVisible();
    // The success toast is also a list item, so pick the row with the Withdraw button.
    const row = page.getByRole("listitem").filter({ hasText: email }).filter({ has: page.getByRole("button", { name: "Withdraw" }) });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Withdraw" }).click();
    await expect(page.getByText("Invitation withdrawn")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: email }).filter({ has: page.getByRole("button", { name: "Withdraw" }) })).toHaveCount(0);
  });

  test("integrations show each category and open the connect panel", async ({ page }) => {
    await page.goto("/app/integrations");
    await expect(page.getByRole("heading", { name: "Email" })).toBeVisible();
    await page.getByRole("button", { name: /^(Connect|Manage) Resend$/ }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByLabel("API key")).toBeVisible();
    await expect(sheet.getByText("Secrets are encrypted and never shown again.")).toBeVisible();
    if (shots) await page.screenshot({ path: "e2e/screenshots/integrations-connect.png" });
    await page.keyboard.press("Escape");
  });

  test("discover offers ideas from the ideal customer profile", async ({ page }) => {
    await page.goto("/app/discover");
    await expect(page.getByText("Ideas from your ideal customer profile")).toBeVisible();
    const idea = page.getByRole("button").filter({ hasText: /for / }).first();
    const audience = (await idea.locator("span.block").first().textContent())?.trim() ?? "";
    await idea.click();
    await expect(page.getByLabel("Who do you want to sell to?")).toHaveValue(audience);
  });
});
