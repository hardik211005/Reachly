import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { hashToken } from "@repo/core/crypto";
import { contactRequestSchema, submitContactRequest } from "@repo/core/marketing/contact";
import { rateLimit } from "@repo/core/rate-limit";

/** Public contact form. No session; limited per IP (only a hash of it is used). */
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;
  const parsed = contactRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const fields = z.flattenError(parsed.error).fieldErrors;
    return NextResponse.json({ error: { code: "VALIDATION_FAILED", message: "Check the highlighted fields", fields } }, { status: 400 });
  }
  // Only well-formed messages count towards the limit.
  const limited = await rateLimit(`contact:${hashToken(ip ?? "unknown").slice(0, 32)}`, 5, 600);
  if (!limited.allowed) {
    return NextResponse.json({ error: { code: "RATE_LIMITED", message: "You've sent a few messages already. Please try again in a few minutes, or email us directly." } }, { status: 429 });
  }
  await submitContactRequest(parsed.data, { ip });
  return NextResponse.json({ data: { received: true } }, { status: 201 });
}
