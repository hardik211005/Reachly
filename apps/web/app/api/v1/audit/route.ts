import { auditListQuerySchema, listAuditLogs } from "@repo/core/audit";
import { ok, route } from "@/lib/api";

export const GET = route({ query: auditListQuerySchema, permission: "audit:read" }, async ({ ctx, query }) => ok(await listAuditLogs(ctx, query)));
