import { expect, test as setup } from "@playwright/test";

// Seeded demo account (npm run db:seed). Never a real credential.
const DEMO = { email: "demo@reachai.dev", password: "demo-password-2026" };

setup("sign in as the demo user", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(DEMO.email);
  await page.getByLabel("Password").fill(DEMO.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Good");
  await page.context().storageState({ path: "e2e/.auth/demo.json" });
});
