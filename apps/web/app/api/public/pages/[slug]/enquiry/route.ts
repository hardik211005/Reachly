import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { hashToken } from "@repo/core/crypto";
import { enquirySchema, submitEnquiry } from "@repo/core/grow/service";
import { rateLimit } from "@repo/core/rate-limit";

/** Enquiry form on a business's public page. No session; limited per IP (only a hash of it is used). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null;
  const parsed = enquirySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_FAILED",
          message: "Check the highlighted fields",
          fields: z.flattenError(parsed.error).fieldErrors,
        },
      },
      { status: 400 },
    );
  }
  const limited = await rateLimit(`enquiry:${hashToken(ip ?? "unknown").slice(0, 32)}`, 5, 600);
  if (!limited.allowed)
    return NextResponse.json(
      {
        error: {
          code: "RATE_LIMITED",
          message: "You've sent a few enquiries already. Please try again in a few minutes.",
        },
      },
      { status: 429 },
    );
  try {
    await submitEnquiry(slug, parsed.data, { ip });
  } catch {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "This page isn't taking enquiries right now." } },
      { status: 404 },
    );
  }
  return NextResponse.json({ data: { received: true } }, { status: 201 });
}
