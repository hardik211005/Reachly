import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { AppError } from "@repo/core/errors";
import { completeN8nCallback } from "@repo/core/workflows/engine";

const body = z.object({ token: z.string().min(10).max(2000), status: z.enum(["success", "error"]).default("success"), data: z.unknown().optional(), error: z.string().max(1000).optional() });

/** n8n reports the result of a step that waits for it; the workflow then continues. */
export async function POST(req: NextRequest) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_FAILED", message: "Expected { token, status, data }" } }, { status: 400 });
  try {
    return NextResponse.json(await completeN8nCallback(parsed.data));
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    throw error;
  }
}
