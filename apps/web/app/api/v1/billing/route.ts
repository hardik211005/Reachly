import { getBillingOverview } from "@repo/core/billing/overview";
import { ok, route } from "@/lib/api";

export const GET = route({ permission: "workspace:read" }, async ({ ctx }) => ok(await getBillingOverview(ctx)));
