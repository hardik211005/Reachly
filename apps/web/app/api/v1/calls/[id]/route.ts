import { getCall } from "@repo/core/calls/service";
import { ok, route } from "@/lib/api";

export const GET = route<{ id: string }>({ permission: "conversations:read" }, async ({ ctx, params }) => ok(await getCall(ctx, params.id)));
