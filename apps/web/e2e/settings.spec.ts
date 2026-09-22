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

  test("billing explains missing payment keys and confirms plan changes", async ({ page }) => {
    // The e2e server runs without Stripe or Razorpay keys, in development.
    await page.goto("/app/billing?checkout=cancelled");
    await expect(page.getByText("Checkout cancelled — nothing was charged")).toBeVisible();
    await expect(page).toHaveURL(/\/app\/billing$/);
    await expect(page.getByText("Payments aren't connected.")).toBeVisible();

    await page.getByRole("button", { name: "Upgrade to Scale" }).click();
    await expect(page.getByRole("dialog", { name: "Switch to Scale?" })).toContainText("no payment is collected");
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

    await page.getByRole("button", { name: "Switch to Free" }).click();
    const downgrade = page.getByRole("dialog", { name: "Move to Free?" });
    await expect(downgrade).toBeVisible();
    await downgrade.getByRole("button", { name: /^Keep / }).click();
    await expect(downgrade).toBeHidden();
    if (shots) await page.screenshot({ path: "e2e/screenshots/billing.png", fullPage: true });
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
