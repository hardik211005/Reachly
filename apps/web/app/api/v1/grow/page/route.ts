import {
  getPublicPageSettings,
  publicPageSettingsSchema,
  updatePublicPageSettings,
} from "@repo/core/grow/service";
import { ok, route } from "@/lib/api";

export const GET = route({ permission: "workspace:read" }, async ({ ctx }) =>
  ok(await getPublicPageSettings(ctx)),
);

export const PUT = route(
  { body: publicPageSettingsSchema, permission: "workspace:manage", rateLimit: 20 },
  async ({ ctx, body }) => ok(await updatePublicPageSettings(ctx, body)),
);
