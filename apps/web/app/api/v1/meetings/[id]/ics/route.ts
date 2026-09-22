import { meetingIcs } from "@repo/core/crm/meetings";
import { ApiResponse, route } from "@/lib/api";

export const GET = route<{ id: string }>({ permission: "crm:read" }, async ({ ctx, params }) => {
  const { fileName, body } = await meetingIcs(ctx, params.id);
  return new ApiResponse(body, 200, { "content-type": "text/calendar; charset=utf-8", "content-disposition": `attachment; filename="${fileName}"` });
});
