import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@repo/db";
import { NotFoundError, ValidationError } from "../../src/errors";
import { AVATAR_MAX_BYTES, readUserAvatar, removeUserAvatar, setUserAvatar } from "../../src/users/avatar";
import { createWorkspace, resetDatabase } from "./helpers";

// A 1×1 PNG.
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
const SVG = Uint8Array.from(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));

describe("profile photo", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("stores, serves and removes a photo, keeping users.image in step", async () => {
    const { userId } = await createWorkspace();
    const saved = await setUserAvatar(userId, PNG);
    expect(saved.image).toMatch(new RegExp(`^/api/public/avatars/${userId}\\?v=[0-9a-f]{12}$`));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).image).toBe(saved.image);
    const served = await readUserAvatar(userId);
    expect(served.mimeType).toBe("image/png");
    expect(Buffer.from(served.data).equals(Buffer.from(PNG))).toBe(true);

    await removeUserAvatar(userId);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).image).toBeNull();
    await expect(readUserAvatar(userId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses SVG, empty and oversized files", async () => {
    const { userId } = await createWorkspace();
    await expect(setUserAvatar(userId, SVG)).rejects.toBeInstanceOf(ValidationError);
    await expect(setUserAvatar(userId, new Uint8Array())).rejects.toBeInstanceOf(ValidationError);
    const huge = new Uint8Array(AVATAR_MAX_BYTES + 1);
    huge.set(PNG);
    await expect(setUserAvatar(userId, huge)).rejects.toBeInstanceOf(ValidationError);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).image).toBeNull();
  });

  it("is deleted with the account", async () => {
    const { userId } = await createWorkspace();
    await setUserAvatar(userId, PNG);
    await prisma.membership.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    expect(await prisma.userAvatar.count({ where: { userId } })).toBe(0);
  });
});
