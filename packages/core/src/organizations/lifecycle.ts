import { prisma } from "@repo/db";
import { z } from "zod";
import { audit } from "../audit";
import { hasLiveStripeSubscription } from "../billing/payments";
import { assertCan, systemContext, type TenantContext } from "../context";
import { PreconditionError, ValidationError } from "../errors";
import { logger } from "../logger";

/**
 * Workspace and account lifecycle: full data export, workspace deletion (soft, purged after a
 * grace period) and self-serve account deletion.
 */

/** Deleted workspaces can be restored by a platform admin for this long, then they're purged. */
export const WORKSPACE_PURGE_DAYS = 30;

// ----------------------------------------------------------------------------- Export

/**
 * Everything the workspace owns, as one JSON document. Secrets never leave: integration
 * credentials, webhook secrets and API key hashes are left out.
 */
export async function exportWorkspaceData(ctx: TenantContext) {
  assertCan(ctx, "workspace:manage");
  const db = ctx.db;
  const [organization, members, businessProfile, offerings, pricingRules, scoringProfile, complianceSettings, leads, contacts, leadScores, campaigns, campaignLeads, conversations, messages, calls, deals, tasks, notes, meetings, quotes, workflows, workflowExecutions, suppressions, events, auditLogs, invoices, payments] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { id: true, name: true, slug: true, timezone: true, currency: true, createdAt: true } }),
    db.membership.findMany({ select: { role: true, createdAt: true, user: { select: { name: true, email: true } } } }),
    db.businessProfile.findFirst(),
    db.offering.findMany(),
    db.pricingRule.findMany(),
    db.scoringProfile.findFirst(),
    db.complianceSettings.findFirst(),
    db.lead.findMany({ where: { deletedAt: null } }),
    db.contact.findMany({ where: { deletedAt: null } }),
    db.leadScore.findMany(),
    db.campaign.findMany(),
    db.campaignLead.findMany(),
    db.conversation.findMany(),
    db.message.findMany(),
    db.call.findMany(),
    db.deal.findMany({ where: { deletedAt: null } }),
    db.task.findMany(),
    db.note.findMany({ where: { deletedAt: null } }),
    db.meeting.findMany(),
    db.quote.findMany({ include: { lineItems: true } }),
    db.workflow.findMany(),
    db.workflowExecution.findMany({ take: 5000, orderBy: { createdAt: "desc" } }),
    db.suppression.findMany(),
    db.event.findMany({ take: 50_000, orderBy: { occurredAt: "desc" } }),
    db.auditLog.findMany({ take: 10_000, orderBy: { createdAt: "desc" } }),
    db.invoice.findMany(),
    db.payment.findMany(),
  ]);
  await audit(ctx, { action: "workspace.exported", resourceType: "organization", resourceId: ctx.organizationId, metadata: { leads: leads.length, events: events.length } });
  return {
    exportedAt: new Date().toISOString(),
    format: "reachly-workspace-export/v1",
    organization,
    members,
    businessProfile,
    offerings,
    pricingRules,
    scoringProfile,
    complianceSettings,
    leads,
    contacts,
    leadScores,
    campaigns,
    campaignLeads,
    conversations,
    messages,
    calls,
    deals,
    tasks,
    notes,
    meetings,
    quotes,
    workflows,
    workflowExecutions,
    suppressions,
    events,
    auditLogs,
    invoices,
    payments,
  };
}

// ----------------------------------------------------------------------------- Delete workspace

export const deleteWorkspaceSchema = z.object({ confirmName: z.string().trim().min(1) });

async function assertNoLiveSubscription(organizationId: string) {
  const subscription = await prisma.subscription.findUnique({ where: { organizationId } });
  if (subscription && hasLiveStripeSubscription(subscription) && !subscription.cancelAtPeriodEnd) {
    throw new PreconditionError("Cancel the paid plan in Billing before deleting this workspace, so you aren't charged again");
  }
}

async function softDeleteOrganization(organizationId: string) {
  const now = new Date();
  await prisma.$transaction([
    prisma.organization.update({ where: { id: organizationId }, data: { deletedAt: now } }),
    // Keys stop working immediately; invitations can no longer be accepted.
    prisma.apiKey.updateMany({ where: { organizationId, revokedAt: null }, data: { revokedAt: now } }),
    prisma.invitation.deleteMany({ where: { organizationId } }),
    prisma.user.updateMany({ where: { defaultOrganizationId: organizationId }, data: { defaultOrganizationId: null } }),
  ]);
}

/** Owner only. The workspace disappears at once and is purged after the grace period. */
export async function deleteWorkspace(ctx: TenantContext, input: z.input<typeof deleteWorkspaceSchema>) {
  assertCan(ctx, "billing:manage");
  const { confirmName } = deleteWorkspaceSchema.parse(input);
  const organization = await prisma.organization.findFirstOrThrow({ where: { id: ctx.organizationId, deletedAt: null } });
  if (confirmName !== organization.name.trim()) throw new ValidationError("Type the workspace name exactly to confirm");
  await assertNoLiveSubscription(organization.id);
  await audit(ctx, { action: "workspace.deleted", resourceType: "organization", resourceId: organization.id, metadata: { name: organization.name, purgeAfterDays: WORKSPACE_PURGE_DAYS } });
  await softDeleteOrganization(organization.id);
  logger.info({ organizationId: organization.id }, "workspace soft-deleted");
  return { deleted: true, purgeAfterDays: WORKSPACE_PURGE_DAYS };
}

// ----------------------------------------------------------------------------- Delete account

export const deleteAccountSchema = z.object({ confirmEmail: z.string().trim().toLowerCase().email() });

/** What deleting this account would do — shown before the user confirms. */
export async function accountDeletionPlan(userId: string) {
  const memberships = await prisma.membership.findMany({
    where: { userId, organization: { deletedAt: null } },
    include: { organization: { select: { id: true, name: true, _count: { select: { memberships: true } } } } },
  });
  const deletesWorkspaces = memberships.filter((membership) => membership.organization._count.memberships === 1).map((membership) => ({ id: membership.organization.id, name: membership.organization.name }));
  const blocking: Array<{ id: string; name: string }> = [];
  for (const membership of memberships) {
    if (membership.role !== "OWNER" || membership.organization._count.memberships === 1) continue;
    const otherOwners = await prisma.membership.count({ where: { organizationId: membership.organizationId, role: "OWNER", userId: { not: userId } } });
    if (otherOwners === 0) blocking.push({ id: membership.organization.id, name: membership.organization.name });
  }
  const leaves = memberships.filter((membership) => membership.organization._count.memberships > 1).map((membership) => ({ id: membership.organization.id, name: membership.organization.name }));
  return { deletesWorkspaces, leaves, blocking };
}

/**
 * Deletes the user, their sessions and memberships. Workspaces where they are the only member are
 * deleted with them; owning a shared workspace without another owner blocks deletion.
 */
export async function deleteAccount(userId: string, input: z.input<typeof deleteAccountSchema>) {
  const { confirmEmail } = deleteAccountSchema.parse(input);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (confirmEmail !== user.email.toLowerCase()) throw new ValidationError("Type your email address exactly to confirm");
  const plan = await accountDeletionPlan(userId);
  if (plan.blocking.length) {
    throw new PreconditionError(`Make someone else an owner of ${plan.blocking.map((item) => `"${item.name}"`).join(", ")} first, or delete ${plan.blocking.length > 1 ? "those workspaces" : "that workspace"}`);
  }
  for (const workspace of plan.deletesWorkspaces) await assertNoLiveSubscription(workspace.id);

  for (const workspace of plan.deletesWorkspaces) {
    await audit(systemContext(workspace.id, { type: "USER", id: userId }), { action: "workspace.deleted", resourceType: "organization", resourceId: workspace.id, metadata: { name: workspace.name, reason: "owner_account_deleted" } });
    await softDeleteOrganization(workspace.id);
  }
  for (const workspace of plan.leaves) {
    await audit(systemContext(workspace.id, { type: "USER", id: userId }), { action: "member.account_deleted", resourceType: "user", resourceId: userId, metadata: { email: user.email } });
  }
  // Sessions, OAuth accounts and memberships cascade; records they authored keep a null author.
  await prisma.user.delete({ where: { id: userId } });
  logger.info({ userId, workspacesDeleted: plan.deletesWorkspaces.length }, "account deleted");
  return { deleted: true, workspacesDeleted: plan.deletesWorkspaces.length };
}

// ----------------------------------------------------------------------------- Purge & restore

/** Hard-deletes workspaces whose grace period has passed. Called by the daily maintenance job. */
export async function purgeDeletedWorkspaces(now: Date = new Date()) {
  const cutoff = new Date(now.getTime() - WORKSPACE_PURGE_DAYS * 86_400_000);
  const due = await prisma.organization.findMany({ where: { deletedAt: { lt: cutoff } }, select: { id: true } });
  for (const organization of due) await prisma.organization.delete({ where: { id: organization.id } });
  return { purged: due.length };
}

export async function restoreWorkspace(organizationId: string) {
  const organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  if (!organization.deletedAt) return organization;
  const restored = await prisma.organization.update({ where: { id: organizationId }, data: { deletedAt: null } });
  await audit(systemContext(organizationId, { type: "SYSTEM" }), { action: "workspace.restored", resourceType: "organization", resourceId: organizationId });
  return restored;
}
