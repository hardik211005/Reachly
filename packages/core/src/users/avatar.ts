import { createHash } from "node:crypto";
import { prisma } from "@repo/db";
import { NotFoundError, ValidationError } from "../errors";
import { LOGO_MAX_BYTES, detectImageType } from "../organizations/logo";

/**
 * Profile pictures. Same rules as workspace logos: stored in the database, raster only (type
 * decided from the file's own bytes, never SVG), up to 1 MB, served from
 * /api/public/avatars/:userId with a content hash for cache busting. users.image points at it,
 * so every place that already shows user.image picks it up.
 */

export const AVATAR_MAX_BYTES = LOGO_MAX_BYTES;

export function avatarUrl(userId: string, sha256: string) {
  return `/api/public/avatars/${userId}?v=${sha256.slice(0, 12)}`;
}

export async function setUserAvatar(userId: string, bytes: Uint8Array) {
  if (!bytes.length) throw new ValidationError("Choose an image file");
  if (bytes.length > AVATAR_MAX_BYTES) throw new ValidationError("Pictures can be up to 1 MB");
  const mimeType = detectImageType(bytes);
  if (!mimeType) throw new ValidationError("Use a PNG, JPG or WebP image");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const data = Buffer.from(bytes);
  const url = avatarUrl(userId, sha256);
  await prisma.$transaction([
    prisma.userAvatar.upsert({
      where: { userId },
      create: { userId, mimeType, data, sha256, size: bytes.length },
      update: { mimeType, data, sha256, size: bytes.length },
    }),
    prisma.user.update({ where: { id: userId }, data: { image: url } }),
  ]);
  return { image: url, mimeType, size: bytes.length };
}

export async function removeUserAvatar(userId: string) {
  await prisma.$transaction([
    prisma.userAvatar.deleteMany({ where: { userId } }),
    prisma.user.update({ where: { id: userId }, data: { image: null } }),
  ]);
  return { image: null };
}

/** For the public avatar route. */
export async function readUserAvatar(userId: string) {
  const avatar = await prisma.userAvatar.findUnique({ where: { userId } });
  if (!avatar) throw new NotFoundError("Avatar", userId);
  return { mimeType: avatar.mimeType, data: avatar.data, sha256: avatar.sha256 };
}
