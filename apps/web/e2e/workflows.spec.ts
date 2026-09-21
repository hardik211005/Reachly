import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "./fixtures";

const shots = process.env.E2E_SCREENSHOTS === "1";

/** Workflows created by this suite are removed so it stays repeatable. */
async function removeTestWorkflows(request: APIRequestContext, baseURL: string | undefined) {
  const headers = { origin: baseURL ?? "http://localhost:3000" };
  const response = await request.get("/api/v1/workflows");
  const { data } = (await response.json()) as { data: Array<{ id: string; name: string }> };
  for (const workflow of data.filter((item) => item.name.startsWith("E2E "))) await request.delete(`/api/v1/workflows/${workflow.id}`, { headers });
}

test.describe("workflows", () => {
  test.beforeAll(async ({ request, baseURL }) => removeTestWorkflows(request, baseURL));
  test.afterAll(async ({ request, baseURL }) => removeTestWorkflows(request, baseURL));

  test("workflows home lists automations, templates, runs and n8n", async ({ page }) => {
    await page.goto("/app/workflows");
    await expect(page.getByRole("heading", { name: "Workflows", exact: true })).toBeVisible();
    await expect(page.getByText("Positive reply → follow up fast").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Start from a template" })).toBeVisible();
    if (shots) await page.screenshot({ path: "e2e/screenshots/workflows.png", fullPage: true });

    await page.getByRole("radio", { name: "Runs" }).click();
    await expect(page.locator("tbody tr").first()).toBeVisible();
    await page.locator("tbody tr").first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    if (shots) await page.screenshot({ path: "e2e/screenshots/workflow-run.png" });
    await page.keyboard.press("Escape");

    await page.getByRole("radio", { name: "n8n" }).click();
    await expect(page.getByText("Templates for n8n")).toBeVisible();
    if (shots) await page.screenshot({ path: "e2e/screenshots/workflows-n8n.png", fullPage: true });
    await page.getByRole("radio", { name: "Outbound webhooks" }).click();
    await expect(page.getByText(/Outbound webhooks are on the Scale plan|Add endpoint/)).toBeVisible();
  });

  test("build from a template, add a step, test on a lead and activate", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/app/workflows");
    await page.getByRole("article").filter({ hasText: "Call back requested" }).getByRole("button", { name: "Use template" }).click();
    await page.waitForURL(/\/app\/workflows\/[0-9a-f-]+$/);
    const name = page.getByRole("textbox", { name: "Workflow name" });
    await name.fill(`E2E callback ${Date.now().toString(36)}`);

    // Add a notification after the task.
    await page.getByRole("button", { name: "Add a step" }).last().click();
    await page.getByRole("button", { name: /Notify the team/ }).click();
    await expect(page.getByText("Goes to everyone in the workspace")).toBeVisible();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/saved/)).toBeVisible();
    if (shots) await page.screenshot({ path: "e2e/screenshots/workflow-builder.png" });

    // Dry run with a real lead: results appear on every node, nothing changes.
    await page.getByRole("button", { name: "Test" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("option").first().click();
    await dialog.getByRole("button", { name: "Run test" }).click();
    await expect(page.getByText(/Would create task/).first()).toBeVisible();
    if (shots) await page.screenshot({ path: "e2e/screenshots/workflow-test.png" });

    await page.getByRole("button", { name: "Activate" }).click();
    await expect(page.getByText("Workflow is live")).toBeVisible();
    await expect(page.getByText("Live", { exact: true })).toBeVisible();
  });
});
