import { deleteNote } from "@repo/core/leads/service";
import { noContent, route } from "@/lib/api";

export const DELETE = route<{ id: string }>({ permission: "crm:write" }, async ({ ctx, params }) => {
  await deleteNote(ctx, params.id);
  return noContent();
});
