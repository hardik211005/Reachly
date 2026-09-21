import { randomUUID } from "node:crypto";
import { prisma } from "@repo/db";
import { createTenantContext, type TenantContext } from "../../src/context";
import { createOrganization } from "../../src/organizations/service";
import { syncPlans } from "../../src/billing/plans";

/** Wipes tenant data between test files (plans are kept). */
export async function resetDatabase() {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations', 'plans')`;
  if (tables.length) {
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  }
  await syncPlans(prisma);
}

export async function createUser(name = "Test User") {
  return prisma.user.create({
    data: { id: randomUUID(), name, email: `${randomUUID()}@example.test`, emailVerified: true },
  });
}

/** Creates a user + workspace and returns an owner context for it. */
export async function createWorkspace(name = "Acme Workspace"): Promise<{ ctx: TenantContext; userId: string; organizationId: string }> {
  const user = await createUser();
  const org = await createOrganization({ userId: user.id, name });
  const ctx = createTenantContext({ organizationId: org.id, userId: user.id, role: "OWNER" });
  return { ctx, userId: user.id, organizationId: org.id };
}

export async function setPlan(organizationId: string, planKey: string) {
  const plan = await prisma.plan.findUniqueOrThrow({ where: { key: planKey } });
  await prisma.subscription.update({ where: { organizationId }, data: { planId: plan.id } });
}

let counter = 0;
export async function createLead(ctx: TenantContext, overrides: Record<string, unknown> = {}) {
  counter += 1;
  return ctx.db.lead.create({
    data: {
      organizationId: ctx.organizationId,
      name: `Lead ${counter}`,
      dedupeKey: `test:${counter}:${randomUUID()}`,
      sourceType: "MANUAL",
      sourceProvider: "manual",
      ...overrides,
    },
  });
}
