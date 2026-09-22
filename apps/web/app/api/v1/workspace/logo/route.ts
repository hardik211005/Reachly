import { LOGO_MAX_BYTES, removeWorkspaceLogo, setWorkspaceLogo } from "@repo/core/organizations/logo";
import { ValidationError } from "@repo/core/errors";
import { ok, route } from "@/lib/api";

/** Upload a brand logo as multipart form data (field "file"). */
export const POST = route({ permission: "workspace:manage", rateLimit: 10 }, async ({ ctx, req }) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") throw new ValidationError("Choose an image file");
  if (file.size > LOGO_MAX_BYTES) throw new ValidationError("Logos can be up to 1 MB");
  return ok(await setWorkspaceLogo(ctx, new Uint8Array(await file.arrayBuffer())));
});

export const DELETE = route({ permission: "workspace:manage" }, async ({ ctx }) => ok(await removeWorkspaceLogo(ctx)));
