import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@repo/db";
import { changePlan, getBillingOverview } from "../../src/billing/overview";
import { getComplianceSettings, updateOutreachCompliance } from "../../src/compliance/settings";
import { createTenantContext } from "../../src/context";
import { decryptJson } from "../../src/crypto";
import { ConflictError, ForbiddenError, PreconditionError, ValidationError } from "../../src/errors";
import { connectIntegration, disconnectIntegration, listIntegrations, testIntegration } from "../../src/integrations/manage";
import { getProviderStatuses } from "../../src/integrations/status";
import { resolveLeadProvider } from "../../src/leads/providers";
import { submitContactRequest } from "../../src/marketing/contact";
import { acceptInvitation, changeMemberRole, inviteMember, listTeam, previewInvitation, removeMember, revokeInvitation } from "../../src/organizations/members";
import { getWorkspaceSettings, updateWorkspaceSettings } from "../../src/organizations/settings";
import { getSystemHealth } from "../../src/system/health";
import { createUser, createWorkspace, resetDatabase, setPlan } from "./helpers";

/** Invitation emails go through the mock provider; pull the token out of the logged link. */
async function inviteAndGetToken(ctx: Parameters<typeof inviteMember>[0], email: string, role: "ADMIN" | "MEMBER" | "VIEWER" = "MEMBER") {
  const platform = await import("../../src/email/platform");
  const spy = vi.spyOn(platform, "sendTransactionalEmail");
  await inviteMember(ctx, { email, role });
  const sent = spy.mock.calls.at(-1)?.[0];
  spy.mockRestore();
  const token = sent?.text.match(/\/invite\/([A-Za-z0-9_-]+)/)?.[1];
  if (!token) throw new Error("no invitation link was sent");
  return token;
}

describe("workspace settings", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("updates name, time zone and currency, and rejects invalid values", async () => {
    const { ctx } = await createWorkspace("Settings Co");
    const updated = await updateWorkspaceSettings(ctx, { name: "Settings Co India", timezone: "Asia/Kolkata", currency: "INR", country: "India" });
    expect(updated).toMatchObject({ name: "Settings Co India", timezone: "Asia/Kolkata", currency: "INR", country: "India" });
    expect((await getWorkspaceSettings(ctx)).currencies).toContain("USD");
    await expect(updateWorkspaceSettings(ctx, { name: "X Co", timezone: "Mars/Olympus", currency: "INR" })).rejects.toThrow();
    await expect(updateWorkspaceSettings(ctx, { name: "X Co", timezone: "UTC", currency: "XYZ" })).rejects.toThrow();
    const audit = await ctx.db.auditLog.findFirst({ where: { action: "workspace.updated" } });
    expect(audit?.metadata).toMatchObject({ changed: expect.arrayContaining(["name", "country"]) });
  });

  it("is read-only for members", async () => {
    const { ctx, organizationId } = await createWorkspace("Readonly Co");
    const member = await createUser("Member");
    await prisma.membership.create({ data: { organizationId, userId: member.id, role: "MEMBER" } });
    const memberCtx = createTenantContext({ organizationId, userId: member.id, role: "MEMBER" });
    await expect(updateWorkspaceSettings(memberCtx, { name: "Hijacked", timezone: "UTC", currency: "USD" })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await getWorkspaceSettings(ctx)).name).toBe("Readonly Co");
  });
});

describe("team and invitations", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("invites by email, accepts with the matching account, and changes roles", async () => {
    const { ctx, organizationId } = await createWorkspace("Team Co");
    await setPlan(organizationId, "pro");
    const invitee = await createUser("Priya");
    const token = await inviteAndGetToken(ctx, invitee.email, "MEMBER");

    // Only a hash is stored.
    const stored = await ctx.db.invitation.findFirstOrThrow();
    expect(stored.tokenHash).not.toBe(token);
    expect(await previewInvitation(token)).toMatchObject({ state: "valid", workspace: "Team Co", role: "MEMBER" });

    const stranger = await createUser("Someone else");
    await expect(acceptInvitation(stranger.id, token)).rejects.toBeInstanceOf(ForbiddenError);

    const accepted = await acceptInvitation(invitee.id, token);
    expect(accepted.organizationId).toBe(organizationId);
    await expect(acceptInvitation(invitee.id, token)).rejects.toBeInstanceOf(PreconditionError);
    expect(await previewInvitation(token)).toMatchObject({ state: "used" });

    const team = await listTeam(ctx);
    expect(team.members).toHaveLength(2);
    expect(team.invitations).toHaveLength(0);
    const membership = team.members.find((member) => member.user.id === invitee.id)!;
    await changeMemberRole(ctx, membership.id, { role: "ADMIN" });
    expect((await listTeam(ctx)).members.find((member) => member.id === membership.id)?.role).toBe("ADMIN");
  });

  it("enforces seats, duplicates, revocation and the last owner", async () => {
    const { ctx, organizationId } = await createWorkspace("Seats Co");
    // Free plan: one seat, already taken by the owner.
    await expect(inviteMember(ctx, { email: "new@example.test", role: "MEMBER" })).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });

    await setPlan(organizationId, "pro");
    const owner = (await listTeam(ctx)).members[0]!;
    const ownerEmail = owner.user.email;
    await expect(inviteMember(ctx, { email: ownerEmail, role: "MEMBER" })).rejects.toBeInstanceOf(ConflictError);

    const token = await inviteAndGetToken(ctx, "later@example.test");
    const invitation = (await listTeam(ctx)).invitations[0]!;
    await revokeInvitation(ctx, invitation.id);
    expect(await previewInvitation(token)).toMatchObject({ state: "revoked" });

    // The only owner can't be demoted or removed.
    await expect(changeMemberRole(ctx, owner.id, { role: "ADMIN" })).rejects.toBeInstanceOf(PreconditionError);
    await expect(removeMember(ctx, owner.id)).rejects.toBeInstanceOf(PreconditionError);
  });

  it("stops admins from creating owners and lets members leave", async () => {
    const { organizationId } = await createWorkspace("Roles Co");
    await setPlan(organizationId, "pro");
    const admin = await createUser("Admin");
    const member = await createUser("Member");
    await prisma.membership.createMany({ data: [{ organizationId, userId: admin.id, role: "ADMIN" }, { organizationId, userId: member.id, role: "MEMBER" }] });
    const adminCtx = createTenantContext({ organizationId, userId: admin.id, role: "ADMIN" });
    const memberCtx = createTenantContext({ organizationId, userId: member.id, role: "MEMBER" });

    await expect(inviteMember(adminCtx, { email: "boss@example.test", role: "OWNER" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(inviteMember(memberCtx, { email: "friend@example.test", role: "MEMBER" })).rejects.toBeInstanceOf(ForbiddenError);

    const memberMembership = await prisma.membership.findFirstOrThrow({ where: { organizationId, userId: member.id } });
    await removeMember(memberCtx, memberMembership.id);
    expect(await prisma.membership.count({ where: { organizationId } })).toBe(2);
  });
});

describe("integrations", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("encrypts secrets, never returns them, keeps them on blank updates and uses the connection", async () => {
    const { ctx } = await createWorkspace("Connect Co");
    await expect(connectIntegration(ctx, "google_places", { values: {} })).rejects.toBeInstanceOf(ValidationError);
    await connectIntegration(ctx, "google_places", { values: { apiKey: "places-secret-123" } });

    const row = await ctx.db.integration.findFirstOrThrow({ where: { provider: "google_places" } });
    expect(row.encryptedCredentials).not.toContain("places-secret-123");
    expect(decryptJson<Record<string, string>>(row.encryptedCredentials!)).toEqual({ apiKey: "places-secret-123" });

    const view = (await listIntegrations(ctx)).providers.find((provider) => provider.provider === "google_places")!;
    expect(JSON.stringify(view)).not.toContain("places-secret-123");
    expect(view.connection).toMatchObject({ status: "CONNECTED", secretsSet: ["apiKey"] });
    expect((await getProviderStatuses(ctx)).find((status) => status.category === "LEAD_DATA")).toMatchObject({ mode: "connected", provider: "google_places" });
    expect((await resolveLeadProvider(ctx)).name).toBe("google_places");

    // Updating config without re-entering the key keeps the key.
    await connectIntegration(ctx, "resend", { values: { apiKey: "re_secret", fromEmail: "hello@connect.test" } });
    await connectIntegration(ctx, "resend", { values: { apiKey: "", fromEmail: "sales@connect.test", fromName: "Connect Co" } });
    const resend = await ctx.db.integration.findFirstOrThrow({ where: { provider: "resend" } });
    expect(decryptJson<Record<string, string>>(resend.encryptedCredentials!)).toMatchObject({ apiKey: "re_secret" });
    expect(resend.config).toMatchObject({ fromEmail: "sales@connect.test", fromName: "Connect Co" });
    await expect(connectIntegration(ctx, "resend", { values: { fromEmail: "not-an-email" } })).rejects.toBeInstanceOf(ValidationError);

    // A newly connected provider in the same category becomes the default.
    await connectIntegration(ctx, "sendgrid", { values: { apiKey: "SG.secret", fromEmail: "hello@connect.test" } });
    const defaults = await ctx.db.integration.findMany({ where: { category: "EMAIL" }, select: { provider: true, isDefault: true } });
    expect(defaults.find((item) => item.provider === "sendgrid")?.isDefault).toBe(true);
    expect(defaults.find((item) => item.provider === "resend")?.isDefault).toBe(false);

    await disconnectIntegration(ctx, "google_places");
    const disconnected = await ctx.db.integration.findFirstOrThrow({ where: { provider: "google_places" } });
    expect(disconnected).toMatchObject({ status: "DISCONNECTED", encryptedCredentials: null });
    expect((await resolveLeadProvider(ctx)).name).toBe("mock");
  });

  it("tests Slack by posting a message, and needs admin rights", async () => {
    const { ctx, organizationId } = await createWorkspace("Slack Co");
    await connectIntegration(ctx, "slack", { values: { webhookUrl: "https://hooks.slack.test/services/abc" } });
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      expect(await testIntegration(ctx, "slack")).toMatchObject({ ok: true });
      expect(fetchMock).toHaveBeenCalledWith("https://hooks.slack.test/services/abc", expect.objectContaining({ method: "POST" }));
    } finally {
      vi.unstubAllGlobals();
    }
    const viewer = await createUser("Viewer");
    await prisma.membership.create({ data: { organizationId, userId: viewer.id, role: "VIEWER" } });
    const viewerCtx = createTenantContext({ organizationId, userId: viewer.id, role: "VIEWER" });
    await expect(connectIntegration(viewerCtx, "slack", { values: { webhookUrl: "https://hooks.slack.test/x" } })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("compliance, billing and health", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("saves outreach guardrails and validates the sending window", async () => {
    const { ctx } = await createWorkspace("Rules Co");
    const saved = await updateOutreachCompliance(ctx, {
      postalAddress: "12 MG Road, Bengaluru",
      emailFooter: "Sent by Rules Co",
      requireApprovalFirstTouch: false,
      whatsappRequireOptIn: true,
      quietHours: { start: 10, end: 18, days: [1, 2, 3, 4, 5, 6] },
      optOutKeywords: ["STOP", "stop", "unsubscribe"],
    });
    expect(saved).toMatchObject({ postalAddress: "12 MG Road, Bengaluru", requireApprovalFirstTouch: false, quietHours: { start: 10, end: 18 }, optOutKeywords: ["stop", "unsubscribe"] });
    expect((await getComplianceSettings(ctx)).includeUnsubscribeLink).toBe(true);
    await expect(updateOutreachCompliance(ctx, { requireApprovalFirstTouch: true, whatsappRequireOptIn: true, quietHours: { start: 18, end: 9, days: [1] }, optOutKeywords: ["stop"] })).rejects.toThrow();
  });

  it("shows usage and switches plans only when payments are not configured", async () => {
    const { ctx } = await createWorkspace("Plan Co");
    const before = await getBillingOverview(ctx);
    expect(before.plan.key).toBe("free");
    expect(before.plans.map((plan) => plan.key)).toEqual(["free", "pro", "scale"]);
    expect(before.usage.metrics.length).toBeGreaterThan(0);

    const after = await changePlan(ctx, "pro");
    expect(after.plan.key).toBe("pro");
    expect(await ctx.db.auditLog.findFirst({ where: { action: "billing.plan_changed" } })).not.toBeNull();
  });

  it("reports health without leaking other workspaces' job data", async () => {
    const { ctx } = await createWorkspace("Health Co");
    const health = await getSystemHealth(ctx);
    expect(health.checks.find((check) => check.key === "database")?.state).toBe("ok");
    expect(health.queue.driver).toBe("inline");
    expect(health.failures).toEqual({ workflows: 0, webhookDeliveries: 0, messages: 0, inboundWebhooks: 0 });
    const { recordDeadLetter } = await import("../../src/jobs/dead-letter");
    recordDeadLetter({ jobId: "x", name: "messages.send", error: "boom", attempts: 5, data: { organizationId: "00000000-0000-0000-0000-000000000000" } });
    recordDeadLetter({ jobId: "y", name: "messages.send", error: "mine", attempts: 5, data: { organizationId: ctx.organizationId } });
    const again = await getSystemHealth(ctx);
    expect(again.failedJobs.map((job) => job.error)).toEqual(["mine"]);
  });
});

describe("contact form", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("stores messages with a hashed IP, ignores bots and duplicates", async () => {
    const first = await submitContactRequest({ name: "Asha", email: " Asha@Example.com ", topic: "SALES", message: "We'd like to try WhatsApp outreach." }, { ip: "203.0.113.9" });
    expect(first.id).toBeTruthy();
    const row = await prisma.contactRequest.findUniqueOrThrow({ where: { id: first.id! } });
    expect(row.email).toBe("asha@example.com");
    expect(row.ipHash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.ipHash).not.toContain("203.0.113.9");

    const duplicate = await submitContactRequest({ name: "Asha", email: "asha@example.com", topic: "SALES", message: "We'd like to try WhatsApp outreach." });
    expect(duplicate.id).toBe(first.id);

    const bot = await submitContactRequest({ name: "Bot", email: "bot@example.com", topic: "OTHER", message: "Buy cheap followers now!!!", website: "http://spam.example" });
    expect(bot.id).toBeNull();
    expect(await prisma.contactRequest.count()).toBe(1);

    await expect(submitContactRequest({ name: "A", email: "nope", topic: "SALES", message: "short" })).rejects.toThrow();
  });
});
