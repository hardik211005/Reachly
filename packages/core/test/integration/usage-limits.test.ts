import { beforeEach, describe, expect, it } from "vitest";
import { consumeUsage, getUsage } from "../../src/billing/usage";
import { LimitExceededError } from "../../src/errors";
import { createWorkspace, resetDatabase } from "./helpers";

describe("usage limits (server-side enforcement)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("consumes within the plan allowance and reports usage", async () => {
    const { ctx } = await createWorkspace();
    await consumeUsage(ctx, "EMAIL_SENDS", 5, { sourceType: "test" });
    const usage = await getUsage(ctx);
    const emails = usage.metrics.find((metric) => metric.metric === "EMAIL_SENDS");
    expect(emails?.used).toBe(5);
    expect(emails?.limit).toBe(200); // free plan default
  });

  it("rejects consumption beyond the limit", async () => {
    const { ctx } = await createWorkspace();
    // Free plan has 0 WhatsApp messages.
    await expect(consumeUsage(ctx, "WHATSAPP_MESSAGES", 1, { sourceType: "test" })).rejects.toBeInstanceOf(LimitExceededError);
  });

  it("never exceeds the limit under concurrent consumption", async () => {
    const { ctx } = await createWorkspace();
    await consumeUsage(ctx, "LEAD_CREDITS", 95, { sourceType: "test" }); // free plan: 100
    const attempts = await Promise.allSettled(
      Array.from({ length: 20 }, (_, index) => consumeUsage(ctx, "LEAD_CREDITS", 1, { sourceType: "test", sourceId: String(index) })),
    );
    const succeeded = attempts.filter((attempt) => attempt.status === "fulfilled").length;
    expect(succeeded).toBe(5);
    const usage = await getUsage(ctx);
    expect(usage.metrics.find((metric) => metric.metric === "LEAD_CREDITS")?.used).toBe(100);
  });

  it("is idempotent per idempotency key", async () => {
    const { ctx } = await createWorkspace();
    await consumeUsage(ctx, "AI_CREDITS", 3, { sourceType: "test", idempotencyKey: "job-1" });
    const second = await consumeUsage(ctx, "AI_CREDITS", 3, { sourceType: "test", idempotencyKey: "job-1" });
    expect(second.duplicate).toBe(true);
    const usage = await getUsage(ctx);
    expect(usage.metrics.find((metric) => metric.metric === "AI_CREDITS")?.used).toBe(3);
  });

  it("adds credit grants to the effective limit", async () => {
    const { ctx } = await createWorkspace();
    const usage = await getUsage(ctx);
    await ctx.db.creditGrant.create({
      data: { organizationId: ctx.organizationId, metric: "WHATSAPP_MESSAGES", amount: 2, reason: "test", periodStart: usage.periodStart },
    });
    await consumeUsage(ctx, "WHATSAPP_MESSAGES", 2, { sourceType: "test" });
    await expect(consumeUsage(ctx, "WHATSAPP_MESSAGES", 1, { sourceType: "test" })).rejects.toBeInstanceOf(LimitExceededError);
  });
});
