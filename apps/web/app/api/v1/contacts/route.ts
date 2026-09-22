import { contactListSchema, listContacts } from "@repo/core/crm/contacts";
import { ok, route } from "@/lib/api";

export const GET = route({ query: contactListSchema, permission: "crm:read" }, async ({ ctx, query }) => ok(await listContacts(ctx, query)));
