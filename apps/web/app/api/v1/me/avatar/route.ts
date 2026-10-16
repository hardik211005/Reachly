import { AVATAR_MAX_BYTES, removeUserAvatar, setUserAvatar } from "@repo/core/users/avatar";
import { ValidationError } from "@repo/core/errors";
import { ok, userRoute } from "@/lib/api";

/** Upload your profile picture as multipart form data (field "file"). */
export const POST = userRoute({ rateLimit: 10 }, async ({ userId, req }) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") throw new ValidationError("Choose an image file");
  if (file.size > AVATAR_MAX_BYTES) throw new ValidationError("Pictures can be up to 1 MB");
  return ok(await setUserAvatar(userId, new Uint8Array(await file.arrayBuffer())));
});

export const DELETE = userRoute({ rateLimit: 10 }, async ({ userId }) =>
  ok(await removeUserAvatar(userId)),
);
