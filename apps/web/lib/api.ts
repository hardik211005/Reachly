import "server-only";
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { getEnv } from "@repo/config/env";
import { authenticateApiKey } from "@repo/core/api-keys";
import { hasFeature } from "@repo/core/billing/plans";
import { assertCan, createTenantContext, type TenantContext } from "@repo/core/context";
import { AppError, UnauthorizedError } from "@repo/core/errors";
import { logger } from "@repo/core/logger";
import { resolveMembership } from "@repo/core/organizations/service";
import { rateLimit } from "@repo/core/rate-limit";
import type { Permission } from "@repo/core/rbac";
import { Prisma, TenantViolationError } from "@repo/db";
import { auth } from "./auth";

/**
 * Route-handler wrapper for /api/v1:
 *   request id → auth (session cookie or API key) → CSRF origin check → rate limit
 *   → permission → Zod validation → handler → consistent JSON envelope / errors.
 *
 * Success: `{ data, meta? }`. Error: `{ error: { code, message, details?, requestId } }`.
 */

type AuthMode = "session" | "any" | "user";

interface RouteConfig<B extends z.ZodType | undefined, Q extends z.ZodType | undefined> {
  /** session: cookie or API key with a workspace. user: signed-in user, workspace optional. any: same as session. */
  auth?: AuthMode;
  permission?: Permission;
  body?: B;
  query?: Q;
  /** Requests per minute per actor. Defaults to 120 (reads) / 60 (writes). */
  rateLimit?: number;
}

interface HandlerArgs<B, Q, P> {
  req: NextRequest;
  ctx: TenantContext;
  body: B;
  query: Q;
  params: P;
  requestId: string;
}

interface UserHandlerArgs<B, Q, P> {
  req: NextRequest;
  userId: string;
  ctx: TenantContext | null;
  body: B;
  query: Q;
  params: P;
  requestId: string;
}

type Infer<T> = T extends z.ZodType ? z.output<T> : undefined;

export class ApiResponse {
  constructor(
    public readonly body: unknown,
    public readonly status = 200,
    public readonly headers: Record<string, string> = {},
  ) {}
}

export function ok<T>(data: T, meta?: Record<string, unknown>) {
  return new ApiResponse(meta ? { data, meta } : { data });
}

export function created<T>(data: T) {
  return new ApiResponse({ data }, 201);
}

export function noContent() {
  return new ApiResponse(null, 204);
}

function json(body: unknown, status: number, requestId: string, extraHeaders: Record<string, string> = {}) {
  if (status === 204) return new NextResponse(null, { status, headers: { "x-request-id": requestId, ...extraHeaders } });
  // Non-JSON payloads (CSV exports, files) are sent as-is with their own content type.
  if ((typeof body === "string" || body instanceof Uint8Array) && extraHeaders["content-type"] && !extraHeaders["content-type"].includes("json")) {
    const payload = typeof body === "string" ? body : new Blob([new Uint8Array(body)]);
    return new NextResponse(payload, { status, headers: { "x-request-id": requestId, "cache-control": "no-store", ...extraHeaders } });
  }
  return new NextResponse(JSON.stringify(body, jsonReplacer), {
    status,
    headers: { "content-type": "application/json", "x-request-id": requestId, "cache-control": "no-store", ...extraHeaders },
  });
}

function jsonReplacer(_key: string, value: unknown) {
  if (typeof value === "bigint") return Number(value);
  return value;
}

export function errorResponse(error: unknown, requestId: string) {
  if (error instanceof AppError) {
    const headers: Record<string, string> = {};
    if (error.code === "RATE_LIMITED" && error.details?.retryAfterSeconds) headers["retry-after"] = String(error.details.retryAfterSeconds);
    return json({ error: { code: error.code, message: error.message, details: error.details, requestId } }, error.status, requestId, headers);
  }
  if (error instanceof ZodError) {
    return json(
      { error: { code: "VALIDATION_FAILED", message: "Request validation failed", details: { issues: error.issues }, requestId } },
      422,
      requestId,
    );
  }
  if (error instanceof TenantViolationError) {
    logger.error({ err: error, requestId }, "tenant violation blocked");
    return json({ error: { code: "FORBIDDEN", message: "Forbidden", requestId } }, 403, requestId);
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2025") return json({ error: { code: "NOT_FOUND", message: "Not found", requestId } }, 404, requestId);
    if (error.code === "P2002") return json({ error: { code: "CONFLICT", message: "Already exists", requestId } }, 409, requestId);
  }
  logger.error({ err: error, requestId }, "unhandled API error");
  return json({ error: { code: "INTERNAL", message: "Something went wrong", requestId } }, 500, requestId);
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function assertSameOrigin(req: NextRequest) {
  // Cookie-authenticated writes must come from our own origin (CSRF protection).
  const origin = req.headers.get("origin");
  if (!origin) throw new AppError("FORBIDDEN", "Missing Origin header", 403);
  const allowed = new Set([new URL(getEnv().APP_URL).host, req.headers.get("host") ?? ""]);
  if (!allowed.has(new URL(origin).host)) throw new AppError("FORBIDDEN", "Cross-origin request blocked", 403);
}

async function parseInput<B extends z.ZodType | undefined, Q extends z.ZodType | undefined>(
  req: NextRequest,
  config: RouteConfig<B, Q>,
): Promise<{ body: Infer<B>; query: Infer<Q> }> {
  let body: unknown;
  if (config.body) {
    const text = await req.text();
    let raw: unknown = {};
    if (text) {
      try {
        raw = JSON.parse(text);
      } catch {
        throw new AppError("VALIDATION_FAILED", "Body must be valid JSON", 400);
      }
    }
    body = config.body.parse(raw);
  }
  let query: unknown;
  if (config.query) {
    const params: Record<string, string | string[]> = {};
    for (const key of new Set(req.nextUrl.searchParams.keys())) {
      const values = req.nextUrl.searchParams.getAll(key);
      params[key] = values.length > 1 ? values : (values[0] ?? "");
    }
    query = config.query.parse(params);
  }
  return { body: body as Infer<B>, query: query as Infer<Q> };
}

async function resolveActor(req: NextRequest, requestId: string): Promise<{ userId: string | null; ctx: TenantContext | null; viaApiKey: boolean }> {
  const authorization = req.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    const key = await authenticateApiKey(authorization.slice(7).trim());
    if (!key) throw new UnauthorizedError("Invalid API key");
    const ctx = createTenantContext({
      organizationId: key.organizationId,
      role: "MEMBER",
      actorType: "API_KEY",
      actorId: key.id,
      scopes: key.scopes,
      requestId,
    });
    if (!(await hasFeature(ctx, "apiAccess"))) throw new AppError("FEATURE_NOT_IN_PLAN", "API access is not included in your plan", 402);
    return { userId: null, ctx, viaApiKey: true };
  }

  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) throw new UnauthorizedError();
  const membership = await resolveMembership(session.user.id);
  const ctx = membership
    ? createTenantContext({ organizationId: membership.organizationId, userId: session.user.id, role: membership.role, requestId })
    : null;
  return { userId: session.user.id, ctx, viaApiKey: false };
}

type RouteContext<P> = { params: Promise<P> };

const ID_SEGMENT = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi;
/** Overall ceiling per actor across every endpoint, on top of the per-endpoint limits. */
const ACTOR_LIMIT_PER_MINUTE = 600;

/**
 * Per-endpoint buckets (method + path with ids collapsed), so a strict limit on one
 * endpoint (e.g. launching a campaign) isn't consumed by ordinary reads elsewhere.
 */
async function enforceRateLimits(req: NextRequest, actorKey: string, endpointLimit: number) {
  const endpoint = `${req.method}:${req.nextUrl.pathname.replace(ID_SEGMENT, "/:id")}`;
  const [overall, scoped] = await Promise.all([rateLimit(`api:${actorKey}`, ACTOR_LIMIT_PER_MINUTE, 60), rateLimit(`api:${actorKey}:${endpoint}`, endpointLimit, 60)]);
  const blocked = !overall.allowed ? overall : !scoped.allowed ? scoped : null;
  if (blocked) throw new AppError("RATE_LIMITED", "Too many requests", 429, { retryAfterSeconds: blocked.resetSeconds });
}

/** Workspace-scoped route (most endpoints). */
export function route<P = Record<string, string>, B extends z.ZodType | undefined = undefined, Q extends z.ZodType | undefined = undefined>(
  config: RouteConfig<B, Q>,
  handler: (args: HandlerArgs<Infer<B>, Infer<Q>, P>) => Promise<ApiResponse>,
) {
  return async (req: NextRequest, context: RouteContext<P>) => {
    const requestId = req.headers.get("x-request-id") ?? randomUUID();
    const started = Date.now();
    try {
      const actor = await resolveActor(req, requestId);
      if (!actor.viaApiKey && !SAFE_METHODS.has(req.method)) assertSameOrigin(req);
      if (!actor.ctx) throw new AppError("PRECONDITION_FAILED", "Create a workspace first", 409);

      await enforceRateLimits(req, actor.ctx.actor.id ?? actor.ctx.organizationId, config.rateLimit ?? (SAFE_METHODS.has(req.method) ? 120 : 60));

      if (config.permission) assertCan(actor.ctx, config.permission);
      const { body, query } = await parseInput(req, config);
      const params = await context.params;
      const result = await handler({ req, ctx: actor.ctx, body, query, params, requestId });
      logger.debug({ requestId, method: req.method, path: req.nextUrl.pathname, status: result.status, ms: Date.now() - started }, "api");
      return json(result.body, result.status, requestId, result.headers);
    } catch (error) {
      return errorResponse(error, requestId);
    }
  };
}

/** Signed-in user route where a workspace may not exist yet (onboarding, workspace creation). */
export function userRoute<P = Record<string, string>, B extends z.ZodType | undefined = undefined, Q extends z.ZodType | undefined = undefined>(
  config: RouteConfig<B, Q>,
  handler: (args: UserHandlerArgs<Infer<B>, Infer<Q>, P>) => Promise<ApiResponse>,
) {
  return async (req: NextRequest, context: RouteContext<P>) => {
    const requestId = req.headers.get("x-request-id") ?? randomUUID();
    try {
      const actor = await resolveActor(req, requestId);
      if (actor.viaApiKey || !actor.userId) throw new UnauthorizedError("This endpoint requires a user session");
      if (!SAFE_METHODS.has(req.method)) assertSameOrigin(req);
      await enforceRateLimits(req, `user:${actor.userId}`, config.rateLimit ?? 30);
      if (config.permission && actor.ctx) assertCan(actor.ctx, config.permission);
      const { body, query } = await parseInput(req, config);
      const params = await context.params;
      const result = await handler({ req, userId: actor.userId, ctx: actor.ctx, body, query, params, requestId });
      return json(result.body, result.status, requestId, result.headers);
    } catch (error) {
      return errorResponse(error, requestId);
    }
  };
}

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
