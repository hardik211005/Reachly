import { expect, test } from "./fixtures";

// Runs without the demo session (see the "signup" project in playwright.config.ts).
// Each run creates a fresh throwaway account on the local e2e server.
test.describe("Sign up", () => {
  test("validates the form before calling the server", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("At least 8 characters")).toBeVisible();
    await expect(page).toHaveURL(/\/signup/);
  });

  test("a new account lands in onboarding until a workspace is set up", async ({ page }) => {
    const email = `e2e-signup-${Date.now()}@example.com`;
    await page.goto("/signup");
    await page.getByLabel("Full name").fill("Priya Test");
    await page.getByLabel("Work email").fill(email);
    await page.getByLabel("Password").fill(`e2e-${Date.now()}-pass`);
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL("**/onboarding");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("your business");
    // No workspace exists until onboarding finishes, so the app keeps the user here.
    await page.goto("/app");
    await page.waitForURL("**/onboarding");
  });

  test("an existing email is rejected with a clear message", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("Full name").fill("Someone Else");
    await page.getByLabel("Work email").fill("demo@reachai.dev");
    await page.getByLabel("Password").fill("another-password-2026");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText(/already exists|already registered|already in use/i)).toBeVisible();
    await expect(page).toHaveURL(/\/signup/);
  });
});
