import { addMonths } from "date-fns";
import { prisma, type PrismaClient } from "@repo/db";
import type { TenantContext } from "../context";
import { audit } from "../audit";
import { NotFoundError } from "../errors";
import { getDefaultPlan } from "./plans";

/** Every organisation has exactly one subscription row; new workspaces start on the default plan. */
export async function ensureSubscription(organizationId: string, client: PrismaClient = prisma) {
  const existing = await client.subscription.findUnique({ where: { organizationId } });
  if (existing) return existing;
  const plan = await getDefaultPlan(client);
  const now = new Date();
  return client.subscription.create({
    data: {
      organizationId,
      planId: plan.id,
      status: "ACTIVE",
      billingProvider: "none",
      currentPeriodStart: now,
      currentPeriodEnd: addMonths(now, 1),
    },
  });
}

/**
 * Switches plan without a payment provider. Only used when billing is not configured
 * (demo/local); the UI labels this clearly as "no payment collected".
 */
export async function changePlanWithoutPayment(ctx: TenantContext, planKey: string) {
  const plan = await prisma.plan.findUnique({ where: { key: planKey } });
  if (!plan || !plan.isActive) throw new NotFoundError("Plan", planKey);
  const subscription = await ctx.db.subscription.findFirst();
  if (!subscription) throw new NotFoundError("Subscription");
  const updated = await ctx.db.subscription.update({
    where: { id: subscription.id },
    data: { planId: plan.id, status: "ACTIVE", billingProvider: "none" },
  });
  await audit(ctx, {
    action: "billing.plan_changed",
    resourceType: "subscription",
    resourceId: subscription.id,
    metadata: { planKey, paymentCollected: false },
  });
  return updated;
}
