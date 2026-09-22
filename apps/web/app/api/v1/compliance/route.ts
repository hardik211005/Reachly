import { getComplianceSettings, outreachComplianceSchema, updateOutreachCompliance } from "@repo/core/compliance/settings";
import { ok, route } from "@/lib/api";

export const GET = route({ permission: "workspace:read" }, async ({ ctx }) => ok(await getComplianceSettings(ctx)));

export const PUT = route({ body: outreachComplianceSchema, permission: "compliance:manage", rateLimit: 20 }, async ({ ctx, body }) => ok(await updateOutreachCompliance(ctx, body)));
