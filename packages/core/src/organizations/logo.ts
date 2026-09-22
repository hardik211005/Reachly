import { createHash } from "node:crypto";
import { prisma } from "@repo/db";
import { audit } from "../audit";
import { assertCan, type TenantContext } from "../context";
import { NotFoundError, ValidationError } from "../errors";

/**
 * Workspace brand logos. Stored in the database (small files, works on any deployment) and
 * served from /api/public/logos/:organizationId with a content hash for cache busting.
 * Only raster formats are accepted, and the type is decided from the file's own bytes —
 * SVG is refused because it can carry scripts.
 */

export const LOGO_MAX_BYTES = 1_000_000;
export const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type LogoType = (typeof LOGO_TYPES)[number];

/** Detects PNG, JPEG or WebP from magic bytes; null for anything else. */
export function detectImageType(bytes: Uint8Array): LogoType | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

export function logoUrl(organizationId: string, sha256: string) {
  return `/api/public/logos/${organizationId}?v=${sha256.slice(0, 12)}`;
}

export async function setWorkspaceLogo(ctx: TenantContext, bytes: Uint8Array) {
  assertCan(ctx, "workspace:manage");
  if (!bytes.length) throw new ValidationError("Choose an image file");
  if (bytes.length > LOGO_MAX_BYTES) throw new ValidationError("Logos can be up to 1 MB");
  const mimeType = detectImageType(bytes);
  if (!mimeType) throw new ValidationError("Use a PNG, JPG or WebP image");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const data = Buffer.from(bytes);
  await prisma.organizationLogo.upsert({
    where: { organizationId: ctx.organizationId },
    create: { organizationId: ctx.organizationId, mimeType, data, sha256, size: bytes.length },
    update: { mimeType, data, sha256, size: bytes.length },
  });
  const url = logoUrl(ctx.organizationId, sha256);
  await ctx.db.organization.update({ where: { id: ctx.organizationId }, data: { logoUrl: url } });
  await audit(ctx, { action: "workspace.logo_updated", resourceType: "organization", resourceId: ctx.organizationId, metadata: { mimeType, size: bytes.length } });
  return { logoUrl: url, mimeType, size: bytes.length };
}

export async function removeWorkspaceLogo(ctx: TenantContext) {
  assertCan(ctx, "workspace:manage");
  await prisma.organizationLogo.deleteMany({ where: { organizationId: ctx.organizationId } });
  await ctx.db.organization.update({ where: { id: ctx.organizationId }, data: { logoUrl: null } });
  await audit(ctx, { action: "workspace.logo_removed", resourceType: "organization", resourceId: ctx.organizationId });
  return { logoUrl: null };
}

/** For the public logo route: the image bytes of a workspace that still exists. */
export async function readWorkspaceLogo(organizationId: string) {
  const logo = await prisma.organizationLogo.findFirst({ where: { organizationId, organization: { deletedAt: null } } });
  if (!logo) throw new NotFoundError("Logo", organizationId);
  return { mimeType: logo.mimeType, data: logo.data, sha256: logo.sha256 };
}
