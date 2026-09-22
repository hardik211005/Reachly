import { inviteMember, inviteSchema } from "@repo/core/organizations/members";
import { created, route } from "@/lib/api";

export const POST = route({ body: inviteSchema, permission: "members:manage", rateLimit: 20 }, async ({ ctx, body }) => created(await inviteMember(ctx, body)));
