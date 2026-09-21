import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "./fixtures";

const shots = process.env.E2E_SCREENSHOTS === "1";

/**
 * Campaigns created by this suite hold their leads (a lead can only be in one running
 * campaign), so remove them before and after the run to keep the suite repeatable.
 */
async function removeE2ECampaigns(request: APIRequestContext, baseURL: string | undefined) {
  const headers = { origin: baseURL ?? "http://localhost:3000" };
  const response = await request.get("/api/v1/campaigns");
  const { data } = (await response.json()) as { data: Array<{ id: string; name: string; status: string }> };
  for (const campaign of data.filter((item) => item.name.startsWith("E2E "))) {
    if (campaign.status === "ACTIVE") await request.post(`/api/v1/campaigns/${campaign.id}/complete`, { headers });
    await request.delete(`/api/v1/campaigns/${campaign.id}`, { headers });
  }
}

test.describe("campaigns & outreach", () => {
  test.beforeAll(async ({ request, baseURL }) => removeE2ECampaigns(request, baseURL));
  test.afterAll(async ({ request, baseURL }) => removeE2ECampaigns(request, baseURL));

  test("build, launch and review an assisted email campaign", async ({ page }) => {
    test.setTimeout(120_000);
    const name = `E2E cafés ${Date.now().toString(36)}`;

    await page.goto("/app/campaigns");
    await expect(page.getByRole("heading", { name: "Campaigns" })).toBeVisible();
    if (shots) await page.screenshot({ path: "e2e/screenshots/campaigns.png", fullPage: true });

    await page.getByRole("link", { name: /New campaign|Create your first campaign/ }).first().click();
    await expect(page.getByRole("heading", { name: "New campaign" })).toBeVisible();

    // 1. Offer
    await page.getByLabel("Campaign name").fill(name);
    await page.getByLabel("Offer in one or two sentences").fill("Custom-printed eco-friendly takeaway cups with low minimums.");
    if (shots) await page.screenshot({ path: "e2e/screenshots/builder-offer.png", fullPage: true });
    await page.getByRole("button", { name: "Continue" }).click();

    // 2. Audience — live preview from real leads
    await expect(page.getByText("Matching leads")).toBeVisible();
    await page.getByLabel("Minimum lead score").fill("40");
    await expect(page.getByText("With email")).toBeVisible();
    if (shots) await page.screenshot({ path: "e2e/screenshots/builder-audience.png", fullPage: true });
    await page.getByRole("button", { name: "Continue" }).click();

    // 3. Channels & mode (email via demo provider, assisted by default)
    await expect(page.getByRole("heading", { name: "Automation mode" })).toBeVisible();
    await expect(page.getByRole("radio", { name: /Assisted/ })).toBeChecked();
    if (shots) await page.screenshot({ path: "e2e/screenshots/builder-channels.png", fullPage: true });
    await page.getByRole("button", { name: "Continue" }).click();

    // 4. Sequence with a live preview for a real lead
    await expect(page.getByText("Preview", { exact: true })).toBeVisible();
    await expect(page.getByText("Personalised using")).toBeVisible({ timeout: 20_000 });
    if (shots) await page.screenshot({ path: "e2e/screenshots/builder-sequence.png", fullPage: true });
    await page.getByRole("button", { name: "Continue" }).click();

    // 5. Review → create draft
    await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible();
    if (shots) await page.screenshot({ path: "e2e/screenshots/builder-review.png", fullPage: true });
    await page.getByRole("button", { name: "Create campaign" }).click();

    // Launch dialog with the estimate; launch requires explicit confirmation.
    await page.waitForURL(/\/app\/campaigns\/[0-9a-f-]+\?launch=1/);
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Volume by channel")).toBeVisible();
    const launch = dialog.getByRole("button", { name: "Launch campaign" });
    await expect(launch).toBeDisabled();
    if (shots) await page.screenshot({ path: "e2e/screenshots/launch-dialog.png" });
    await dialog.getByRole("checkbox").check();
    await launch.click();
    await expect(page.getByText(`${name} is live`)).toBeVisible();

    // Assisted mode: prepared messages wait for approval.
    await expect(page.getByRole("tab", { name: /Review/ })).toBeVisible();
    await page.getByRole("tab", { name: /Review/ }).click();
    await expect(page.getByRole("button", { name: /Approve & send/ }).first()).toBeVisible({ timeout: 45_000 });
    if (shots) await page.screenshot({ path: "e2e/screenshots/campaign-review.png", fullPage: true });
    await page.getByRole("button", { name: /Approve & send/ }).first().click();
    await expect(page.getByText(/Approved — sending to/)).toBeVisible();

    await page.getByRole("tab", { name: "Overview" }).click();
    await expect(page.getByText("Sequence progress")).toBeVisible();
    if (shots) await page.screenshot({ path: "e2e/screenshots/campaign-overview.png", fullPage: true });
  });

  test("seeded campaign shows real performance", async ({ page }) => {
    await page.goto("/app/campaigns");
    await page.getByRole("link", { name: /Noida D2C Brands/ }).click();
    await expect(page.getByText("Sends and replies")).toBeVisible();
    await expect(page.getByText("Where leads are")).toBeVisible();
    if (shots) await page.screenshot({ path: "e2e/screenshots/campaign-seeded.png", fullPage: true });
    await page.getByRole("tab", { name: /Audience/ }).click();
    await expect(page.locator("tbody tr").first()).toBeVisible();
    await page.getByRole("tab", { name: "Sequence" }).click();
    await expect(page.getByText("On launch")).toBeVisible();
  });

  test("inbox shows classified replies and suggested responses", async ({ page }) => {
    await page.goto("/app/conversations?status=all");
    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
    const first = page.locator("section button[aria-current], section button").filter({ hasText: /You: |\w/ }).first();
    await expect(first).toBeVisible();
    // Open the most recent conversation with a reply.
    await page.getByRole("tab", { name: /All/ }).click();
    await page.locator("section").first().locator("button:has(time)").first().click();
    await expect(page.getByRole("textbox", { name: "Reply" }).or(page.getByText("WhatsApp 24-hour window closed")).or(page.getByText("Conversation closed"))).toBeVisible();
    if (shots) await page.screenshot({ path: "e2e/screenshots/inbox.png" });

    await page.getByRole("radio", { name: /Review/ }).click();
    await expect(page.getByRole("button", { name: /Approve & send/ }).first()).toBeVisible();
    if (shots) await page.screenshot({ path: "e2e/screenshots/inbox-review.png" });
  });

  test("email and WhatsApp channel pages", async ({ page }) => {
    await page.goto("/app/email");
    await expect(page.getByRole("heading", { name: "Email", exact: true })).toBeVisible();
    await expect(page.getByText("Sending safeguards")).toBeVisible();
    await expect(page.getByText("Volume and replies")).toBeVisible();
    if (shots) await page.screenshot({ path: "e2e/screenshots/email.png", fullPage: true });

    await page.goto("/app/whatsapp");
    await expect(page.getByText("Message templates")).toBeVisible();
    await expect(page.getByText("gentle_follow_up")).toBeVisible();
    await expect(page.getByText("Policy guardrails")).toBeVisible();
    if (shots) await page.screenshot({ path: "e2e/screenshots/whatsapp.png", fullPage: true });
  });

  test("lead workspace generates a pitch pack", async ({ page }) => {
    await page.goto("/app/leads?status=INTERESTED,MEETING");
    await page.locator("tbody tr a").first().click();
    await page.getByRole("tab", { name: /Outreach/ }).click();
    await expect(page.getByText("Every email and WhatsApp thread")).toBeVisible();
    await page.getByRole("button", { name: "Generate pitch pack" }).click();
    await expect(page.getByText("Objection handling")).toBeVisible({ timeout: 20_000 });
    if (shots) await page.screenshot({ path: "e2e/screenshots/lead-outreach.png", fullPage: true });
  });
});
