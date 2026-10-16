import { NextResponse, type NextRequest } from "next/server";
import { NotFoundError } from "@repo/core/errors";
import { readUserAvatar } from "@repo/core/users/avatar";

/**
 * Public profile picture (shown to teammates and on shared quotes). Versioned URLs (?v=hash) are
 * cached for a year; the image can never be interpreted as a page (nosniff + strict CSP).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return new NextResponse(null, { status: 404 });
  try {
    const avatar = await readUserAvatar(userId);
    const versioned = req.nextUrl.searchParams.get("v") === avatar.sha256.slice(0, 12);
    return new NextResponse(new Uint8Array(avatar.data), {
      headers: {
        "content-type": avatar.mimeType,
        "cache-control": versioned ? "public, max-age=31536000, immutable" : "public, max-age=300",
        etag: `"${avatar.sha256}"`,
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'",
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError) return new NextResponse(null, { status: 404 });
    throw error;
  }
}
