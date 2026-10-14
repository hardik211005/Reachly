import { prisma } from "@repo/db";

/**
 * Unauthenticated probe for load balancers and container healthchecks. Reports only whether the
 * app can reach its database — no versions, hosts or counts. The detailed view is
 * /api/v1/system/health (admins only).
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok", database: "ok", latencyMs: Date.now() - started }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ status: "unavailable", database: "unreachable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
