import { listIntegrations } from "@repo/core/integrations/manage";
import { ok, route } from "@/lib/api";

export const GET = route({ permission: "workspace:read" }, async ({ ctx }) => ok(await listIntegrations(ctx)));
