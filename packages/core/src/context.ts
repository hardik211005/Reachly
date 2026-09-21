import type { MemberRole } from "@repo/config";
import { forTenant, prisma, type ActorType, type TenantPrismaClient } from "@repo/db";
import { ForbiddenError } from "./errors";
import { roleHas, scopesAllow, type Permission } from "./rbac";

/**
 * Everything a domain service needs to act on behalf of someone inside one tenant.
 * Services take a TenantContext as their first argument and only ever use `ctx.db`,
 * which is scoped to `ctx.organizationId` (see packages/db/src/tenant.ts).
 */
export interface TenantContext {
  organizationId: string;
  actor: {
    type: ActorType;
    /** User id, API key id, workflow execution id… depending on type. */
    id: string | null;
  };
  /** The acting user, when there is one (null for API keys, workflows, system jobs). */
  userId: string | null;
  role: MemberRole;
  /** API key scopes, when the actor is an API key. */
  scopes?: readonly string[];
  requestId?: string;
  db: TenantPrismaClient;
}

export interface CreateContextInput {
  organizationId: string;
  userId?: string | null;
  role: MemberRole;
  actorType?: ActorType;
  actorId?: string | null;
  scopes?: readonly string[];
  requestId?: string;
}

export function createTenantContext(input: CreateContextInput): TenantContext {
  const actorType = input.actorType ?? (input.userId ? "USER" : "SYSTEM");
  return {
    organizationId: input.organizationId,
    userId: input.userId ?? null,
    role: input.role,
    actor: { type: actorType, id: input.actorId ?? input.userId ?? null },
    scopes: input.scopes,
    requestId: input.requestId,
    db: forTenant(prisma, input.organizationId),
  };
}

/** Context for background jobs and webhooks acting on the system's behalf. */
export function systemContext(
  organizationId: string,
  actor: { type: ActorType; id?: string | null } = { type: "SYSTEM" },
): TenantContext {
  return createTenantContext({
    organizationId,
    role: "OWNER",
    actorType: actor.type,
    actorId: actor.id ?? null,
  });
}

export function can(ctx: TenantContext, permission: Permission): boolean {
  if (ctx.actor.type === "API_KEY") return scopesAllow(ctx.scopes ?? [], permission);
  return roleHas(ctx.role, permission);
}

export function assertCan(ctx: TenantContext, permission: Permission): void {
  if (!can(ctx, permission)) {
    throw new ForbiddenError(undefined, { permission, role: ctx.role });
  }
}
