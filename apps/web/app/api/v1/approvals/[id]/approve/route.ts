import { approvalEditSchema, approveMessage } from "@repo/core/outreach/approvals";
import { ok, route } from "@/lib/api";

export const POST = route<{ id: string }, typeof approvalEditSchema>({ body: approvalEditSchema, permission: "outreach:approve" }, async ({ ctx, params, body }) =>
  ok(await approveMessage(ctx, params.id, body)),
);
