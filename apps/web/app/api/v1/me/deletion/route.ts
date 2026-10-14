import { accountDeletionPlan } from "@repo/core/organizations/lifecycle";
import { ok, userRoute } from "@/lib/api";

/** What deleting the signed-in account would remove, leave or be blocked by. */
export const GET = userRoute({}, async ({ userId }) => ok(await accountDeletionPlan(userId)));
