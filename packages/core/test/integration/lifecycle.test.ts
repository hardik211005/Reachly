import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@repo/db";
import { createApiKey, authenticateApiKey } from "../../src/api-keys";
import { audit, listAuditLogs } from "../../src/audit";
import { createTenantContext } from "../../src/context";
import { accountDeletionPlan, deleteAccount, deleteWorkspace, exportWorkspaceData, purgeDeletedWorkspaces, restoreWorkspace, WORKSPACE_PURGE_DAYS } from "../../src/organizations/lifecycle";
import { resolveMembership } from "../../src/organizations/service";
import { getPlatformOverview, isPlatformAdmin } from "../../src/platform/admin";
import { resetEnvCache } from "@repo/config/env";
import { createLead, createUser, createWorkspace, resetDatabase, setPlan } from "./helpers";

async function addMember(organizationId: string, role: "OWNER" | "ADMIN" | "MEMBER" = "MEMBER") {
  const user = await createUser("Teammate");
  await prisma.membership.create({ data: { organizationId, userId: user.id, role } });
  return user;
}

describe("workspace export", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("includes the workspace's data and never its secrets", async () => {
    const { ctx, organizationId } = await createWorkspace("Export Co");
    await setPlan(organizationId, "scale"); // API keys are a Scale feature
    await createLead(ctx, { name: "Exported Cafe" });
    await prisma.integration.create({ data: { organizationId: ctx.organizationId, category: "EMAIL", provider: "resend", status: "CONNECTED", encryptedCredentials: "super-secret-ciphertext" } });
    const { key: raw } = await createApiKey(ctx, { name: "CI", scopes: ["read"] });

    const data = await exportWorkspaceData(ctx);
    const text = JSON.stringify(data);
    expect(data.leads.map((lead) => lead.name)).toContain("Exported Cafe");
    expect(data.organization.name).toBe("Export Co");
    expect(text).not.toContain("super-secret-ciphertext");
    expect(text).not.toContain(raw);
    expect(text).not.toContain("hashedKey");
  });

  it("only exports the caller's own workspace", async () => {
    const a = await createWorkspace("Alpha Co");
    const b = await createWorkspace("Beta Co");
    await createLead(b.ctx, { name: "Not yours" });
    const data = await exportWorkspaceData(a.ctx);
    expect(data.leads).toHaveLength(0);
  });
});

describe("workspace deletion", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("requires the owner and the exact name, then hides the workspace and revokes keys", async () => {
    const { ctx, organizationId, userId } = await createWorkspace("Doomed Co");
    await setPlan(organizationId, "scale");
    const { key: raw } = await createApiKey(ctx, { name: "Key", scopes: ["read"] });
    const admin = createTenantContext({ organizationId, userId, role: "ADMIN" });

    await expect(deleteWorkspace(admin, { confirmName: "Doomed Co" })).rejects.toThrow();
    await expect(deleteWorkspace(ctx, { confirmName: "doomed" })).rejects.toThrow(/exactly/);

    const result = await deleteWorkspace(ctx, { confirmName: "Doomed Co" });
    expect(result.purgeAfterDays).toBe(WORKSPACE_PURGE_DAYS);
    expect(await resolveMembership(userId)).toBeNull();
    expect(await authenticateApiKey(raw)).toBeNull();
    const logs = await prisma.auditLog.findMany({ where: { organizationId, action: "workspace.deleted" } });
    expect(logs).toHaveLength(1);
  });

  it("refuses while a Stripe subscription is still renewing", async () => {
    const { ctx, organizationId } = await createWorkspace("Paying Co");
    await prisma.subscription.update({ where: { organizationId }, data: { billingProvider: "stripe", providerSubscriptionId: `sub_${organizationId}`, status: "ACTIVE", cancelAtPeriodEnd: false } });
    await expect(deleteWorkspace(ctx, { confirmName: "Paying Co" })).rejects.toThrow(/Cancel the paid plan/);
    await prisma.subscription.update({ where: { organizationId }, data: { cancelAtPeriodEnd: true } });
    await expect(deleteWorkspace(ctx, { confirmName: "Paying Co" })).resolves.toMatchObject({ deleted: true });
  });

  it("can be restored within the grace period and is purged after it", async () => {
    const kept = await createWorkspace("Restored Co");
    const purged = await createWorkspace("Purged Co");
    await createLead(purged.ctx, { name: "Gone soon" });
    await deleteWorkspace(kept.ctx, { confirmName: "Restored Co" });
    await deleteWorkspace(purged.ctx, { confirmName: "Purged Co" });

    await restoreWorkspace(kept.organizationId);
    expect((await resolveMembership(kept.userId))?.organizationId).toBe(kept.organizationId);

    const later = new Date(Date.now() + (WORKSPACE_PURGE_DAYS + 1) * 86_400_000);
    expect(await purgeDeletedWorkspaces(later)).toEqual({ purged: 1 });
    expect(await prisma.organization.findUnique({ where: { id: purged.organizationId } })).toBeNull();
    expect(await prisma.lead.count({ where: { organizationId: purged.organizationId } })).toBe(0);
    expect(await prisma.organization.findUnique({ where: { id: kept.organizationId } })).not.toBeNull();
  });
});

describe("account deletion", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("deletes solo workspaces with the account and leaves shared ones", async () => {
    const solo = await createWorkspace("Solo Co");
    const shared = await createWorkspace("Shared Co");
    // The solo user is also a member of someone else's workspace.
    await prisma.membership.create({ data: { organizationId: shared.organizationId, userId: solo.userId, role: "MEMBER" } });

    const plan = await accountDeletionPlan(solo.userId);
    expect(plan.deletesWorkspaces.map((item) => item.name)).toEqual(["Solo Co"]);
    expect(plan.leaves.map((item) => item.name)).toEqual(["Shared Co"]);
    expect(plan.blocking).toEqual([]);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: solo.userId } });
    await expect(deleteAccount(solo.userId, { confirmEmail: "wrong@example.test" })).rejects.toThrow(/exactly/);
    await deleteAccount(solo.userId, { confirmEmail: user.email.toUpperCase() });

    expect(await prisma.user.findUnique({ where: { id: solo.userId } })).toBeNull();
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: solo.organizationId } })).deletedAt).not.toBeNull();
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: shared.organizationId } })).deletedAt).toBeNull();
    expect(await prisma.membership.count({ where: { organizationId: shared.organizationId } })).toBe(1);
  });

  it("is blocked while the user is the only owner of a shared workspace", async () => {
    const { userId, organizationId } = await createWorkspace("Team Co");
    await addMember(organizationId);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect((await accountDeletionPlan(userId)).blocking.map((item) => item.name)).toEqual(["Team Co"]);
    await expect(deleteAccount(userId, { confirmEmail: user.email })).rejects.toThrow(/owner/);

    // A second owner unblocks it.
    await addMember(organizationId, "OWNER");
    await expect(deleteAccount(userId, { confirmEmail: user.email })).resolves.toMatchObject({ deleted: true, workspacesDeleted: 0 });
  });
});

describe("audit log", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("lists newest first with actor names, filters and pages, admins only", async () => {
    const { ctx, organizationId, userId } = await createWorkspace("Audit Co");
    // Several entries share a millisecond in real requests; paging must not skip or repeat them.
    for (let index = 0; index < 5; index += 1) await audit(ctx, { action: `billing.test_${index}`, resourceType: "subscription" });
    await new Promise((resolve) => setTimeout(resolve, 15));
    await audit(ctx, { action: "scoring.updated", resourceType: "scoring_profile" });

    const first = await listAuditLogs(ctx, { limit: 4 });
    expect(first.items).toHaveLength(4);
    expect(first.items[0]?.action).toBe("scoring.updated");
    expect(first.items[0]?.actor).toBe("Test User");
    expect(first.nextCursor).not.toBeNull();
    const second = await listAuditLogs(ctx, { limit: 4, cursor: first.nextCursor ?? undefined });
    const seen = [...first.items, ...second.items].map((item) => item.id);
    expect(new Set(seen).size).toBe(6);
    expect(second.nextCursor).toBeNull();

    const billing = await listAuditLogs(ctx, { action: "billing" });
    expect(billing.items.every((item) => item.action.startsWith("billing."))).toBe(true);

    const member = createTenantContext({ organizationId, userId, role: "MEMBER" });
    await expect(listAuditLogs(member)).rejects.toThrow();
  });
});

describe("platform admin", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("only recognises listed emails", () => {
    process.env.PLATFORM_ADMIN_EMAILS = " Boss@Example.com , ops@example.com";
    resetEnvCache();
    expect(isPlatformAdmin("boss@example.com")).toBe(true);
    expect(isPlatformAdmin("OPS@example.com")).toBe(true);
    expect(isPlatformAdmin("someone@example.com")).toBe(false);
    expect(isPlatformAdmin(null)).toBe(false);
    process.env.PLATFORM_ADMIN_EMAILS = "";
    resetEnvCache();
    expect(isPlatformAdmin("boss@example.com")).toBe(false);
  });

  it("sees every workspace, including deleted ones", async () => {
    const a = await createWorkspace("Alpha");
    const b = await createWorkspace("Beta");
    await createLead(a.ctx, { name: "Lead" });
    await deleteWorkspace(b.ctx, { confirmName: "Beta" });

    const overview = await getPlatformOverview();
    expect(overview.totals.workspaces).toBe(1);
    expect(overview.totals.deletedWorkspaces).toBe(1);
    expect(overview.totals.leads).toBe(1);
    expect(overview.workspaces.map((item) => item.name).sort()).toEqual(["Alpha", "Beta"]);
    expect(overview.workspaces.find((item) => item.name === "Beta")?.deletedAt).not.toBeNull();
    expect(overview.users).toHaveLength(2);
  });
});
