import { approvalEditSchema, updateDraft } from "@repo/core/outreach/approvals";
import { ok, route } from "@/lib/api";

export const PATCH = route<{ id: string }, typeof approvalEditSchema>({ body: approvalEditSchema, permission: "outreach:approve" }, async ({ ctx, params, body }) =>
  ok(await updateDraft(ctx, params.id, body)),
);
