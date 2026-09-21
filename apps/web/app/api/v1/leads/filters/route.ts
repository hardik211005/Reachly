import { leadFilterOptions } from "@repo/core/leads/service";
import { ok, route } from "@/lib/api";

export const GET = route({ permission: "leads:read" }, async ({ ctx }) => ok(await leadFilterOptions(ctx)));
