import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { hashToken } from "@repo/core/crypto";
import { reviewSubmissionSchema, submitReview } from "@repo/core/grow/service";
import { rateLimit } from "@repo/core/rate-limit";

/** A customer submitting the review they were invited to leave. The token is the only key. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null;
  const limited = await rateLimit(`review:${hashToken(ip ?? "unknown").slice(0, 32)}`, 10, 600);
  if (!limited.allowed)
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "Please try again in a few minutes." } },
      { status: 429 },
    );
  const parsed = reviewSubmissionSchema.safeParse(await req.json().catch(() => null));
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
  try {
    await submitReview(token, parsed.data);
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: "UNAVAILABLE",
          message:
            error instanceof Error && /already/.test(error.message)
              ? error.message
              : "This review link isn't valid any more.",
        },
      },
      { status: 409 },
    );
  }
  return NextResponse.json({ data: { submitted: true } }, { status: 201 });
}
