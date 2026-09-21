export { prisma, getPrisma, disconnectPrisma } from "./client";
export { forTenant, tenantExtension, TENANT_MODELS, TenantViolationError } from "./tenant";
export type { TenantPrismaClient } from "./tenant";
export * from "./generated/prisma/client";
