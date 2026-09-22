import { expect, test } from "./fixtures";

const shots = process.env.E2E_SCREENSHOTS === "1";

test.describe("AI calling", () => {
  test("calls dashboard shows history with outcomes", async ({ page }) => {
    await page.goto("/app/calls");
    await expect(page.getByRole("heading", { name: "Calls", exact: true })).toBeVisible();
    await expect(page.getByText("Connect rate")).toBeVisible();
    await page.getByRole("radio", { name: /History/ }).click();
    await expect(page.locator("tbody tr").first()).toBeVisible();
    if (shots) await page.screenshot({ path: "e2e/screenshots/calls.png", fullPage: true });

    await page.locator("tbody tr a").first().click();
    await expect(page.getByRole("heading", { name: "Transcript" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Call brief" })).toBeVisible();
    if (shots) await page.screenshot({ path: "e2e/screenshots/call-detail.png", fullPage: true });
  });

  test("an AI call runs live from the queue to an analysed outcome", async ({ page, request, baseURL }) => {
    test.setTimeout(150_000);
    // Queue a call of our own so the test doesn't depend on seeded calls still waiting.
    const headers = { origin: baseURL ?? "http://localhost:3000" };
    const lead = await request.post("/api/v1/leads", { headers, data: { name: `E2E call ${Date.now().toString(36)}`, phone: `+9198${String(Date.now()).slice(-8)}`, city: "New Delhi", category: "cafe" } });
    expect(lead.ok()).toBeTruthy();
    const leadId = ((await lead.json()) as { data: { id: string } }).data.id;
    expect((await request.post("/api/v1/calls", { headers, data: { leadId } })).ok()).toBeTruthy();

    await page.goto("/app/calls");
    await page.getByRole("radio", { name: /To call/ }).click();
    const start = page.getByRole("button", { name: "Start AI call" }).first();
    await expect(start).toBeVisible();
    await start.click();
    const dialog = page.getByRole("dialog");
    const callNow = dialog.getByRole("button", { name: "Call now" });
    await expect(callNow).toBeDisabled();
    await dialog.getByRole("checkbox").check();
    await callNow.click();
    await expect(page.getByText(/^Calling /)).toBeVisible();

    // Follow the call on its page: it rings, connects and the transcript fills in live.
    await page.getByRole("radio", { name: /Live/ }).click();
    await page.getByText("Follow live").first().click();
    await expect(page.getByRole("heading", { name: "Transcript" })).toBeVisible();
    // The simulated call runs as in-process jobs; under a busy dev server it can take a while to connect.
    await expect(page.getByText("AI agent ·").first().or(page.getByText("Nobody picked up"))).toBeVisible({ timeout: 75_000 });
    if (shots) await page.screenshot({ path: "e2e/screenshots/call-live.png", fullPage: true });
    await expect(page.getByRole("heading", { name: /What happened/ }).or(page.getByText("Nobody picked up"))).toBeVisible({ timeout: 90_000 });
    if (shots) await page.screenshot({ path: "e2e/screenshots/call-analysed.png", fullPage: true });
    await request.delete(`/api/v1/leads/${leadId}`, { headers });
  });

  test("lead workspace lists calls", async ({ page }) => {
    await page.goto("/app/calls");
    await page.getByRole("radio", { name: /History/ }).click();
    // Skip throwaway leads other tests create (and delete) while this one runs.
    await page.locator("tbody tr", { hasNotText: "E2E" }).locator("a").first().click();
    await expect(page.getByRole("heading", { name: "Transcript" })).toBeVisible();
    await page.locator('main a[href^="/app/leads/"]').first().click();
    await page.getByRole("tab", { name: /Outreach/ }).click();
    await expect(page.getByRole("heading", { name: "Calls" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Prepare call" })).toBeVisible();
  });
});
