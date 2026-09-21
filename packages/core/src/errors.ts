/**
 * Application error hierarchy. API handlers map `status`/`code` to HTTP responses;
 * job processors use `retryable` to decide whether to retry.
 */

export type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "CONFLICT"
  | "LIMIT_EXCEEDED"
  | "FEATURE_NOT_IN_PLAN"
  | "PROVIDER_NOT_CONFIGURED"
  | "PROVIDER_ERROR"
  | "RATE_LIMITED"
  | "PRECONDITION_FAILED"
  | "COMPLIANCE_BLOCKED"
  | "INTERNAL";

export class AppError extends Error {
  override name = "AppError";
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
    public readonly retryable: boolean = false,
  ) {
    super(message);
  }

  toJSON() {
    return { code: this.code, message: this.message, details: this.details };
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super("UNAUTHORIZED", message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action", details?: Record<string, unknown>) {
    super("FORBIDDEN", message, 403, details);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super("NOT_FOUND", `${resource} not found`, 404, id ? { resource, id } : { resource });
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("VALIDATION_FAILED", message, 422, details);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("CONFLICT", message, 409, details);
  }
}

export class PreconditionError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("PRECONDITION_FAILED", message, 409, details);
  }
}

export class LimitExceededError extends AppError {
  constructor(message: string, details: { metric: string; limit: number | null; used: number; requested: number }) {
    super("LIMIT_EXCEEDED", message, 402, details);
  }
}

export class FeatureNotInPlanError extends AppError {
  constructor(feature: string, planKey: string) {
    super("FEATURE_NOT_IN_PLAN", `Your ${planKey} plan does not include ${feature}`, 402, { feature, planKey });
  }
}

export class ProviderNotConfiguredError extends AppError {
  constructor(category: string, detail?: string) {
    super(
      "PROVIDER_NOT_CONFIGURED",
      detail ?? `No ${category} provider is connected. Connect one in Integrations.`,
      424,
      { category },
    );
  }
}

export class ProviderError extends AppError {
  constructor(provider: string, message: string, retryable = true, details?: Record<string, unknown>) {
    super("PROVIDER_ERROR", `${provider}: ${message}`, 502, { provider, ...details }, retryable);
  }
}

export class RateLimitedError extends AppError {
  constructor(retryAfterSeconds: number) {
    super("RATE_LIMITED", "Too many requests", 429, { retryAfterSeconds });
  }
}

export class ComplianceBlockedError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("COMPLIANCE_BLOCKED", message, 409, details);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "Unknown error";
}
