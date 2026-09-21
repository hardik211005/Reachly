import { WORKFLOW_TEMPLATES } from "@repo/core/workflows/templates";
import { ok, route } from "@/lib/api";

export const GET = route({ permission: "workflows:read" }, async () => ok(WORKFLOW_TEMPLATES));
