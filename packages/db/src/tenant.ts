import { Prisma, type PrismaClient } from "./generated/prisma/client";

/**
 * Tenant isolation, defence in depth.
 *
 * Services receive a tenant-scoped client from `forTenant(orgId)`. For every model that
 * carries `organizationId`, the extension:
 *   - adds `organizationId = orgId` to every read/update/delete `where`
 *   - stamps `organizationId = orgId` onto every create payload
 * so a forgotten filter cannot leak or mutate another tenant's rows.
 *
 * Nested writes/relations are not rewritten — services create child rows through their
 * own top-level calls, and tenant-isolation tests cover the critical paths.
 */

/**
 * Models whose rows belong to exactly one organisation (have a required `organizationId`).
 * `tenant.test.ts` parses schema.prisma and fails if this list drifts from the schema.
 * WebhookEvent is excluded on purpose: it is a provider-level table with a nullable org id.
 */
export const TENANT_MODELS: ReadonlySet<Prisma.ModelName> = new Set<Prisma.ModelName>([
  "Membership",
  "Invitation",
  "ApiKey",
  "AuditLog",
  "Subscription",
  "UsageRecord",
  "UsageCounter",
  "CreditGrant",
  "Invoice",
  "Payment",
  "BusinessProfile",
  "Offering",
  "PricingRule",
  "ScoringProfile",
  "ComplianceSettings",
  "Lead",
  "LeadSource",
  "LeadScore",
  "Contact",
  "DiscoveryRun",
  "SavedSearch",
  "SavedView",
  "ImportJob",
  "Campaign",
  "CampaignLead",
  "Conversation",
  "Message",
  "Attachment",
  "Call",
  "Suppression",
  "Workflow",
  "WorkflowExecution",
  "Deal",
  "Task",
  "Note",
  "Meeting",
  "Quote",
  "AIRequest",
  "AICacheEntry",
  "Insight",
  "Integration",
  "WhatsAppTemplate",
  "WebhookEndpoint",
  "Notification",
  "Event",
]);

const WHERE_OPERATIONS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
]);

type ArgsRecord = Record<string, unknown>;

function isRecord(value: unknown): value is ArgsRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scopeWhere(args: ArgsRecord, organizationId: string): void {
  const where = isRecord(args.where) ? args.where : {};
  if (where.organizationId !== undefined && where.organizationId !== organizationId) {
    throw new TenantViolationError(
      `Query attempted to access organization ${String(where.organizationId)} from tenant ${organizationId}`,
    );
  }
  args.where = { ...where, organizationId };
}

function stampData(data: unknown, organizationId: string): unknown {
  if (Array.isArray(data)) return data.map((item) => stampData(item, organizationId));
  if (!isRecord(data)) return data;
  if (data.organizationId !== undefined && data.organizationId !== organizationId) {
    throw new TenantViolationError(
      `Create attempted to write organization ${String(data.organizationId)} from tenant ${organizationId}`,
    );
  }
  // Relation-style create (`organization: { connect }`) is rewritten to the scalar form.
  if ("organization" in data) {
    const { organization: _ignored, ...rest } = data;
    return { ...rest, organizationId };
  }
  return { ...data, organizationId };
}

export class TenantViolationError extends Error {
  override name = "TenantViolationError";
}

export function tenantExtension(organizationId: string) {
  if (!organizationId) throw new TenantViolationError("organizationId is required");

  return Prisma.defineExtension({
    name: "tenant-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model as Prisma.ModelName)) return query(args);

          const scoped: ArgsRecord = isRecord(args) ? { ...args } : {};

          if (WHERE_OPERATIONS.has(operation)) {
            scopeWhere(scoped, organizationId);
          } else if (operation === "create") {
            scoped.data = stampData(scoped.data, organizationId);
          } else if (operation === "createMany" || operation === "createManyAndReturn") {
            scoped.data = stampData(scoped.data, organizationId);
          } else if (operation === "upsert") {
            scopeWhere(scoped, organizationId);
            scoped.create = stampData(scoped.create, organizationId);
          }

          return query(scoped as typeof args);
        },
      },
    },
  });
}

export function forTenant(client: PrismaClient, organizationId: string) {
  return client.$extends(tenantExtension(organizationId));
}

export type TenantPrismaClient = ReturnType<typeof forTenant>;
