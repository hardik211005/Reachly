import { z } from "zod";
import { brand, MEMBER_ROLES, type MemberRole } from "@repo/config";
import { getEnv } from "@repo/config/env";
import { prisma } from "@repo/db";
import { audit } from "../audit";
import { assertCan, type TenantContext } from "../context";
import { hashToken, randomToken } from "../crypto";
import { sendTransactionalEmail, simpleEmailHtml } from "../email/platform";
import { assertResourceLimit, resolvePlan } from "../billing/plans";
import { ConflictError, ForbiddenError, NotFoundError, PreconditionError } from "../errors";
import { logger } from "../logger";
import { assignableRoles } from "../rbac";

/**
 * Team management: members, roles and email invitations. Invitation tokens are random,
 * emailed once and stored only as a SHA-256 hash. Owners can't be removed or demoted if
 * they're the last one, and members can only assign roles at or below their own.
 */

const INVITATION_DAYS = 7;

export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().max(200).pipe(z.email("Enter a valid email address")),
  role: z.enum(MEMBER_ROLES).default("MEMBER"),
});
export const roleSchema = z.object({ role: z.enum(MEMBER_ROLES) });

function pendingWhere(now = new Date()) {
  return { acceptedAt: null, revokedAt: null, expiresAt: { gt: now } };
}

export async function listTeam(ctx: TenantContext) {
  assertCan(ctx, "workspace:read");
  const [members, invitations, plan] = await Promise.all([
    ctx.db.membership.findMany({ include: { user: { select: { id: true, name: true, email: true, image: true } } }, orderBy: { createdAt: "asc" } }),
    ctx.db.invitation.findMany({ where: pendingWhere(), orderBy: { createdAt: "desc" } }),
    resolvePlan(ctx),
  ]);
  const inviterIds = [...new Set(invitations.map((invitation) => invitation.invitedById))];
  const inviters = inviterIds.length ? await prisma.user.findMany({ where: { id: { in: inviterIds } }, select: { id: true, name: true } }) : [];
  return {
    members: members.map((member) => ({ id: member.id, role: member.role, joinedAt: member.createdAt, user: member.user, isYou: member.userId === ctx.userId })),
    invitations: invitations.map((invitation) => ({ id: invitation.id, email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt, createdAt: invitation.createdAt, invitedBy: inviters.find((user) => user.id === invitation.invitedById)?.name ?? null })),
    seats: { used: members.length + invitations.length, limit: plan.limits.resources.members },
    assignableRoles: assignableRoles(ctx.role),
  };
}

function assertAssignable(ctx: TenantContext, role: MemberRole) {
  if (!assignableRoles(ctx.role).includes(role)) throw new ForbiddenError(`You can't assign the ${role.toLowerCase()} role`);
}

export async function inviteMember(ctx: TenantContext, input: z.input<typeof inviteSchema>) {
  assertCan(ctx, "members:manage");
  const { email, role } = inviteSchema.parse(input);
  assertAssignable(ctx, role);

  const existingMember = await ctx.db.membership.findFirst({ where: { user: { email: { equals: email, mode: "insensitive" } } }, select: { id: true } });
  if (existingMember) throw new ConflictError(`${email} is already in this workspace`);
  const [members, pending] = await Promise.all([ctx.db.membership.count(), ctx.db.invitation.count({ where: { ...pendingWhere(), email: { not: email } } })]);
  await assertResourceLimit(ctx, "members", members + pending);

  // One live invitation per address: a new invite replaces the old one.
  await ctx.db.invitation.updateMany({ where: { email, ...pendingWhere() }, data: { revokedAt: new Date() } });
  const token = randomToken(32);
  const invitation = await ctx.db.invitation.create({
    data: { organizationId: ctx.organizationId, email, role, tokenHash: hashToken(token), invitedById: ctx.userId ?? ctx.actor.id ?? "system", expiresAt: new Date(Date.now() + INVITATION_DAYS * 86_400_000) },
  });

  const [organization, inviter] = await Promise.all([
    ctx.db.organization.findFirst({ where: { id: ctx.organizationId }, select: { name: true } }),
    ctx.userId ? prisma.user.findUnique({ where: { id: ctx.userId }, select: { name: true } }) : null,
  ]);
  const url = `${getEnv().APP_URL.replace(/\/$/, "")}/invite/${token}`;
  const who = inviter?.name ?? "A teammate";
  const workspace = organization?.name ?? "a workspace";
  await sendTransactionalEmail({
    to: email,
    subject: `${who} invited you to ${workspace} on ${brand.name}`,
    text: `${who} invited you to join ${workspace} on ${brand.name} as ${role.toLowerCase()}.\n\nAccept the invitation: ${url}\n\nThe link expires in ${INVITATION_DAYS} days.`,
    html: simpleEmailHtml(`Join ${workspace}`, `${who} invited you to join ${workspace} on ${brand.name} as ${role.toLowerCase()}. The link expires in ${INVITATION_DAYS} days.`, { label: "Accept invitation", url }),
  }).catch((error: unknown) => logger.error({ err: error, invitationId: invitation.id }, "invitation email failed"));

  await audit(ctx, { action: "member.invited", resourceType: "invitation", resourceId: invitation.id, metadata: { email, role } });
  return { id: invitation.id, email, role, expiresAt: invitation.expiresAt };
}

export async function revokeInvitation(ctx: TenantContext, id: string) {
  assertCan(ctx, "members:manage");
  const invitation = await ctx.db.invitation.findFirst({ where: { id, ...pendingWhere() } });
  if (!invitation) throw new NotFoundError("Invitation", id);
  await ctx.db.invitation.update({ where: { id }, data: { revokedAt: new Date() } });
  await audit(ctx, { action: "member.invitation_revoked", resourceType: "invitation", resourceId: id, metadata: { email: invitation.email } });
}

async function ownerCount(ctx: TenantContext) {
  return ctx.db.membership.count({ where: { role: "OWNER" } });
}

export async function changeMemberRole(ctx: TenantContext, membershipId: string, input: z.input<typeof roleSchema>) {
  assertCan(ctx, "members:manage");
  const { role } = roleSchema.parse(input);
  const member = await ctx.db.membership.findFirst({ where: { id: membershipId } });
  if (!member) throw new NotFoundError("Member", membershipId);
  if (member.role === role) return { id: member.id, role };
  // Changing an owner (or making one) is for owners only.
  if (member.role === "OWNER" && ctx.role !== "OWNER") throw new ForbiddenError("Only owners can change another owner's role");
  assertAssignable(ctx, role);
  if (member.role === "OWNER" && (await ownerCount(ctx)) <= 1) throw new PreconditionError("A workspace needs at least one owner. Make someone else an owner first.");
  const updated = await ctx.db.membership.update({ where: { id: membershipId }, data: { role } });
  await audit(ctx, { action: "member.role_changed", resourceType: "membership", resourceId: membershipId, metadata: { from: member.role, to: role } });
  return { id: updated.id, role: updated.role };
}

export async function removeMember(ctx: TenantContext, membershipId: string) {
  const member = await ctx.db.membership.findFirst({ where: { id: membershipId } });
  if (!member) throw new NotFoundError("Member", membershipId);
  const leaving = member.userId === ctx.userId;
  if (!leaving) assertCan(ctx, "members:manage");
  if (member.role === "OWNER" && !leaving && ctx.role !== "OWNER") throw new ForbiddenError("Only owners can remove an owner");
  if (member.role === "OWNER" && (await ownerCount(ctx)) <= 1) throw new PreconditionError("A workspace needs at least one owner. Make someone else an owner first.");
  await ctx.db.membership.delete({ where: { id: membershipId } });
  await prisma.user.updateMany({ where: { id: member.userId, defaultOrganizationId: ctx.organizationId }, data: { defaultOrganizationId: null } });
  await audit(ctx, { action: leaving ? "member.left" : "member.removed", resourceType: "membership", resourceId: membershipId, metadata: { userId: member.userId, role: member.role } });
}

// ----------------------------------------------------------------------------- Accepting (no workspace context yet)

async function findInvitation(token: string) {
  if (!token || token.length > 200) return null;
  return prisma.invitation.findUnique({ where: { tokenHash: hashToken(token) }, include: { organization: { select: { id: true, name: true, deletedAt: true } } } });
}

export type InvitationState = "valid" | "expired" | "used" | "revoked" | "not_found";
export type InvitationPreview = { state: "not_found" } | { state: Exclude<InvitationState, "not_found">; email: string; role: MemberRole; workspace: string; invitedBy: string | null; expiresAt: Date };

export async function previewInvitation(token: string): Promise<InvitationPreview> {
  const invitation = await findInvitation(token);
  if (!invitation || invitation.organization.deletedAt) return { state: "not_found" };
  const state = invitation.acceptedAt ? "used" : invitation.revokedAt ? "revoked" : invitation.expiresAt <= new Date() ? "expired" : "valid";
  const inviter = await prisma.user.findUnique({ where: { id: invitation.invitedById }, select: { name: true } });
  return { state, email: invitation.email, role: invitation.role, workspace: invitation.organization.name, invitedBy: inviter?.name ?? null, expiresAt: invitation.expiresAt };
}

export async function acceptInvitation(userId: string, token: string) {
  const invitation = await findInvitation(token);
  if (!invitation || invitation.organization.deletedAt) throw new NotFoundError("Invitation");
  if (invitation.acceptedAt) throw new PreconditionError("This invitation has already been used");
  if (invitation.revokedAt) throw new PreconditionError("This invitation was withdrawn. Ask for a new one.");
  if (invitation.expiresAt <= new Date()) throw new PreconditionError("This invitation has expired. Ask for a new one.");
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user) throw new NotFoundError("User", userId);
  if (user.email.toLowerCase() !== invitation.email.toLowerCase()) throw new ForbiddenError(`This invitation is for ${invitation.email}. Sign in with that address to accept it.`);

  const organizationId = invitation.organizationId;
  await prisma.$transaction(async (tx) => {
    // Mark it used first so two clicks can't both succeed.
    const claimed = await tx.invitation.updateMany({ where: { id: invitation.id, acceptedAt: null }, data: { acceptedAt: new Date() } });
    if (!claimed.count) throw new PreconditionError("This invitation has already been used");
    await tx.membership.upsert({ where: { organizationId_userId: { organizationId, userId } }, create: { organizationId, userId, role: invitation.role }, update: {} });
    await tx.user.update({ where: { id: userId }, data: { defaultOrganizationId: organizationId } });
  });
  await prisma.auditLog.create({ data: { organizationId, actorType: "USER", actorId: userId, action: "member.joined", resourceType: "invitation", resourceId: invitation.id, metadata: { role: invitation.role } } }).catch(() => undefined);
  return { organizationId, workspace: invitation.organization.name };
}

