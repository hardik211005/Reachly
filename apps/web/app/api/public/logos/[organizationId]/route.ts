import { NextResponse, type NextRequest } from "next/server";
import { NotFoundError } from "@repo/core/errors";
import { readWorkspaceLogo } from "@repo/core/organizations/logo";

/**
 * Public workspace logo (shown on shared quotes and emails). Versioned URLs (?v=hash) are
 * cached for a year; the image can never be interpreted as a page (nosniff + strict CSP).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(organizationId)) return new NextResponse(null, { status: 404 });
  try {
    const logo = await readWorkspaceLogo(organizationId);
    const versioned = req.nextUrl.searchParams.get("v") === logo.sha256.slice(0, 12);
    return new NextResponse(new Uint8Array(logo.data), {
      headers: {
        "content-type": logo.mimeType,
        "cache-control": versioned ? "public, max-age=31536000, immutable" : "public, max-age=300",
        etag: `"${logo.sha256}"`,
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'",
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError) return new NextResponse(null, { status: 404 });
    throw error;
  }
}
