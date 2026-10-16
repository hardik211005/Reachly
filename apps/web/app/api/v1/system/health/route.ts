import { prisma } from "@repo/db";
import { assertPlatformAdmin } from "@repo/core/platform/admin";
import { getSystemHealth } from "@repo/core/system/health";
import { ok, route } from "@/lib/api";

/** Server internals (database, Redis, workers, dead letters): platform admins only, shown in the admin portal. */
export const GET = route({ permission: "system:read", rateLimit: 30 }, async ({ ctx }) => {
  const user = ctx.userId
    ? await prisma.user.findUnique({
        where: { id: ctx.userId },
        select: { email: true, emailVerified: true },
      })
    : null;
  assertPlatformAdmin(user ?? { email: "" });
  return ok(await getSystemHealth(ctx));
});
