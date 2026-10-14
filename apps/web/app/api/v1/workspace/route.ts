import { deleteWorkspace, deleteWorkspaceSchema } from "@repo/core/organizations/lifecycle";
import { getWorkspaceSettings, updateWorkspaceSettings, workspaceSettingsSchema } from "@repo/core/organizations/settings";
import { ok, route } from "@/lib/api";

export const GET = route({ permission: "workspace:read" }, async ({ ctx }) => ok(await getWorkspaceSettings(ctx)));

export const PATCH = route({ body: workspaceSettingsSchema, permission: "workspace:manage", rateLimit: 20 }, async ({ ctx, body }) => ok(await updateWorkspaceSettings(ctx, body)));

/** Owner only: soft-deletes the workspace (purged after 30 days). */
export const DELETE = route({ body: deleteWorkspaceSchema, permission: "billing:manage", rateLimit: 5 }, async ({ ctx, body }) => ok(await deleteWorkspace(ctx, body)));
