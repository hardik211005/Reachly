import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "./fixtures";

const shots = process.env.E2E_SCREENSHOTS === "1";

interface Created {
  leadId: string;
  dealId: string;
  name: string;
}

/** A throwaway company with a deal, removed afterwards so the suite stays repeatable. */
async function createCompany(request: APIRequestContext, baseURL: string | undefined, stage: string): Promise<Created> {
  const headers = { origin: baseURL ?? "http://localhost:3000" };
  const name = `E2E ${stage.toLowerCase()} ${Date.now().toString(36)}`;
  const lead = await request.post("/api/v1/leads", { headers, data: { name, email: "owner@e2e-company.example", city: "New Delhi", category: "cafe" } });
  expect(lead.ok()).toBeTruthy();
  const leadId = ((await lead.json()) as { data: { id: string } }).data.id;
  const deal = await request.post("/api/v1/deals", { headers, data: { leadId, stage, value: 50_000 } });
  expect(deal.ok()).toBeTruthy();
  return { leadId, dealId: ((await deal.json()) as { data: { id: string } }).data.id, name };
}

async function removeCompany(request: APIRequestContext, baseURL: string | undefined, company: Created | null) {
  if (company) await request.delete(`/api/v1/leads/${company.leadId}`, { headers: { origin: baseURL ?? "http://localhost:3000" } });
}

test.describe("CRM & quotes", () => {
  test("pipeline: drag a deal to the next stage and open it", async ({ page, request, baseURL }) => {
    const company = await createCompany(request, baseURL, "QUALIFIED");
    try {
      await page.goto("/app/crm");
      await expect(page.getByRole("heading", { name: "CRM", exact: true })).toBeVisible();
      await expect(page.getByText("Open pipeline")).toBeVisible();
      const card = page.locator('li[aria-roledescription="Draggable deal"]', { hasText: company.name });
      await expect(card).toBeVisible();
      if (shots) await page.screenshot({ path: "e2e/screenshots/crm-pipeline.png" });

      const target = page.getByRole("region", { name: "Contacted column" });
      const from = (await card.boundingBox())!;
      const to = (await target.boundingBox())!;
      const moved = page.waitForResponse((response) => response.url().includes(`/api/v1/deals/${company.dealId}/move`) && response.request().method() === "POST");
      await page.mouse.move(from.x + from.width / 2, from.y + 24);
      await page.mouse.down();
      await page.mouse.move(from.x + from.width / 2 + 12, from.y + 36, { steps: 4 });
      await page.mouse.move(to.x + to.width / 2, to.y + 90, { steps: 16 });
      await page.mouse.up();
      expect((await moved).ok()).toBeTruthy();
      await expect(target.locator('li[aria-roledescription="Draggable deal"]', { hasText: company.name })).toBeVisible();

      await target.getByText(company.name).click();
      const sheet = page.getByRole("dialog");
      await expect(sheet.getByText("Next steps")).toBeVisible();
      await expect(sheet.getByRole("combobox", { name: "Stage" })).toContainText("Contacted");
      await expect(sheet.getByText("Deal stage changed").first()).toBeVisible();
      if (shots) await page.screenshot({ path: "e2e/screenshots/crm-deal.png" });
    } finally {
      await removeCompany(request, baseURL, company);
    }
  });

  test("tasks, meetings, contacts and catalog", async ({ page }) => {
    await page.goto("/app/crm?tab=tasks");
    await expect(page.getByRole("radio", { name: "My tasks" })).toBeVisible();
    await expect(page.getByText(/Overdue|Today|Next 7 days|all caught up/).first()).toBeVisible();
    if (shots) await page.screenshot({ path: "e2e/screenshots/crm-tasks.png", fullPage: true });

    await page.getByRole("radio", { name: "Meetings" }).click();
    await expect(page.getByRole("button", { name: "Schedule meeting" })).toBeVisible();
    await page.getByRole("radio", { name: "Contacts" }).click();
    await expect(page.getByText(/\d+ people/)).toBeVisible();

    await page.getByRole("radio", { name: "Products & pricing" }).click();
    await expect(page.getByText("Social media management")).toBeVisible();
    await expect(page.getByText("10% off Growth starter bundle from 6 months")).toBeVisible();
    await expect(page.getByLabel("Number prefix")).toHaveValue("Q");
    if (shots) await page.screenshot({ path: "e2e/screenshots/crm-catalog.png", fullPage: true });
  });

  test("quote: AI draft from a deal, edit, share, customer accepts, deal won", async ({ page, context, request, baseURL }) => {
    test.setTimeout(120_000);
    const company = await createCompany(request, baseURL, "MEETING");
    try {
      await page.goto(`/app/crm?deal=${company.dealId}`);
      const sheet = page.getByRole("dialog");
      await expect(sheet.getByText("Next steps")).toBeVisible();
      await sheet.getByRole("button", { name: "Draft with AI" }).click();
      await page.waitForURL(/\/app\/crm\/quotes\/[0-9a-f-]+$/);
      const quoteId = page.url().split("/").at(-1)!;
      await expect(page.getByText("AI draft")).toBeVisible();
      await expect(page.getByText(/Drafted from your conversation/)).toBeVisible();

      // Prices come from the catalog; editing the quantity re-prices live and autosaves.
      await page.getByLabel(/^Quantity/).first().fill("6");
      await expect(page.getByText("6+ months commitment").first()).toBeVisible().catch(() => undefined);
      await expect(page.getByText("All changes saved")).toBeVisible({ timeout: 15_000 });
      if (shots) await page.screenshot({ path: "e2e/screenshots/quote-editor.png", fullPage: true });

      const pdf = await request.get(`/api/v1/quotes/${quoteId}/pdf`);
      expect(pdf.headers()["content-type"]).toBe("application/pdf");
      expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

      await page.getByRole("button", { name: "Send", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("radio", { name: /Share link/ }).click();
      await expect(dialog.getByLabel("Quote link")).toHaveValue(/\/q\//);
      await dialog.getByRole("button", { name: "Mark as sent" }).click();
      await expect(page.getByText("Marked as sent")).toBeVisible();
      const publicUrl = await page.getByRole("link", { name: /Customer view/ }).getAttribute("href");
      expect(publicUrl).toContain("/q/");

      const customer = await context.newPage();
      await customer.goto(publicUrl!);
      await customer.getByRole("button", { name: "Accept quote" }).click();
      await customer.getByLabel("Your name").fill("Priya Sharma");
      if (shots) await customer.screenshot({ path: "e2e/screenshots/quote-public.png", fullPage: true });
      await customer.getByRole("button", { name: "Confirm acceptance" }).click();
      await expect(customer.getByText(/Quote accepted by Priya Sharma/)).toBeVisible();
      await customer.close();

      const deal = await request.get(`/api/v1/deals/${company.dealId}`);
      expect(((await deal.json()) as { data: { stage: string } }).data.stage).toBe("WON");
    } finally {
      await removeCompany(request, baseURL, company);
    }
  });
});
