import type { MemberRole } from "@repo/config";

/**
 * Role-based access control. Permissions are coarse-grained capabilities checked by
 * services (never only in the UI). API keys carry scopes that map onto the same set.
 */

export const PERMISSIONS = [
  "workspace:read",
  "workspace:manage",
  "members:manage",
  "billing:manage",
  "integrations:manage",
  "apikeys:manage",
  "compliance:manage",
  "leads:read",
  "leads:write",
  "leads:delete",
  "leads:export",
  "discovery:run",
  "campaigns:read",
  "campaigns:write",
  "campaigns:launch",
  "outreach:send",
  "outreach:approve",
  "calls:place",
  "conversations:read",
  "crm:read",
  "crm:write",
  "quotes:write",
  "workflows:read",
  "workflows:write",
  "analytics:read",
  "ai:use",
  "audit:read",
  "system:read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const READ_ONLY: Permission[] = [
  "workspace:read",
  "leads:read",
  "campaigns:read",
  "conversations:read",
  "crm:read",
  "workflows:read",
  "analytics:read",
];

const MEMBER: Permission[] = [
  ...READ_ONLY,
  "leads:write",
  "leads:export",
  "discovery:run",
  "campaigns:write",
  "campaigns:launch",
  "outreach:send",
  "outreach:approve",
  "calls:place",
  "crm:write",
  "quotes:write",
  "workflows:write",
  "ai:use",
];

const ADMIN: Permission[] = [
  ...MEMBER,
  "workspace:manage",
  "members:manage",
  "integrations:manage",
  "apikeys:manage",
  "compliance:manage",
  "leads:delete",
  "audit:read",
  "system:read",
];

const ROLE_PERMISSIONS: Record<MemberRole, ReadonlySet<Permission>> = {
  OWNER: new Set<Permission>([...ADMIN, "billing:manage"]),
  ADMIN: new Set<Permission>(ADMIN),
  MEMBER: new Set<Permission>(MEMBER),
  VIEWER: new Set<Permission>(READ_ONLY),
};

export function roleHas(role: MemberRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export function permissionsFor(role: MemberRole): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

/** Roles a member of `actorRole` may assign to others. */
export function assignableRoles(actorRole: MemberRole): MemberRole[] {
  if (actorRole === "OWNER") return ["OWNER", "ADMIN", "MEMBER", "VIEWER"];
  if (actorRole === "ADMIN") return ["ADMIN", "MEMBER", "VIEWER"];
  return [];
}

/** API key scopes: "read" grants read permissions, "write" grants member-level writes. */
export const API_KEY_SCOPES = ["read", "write"] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export function scopesAllow(scopes: readonly string[], permission: Permission): boolean {
  if (READ_ONLY.includes(permission)) return scopes.includes("read") || scopes.includes("write");
  if (MEMBER.includes(permission)) return scopes.includes("write");
  return false;
}
