import { sendTestDelivery } from "@repo/core/workflows/endpoints";
import { ok, route } from "@/lib/api";

export const POST = route<{ id: string }>({ permission: "integrations:manage", rateLimit: 10 }, async ({ ctx, params }) => ok(await sendTestDelivery(ctx, params.id)));
