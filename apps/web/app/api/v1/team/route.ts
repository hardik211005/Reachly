import { listTeam } from "@repo/core/organizations/members";
import { ok, route } from "@/lib/api";

export const GET = route({ permission: "workspace:read" }, async ({ ctx }) => ok(await listTeam(ctx)));
