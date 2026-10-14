import { exportWorkspaceData } from "@repo/core/organizations/lifecycle";
import { ApiResponse, route } from "@/lib/api";

/** Full workspace export as a JSON download (secrets excluded). */
export const GET = route({ permission: "workspace:manage", rateLimit: 3 }, async ({ ctx }) => {
  const data = await exportWorkspaceData(ctx);
  const filename = `reachly-${data.organization.slug}-${data.exportedAt.slice(0, 10)}.json`;
  // Passed as an object: the API layer serialises JSON bodies itself.
  return new ApiResponse(data, 200, { "content-disposition": `attachment; filename="${filename}"` });
});
