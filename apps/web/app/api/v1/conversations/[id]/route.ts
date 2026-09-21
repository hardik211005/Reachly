import { z } from "zod";
import { getConversation, setConversationStatus } from "@repo/core/outreach/inbox";
import { ok, route } from "@/lib/api";

type Params = { id: string };

export const GET = route<Params>({ permission: "conversations:read" }, async ({ ctx, params }) => ok(await getConversation(ctx, params.id)));

const body = z.object({ status: z.enum(["OPEN", "CLOSED"]) });

export const PATCH = route<Params, typeof body>({ body, permission: "outreach:send" }, async ({ ctx, params, body: input }) =>
  ok(await setConversationStatus(ctx, params.id, input.status)),
);
