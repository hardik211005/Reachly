import { callReadiness } from "@repo/core/calls/policy";
import { ok, route } from "@/lib/api";

export const GET = route({ permission: "conversations:read" }, async ({ ctx }) => ok(await callReadiness(ctx)));
