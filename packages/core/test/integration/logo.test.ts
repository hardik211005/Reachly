import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@repo/db";
import { createTenantContext } from "../../src/context";
import { ForbiddenError, NotFoundError, ValidationError } from "../../src/errors";
import { LOGO_MAX_BYTES, detectImageType, readWorkspaceLogo, removeWorkspaceLogo, setWorkspaceLogo } from "../../src/organizations/logo";
import { createWorkspace, resetDatabase } from "./helpers";

// A 1×1 PNG.
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const WEBP = Uint8Array.from([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBPVP8 ")]);
const SVG = Uint8Array.from(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));

describe("workspace logo", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("detects images by their bytes, not their name", () => {
    expect(detectImageType(PNG)).toBe("image/png");
    expect(detectImageType(JPEG)).toBe("image/jpeg");
    expect(detectImageType(WEBP)).toBe("image/webp");
    expect(detectImageType(SVG)).toBeNull();
    expect(detectImageType(new Uint8Array())).toBeNull();
  });

  it("stores, serves and removes a logo", async () => {
    const { ctx, organizationId } = await createWorkspace();
    const saved = await setWorkspaceLogo(ctx, PNG);
    expect(saved.logoUrl).toMatch(new RegExp(`^/api/public/logos/${organizationId}\\?v=[0-9a-f]{12}$`));
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } })).logoUrl).toBe(saved.logoUrl);

    const served = await readWorkspaceLogo(organizationId);
    expect(served.mimeType).toBe("image/png");
    expect(Buffer.from(served.data).equals(Buffer.from(PNG))).toBe(true);
    expect(saved.logoUrl.endsWith(served.sha256.slice(0, 12))).toBe(true);

    await removeWorkspaceLogo(ctx);
    await expect(readWorkspaceLogo(organizationId)).rejects.toBeInstanceOf(NotFoundError);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } })).logoUrl).toBeNull();
  });

  it("refuses SVGs, oversized files and non-admins", async () => {
    const { ctx, organizationId } = await createWorkspace();
    await expect(setWorkspaceLogo(ctx, SVG)).rejects.toBeInstanceOf(ValidationError);
    const huge = new Uint8Array(LOGO_MAX_BYTES + 1);
    huge.set(PNG);
    await expect(setWorkspaceLogo(ctx, huge)).rejects.toBeInstanceOf(ValidationError);

    const member = createTenantContext({ organizationId, userId: ctx.userId, role: "MEMBER" });
    await expect(setWorkspaceLogo(member, PNG)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("stops serving the logo of a deleted workspace", async () => {
    const { ctx, organizationId } = await createWorkspace();
    await setWorkspaceLogo(ctx, JPEG);
    await prisma.organization.update({ where: { id: organizationId }, data: { deletedAt: new Date() } });
    await expect(readWorkspaceLogo(organizationId)).rejects.toBeInstanceOf(NotFoundError);
  });
});
