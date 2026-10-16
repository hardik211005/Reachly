import { expect, test } from "./fixtures";

test.describe("Lead scoring settings and the learned model", () => {
  test("shows weights, rules and the model trained on demo outcomes", async ({ page }) => {
    await page.goto("/app/settings/scoring");
    await expect(page.getByRole("heading", { name: "Factor weights" })).toBeVisible();
    await expect(page.getByLabel("Contactability")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Learn from your results" })).toBeVisible();
    // The seed trains the model, so its evaluation is on screen.
    await expect(page.getByText(/Cross-validated AUC/)).toBeVisible();
    await expect(page.getByText("Weight now → suggested")).toBeVisible();
  });

  test("add a rule, save it, then remove it again", async ({ page }) => {
    await page.goto("/app/settings/scoring");
    await page.getByRole("button", { name: "Add rule" }).click();
    await page.getByLabel("Rule label").fill("E2E multi-location");
    await page.getByRole("button", { name: "Save changes" }).first().click();
    await expect(page.getByText("Scoring saved")).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Rule label")).toHaveValue("E2E multi-location");
    await page.getByRole("button", { name: "Remove rule E2E multi-location" }).click();
    await page.getByRole("button", { name: "Save changes" }).first().click();
    // Wait for the save to land, so the rule never leaks into the next run on a reused database.
    await expect(page.getByText("Scoring saved")).toBeVisible();
    await page.reload();
    await expect(page.getByText("No rules yet.")).toBeVisible();
  });

  test("retraining reports the model and leads show a predicted conversion", async ({ page, baseURL }) => {
    // Cookie-authenticated writes must carry our Origin (CSRF check).
    const train = await page.request.post("/api/v1/scoring/model", { headers: { origin: baseURL ?? "http://localhost:3100" }, data: { action: "train" } });
    expect(train.ok()).toBe(true);
    const trained = (await train.json()) as { data: { result: { status: string } } };
    expect(trained.data.result.status).toBe("trained");

    const list = (await (await page.request.get("/api/v1/leads?status=INTERESTED&limit=1")).json()) as { data: Array<{ id: string }> };
    const lead = list.data[0];
    test.skip(!lead, "no interested lead in the seed");
    await page.goto(`/app/leads/${lead!.id}`);
    await expect(page.getByRole("heading", { name: "Predicted conversion" })).toBeVisible();
    await expect(page.getByText(/learned from \d+ of your past leads/)).toBeVisible();
  });
});
