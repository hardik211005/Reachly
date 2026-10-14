import { prisma } from "@repo/db";
import { assertPlatformAdmin } from "@repo/core/platform/admin";
import { restoreWorkspace } from "@repo/core/organizations/lifecycle";
import { ok, userRoute } from "@/lib/api";

/** Platform admins: bring back a workspace deleted within the last 30 days. */
export const POST = userRoute<{ id: string }>({ rateLimit: 10 }, async ({ userId, params }) => {
  assertPlatformAdmin(await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, emailVerified: true } }));
  const restored = await restoreWorkspace(params.id);
  return ok({ id: restored.id, name: restored.name, deletedAt: restored.deletedAt });
});
