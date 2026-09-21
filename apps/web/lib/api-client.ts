"use client";

/** Typed fetch helper for /api/v1 used by TanStack Query hooks and mutations. */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
    public readonly requestId?: string,
  ) {
    super(message);
  }
}

interface ErrorBody {
  error?: { code?: string; message?: string; details?: Record<string, unknown>; requestId?: string };
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const response = await fetch(path.startsWith("/") ? path : `/api/v1/${path}`, {
    ...rest,
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    credentials: "same-origin",
  });
  if (response.status === 204) return undefined as T;
  const body = (await response.json().catch(() => ({}))) as { data?: T } & ErrorBody;
  if (!response.ok) {
    throw new ApiError(
      response.status,
      body.error?.code ?? "INTERNAL",
      body.error?.message ?? `Request failed (${response.status})`,
      body.error?.details,
      body.error?.requestId,
    );
  }
  return body.data as T;
}

export async function apiWithMeta<T, M = Record<string, unknown>>(path: string): Promise<{ data: T; meta: M }> {
  const response = await fetch(path.startsWith("/") ? path : `/api/v1/${path}`, { credentials: "same-origin" });
  const body = (await response.json().catch(() => ({}))) as { data?: T; meta?: M } & ErrorBody;
  if (!response.ok) {
    throw new ApiError(response.status, body.error?.code ?? "INTERNAL", body.error?.message ?? "Request failed", body.error?.details);
  }
  return { data: body.data as T, meta: (body.meta ?? {}) as M };
}

/** Human message for an unknown error, used in toasts. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong";
}
