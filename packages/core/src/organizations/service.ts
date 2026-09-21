import type { MemberRole } from "@repo/config";
import { prisma, type Prisma } from "@repo/db";
import { ensureSubscription } from "../billing/subscription";
import { ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { DEFAULT_SCORING_WEIGHTS } from "../leads/scoring-defaults";
import { slugify } from "../shared/text";

export interface CreateOrganizationInput {
  userId: string;
  name: string;
  timezone?: string;
  currency?: string;
  country?: string;
}

async function uniqueSlug(base: string): Promise<string> {
  const root = slugify(base);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = attempt === 0 ? root : `${root}-${Math.random().toString(36).slice(2, 6)}`;
    const taken = await prisma.organization.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  throw new ValidationError("Could not allocate a workspace URL, try a different name");
}

/**
 * Creates a workspace with its owner membership, default subscription, compliance
 * settings and scoring profile. Used at sign-up/onboarding and when creating extra workspaces.
 */
export async function createOrganization(input: CreateOrganizationInput) {
  const name = input.name.trim();
  if (name.length < 2) throw new ValidationError("Workspace name must be at least 2 characters");
  const slug = await uniqueSlug(name);

  const organization = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: {
        name,
        slug,
        timezone: input.timezone ?? "Asia/Kolkata",
        currency: input.currency ?? "INR",
        country: input.country ?? null,
      },
    });
    await tx.membership.create({ data: { organizationId: org.id, userId: input.userId, role: "OWNER" } });
    await tx.complianceSettings.create({ data: { organizationId: org.id } });
    await tx.scoringProfile.create({
      data: { organizationId: org.id, weights: DEFAULT_SCORING_WEIGHTS as Prisma.InputJsonValue },
    });
    await tx.user.update({ where: { id: input.userId }, data: { defaultOrganizationId: org.id } });
    return org;
  });

  await ensureSubscription(organization.id);
  return organization;
}

export async function listMemberships(userId: string) {
  return prisma.membership.findMany({
    where: { userId, organization: { deletedAt: null } },
    include: {
      organization: {
        select: { id: true, name: true, slug: true, logoUrl: true, onboardingCompleted: true, currency: true, timezone: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Picks the workspace a user is acting in: the requested one if they're a member,
 * else their default, else their oldest membership. Returns null if they have none.
 */
export async function resolveMembership(userId: string, preferredOrganizationId?: string | null) {
  const memberships = await listMemberships(userId);
  if (memberships.length === 0) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { defaultOrganizationId: true } });
  return (
    memberships.find((m) => m.organizationId === preferredOrganizationId) ??
    memberships.find((m) => m.organizationId === user?.defaultOrganizationId) ??
    memberships[0] ??
    null
  );
}

export async function switchOrganization(userId: string, organizationId: string) {
  const membership = await prisma.membership.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
  });
  if (!membership) throw new ForbiddenError("You are not a member of that workspace");
  await prisma.user.update({ where: { id: userId }, data: { defaultOrganizationId: organizationId } });
  return membership;
}

export async function getOrganization(organizationId: string) {
  const organization = await prisma.organization.findFirst({ where: { id: organizationId, deletedAt: null } });
  if (!organization) throw new NotFoundError("Workspace", organizationId);
  return organization;
}

export async function listMembers(organizationId: string) {
  return prisma.membership.findMany({
    where: { organizationId },
    include: { user: { select: { id: true, name: true, email: true, image: true } } },
    orderBy: { createdAt: "asc" },
  });
}

export type { MemberRole };
