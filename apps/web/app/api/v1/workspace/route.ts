import { getWorkspaceSettings, updateWorkspaceSettings, workspaceSettingsSchema } from "@repo/core/organizations/settings";
import { ok, route } from "@/lib/api";

export const GET = route({ permission: "workspace:read" }, async ({ ctx }) => ok(await getWorkspaceSettings(ctx)));

export const PATCH = route({ body: workspaceSettingsSchema, permission: "workspace:manage", rateLimit: 20 }, async ({ ctx, body }) => ok(await updateWorkspaceSettings(ctx, body)));
