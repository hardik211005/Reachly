import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

/**
 * Server-only environment access. Never import this module from client components —
 * it reads secrets. Values are validated once, lazily, on first access.
 */

const bool = (fallback: boolean) =>
  z
    .enum(["true", "false", "1", "0", ""])
    .optional()
    .transform((value) => (value === undefined || value === "" ? fallback : value === "true" || value === "1"));

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value && value.trim().length > 0 ? value.trim() : undefined));

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_ENV: z.enum(["development", "staging", "production", "test"]).default("development"),
    APP_URL: z.string().url().default("http://localhost:3000"),
    DEMO_MODE: bool(false),
    DEMO_SIMULATE_EVENTS: bool(true),
    LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),

    DATABASE_URL: z.string().min(1),
    DIRECT_URL: optionalString,
    REDIS_URL: z.string().default("redis://localhost:6379"),
    QUEUE_DRIVER: z.enum(["bullmq", "inline"]).default("bullmq"),

    BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
    ENCRYPTION_KEY: z.string().min(32),
    SIGNING_SECRET: z.string().min(16),
    AUTH_REQUIRE_EMAIL_VERIFICATION: bool(false),
    GOOGLE_CLIENT_ID: optionalString,
    GOOGLE_CLIENT_SECRET: optionalString,

    AI_DEFAULT_PROVIDER: z.enum(["mock", "openai", "anthropic", "google"]).default("mock"),
    AI_DEFAULT_MODEL: optionalString,
    AI_FALLBACK_MODEL: optionalString,
    AI_PRICING_OVERRIDES: optionalString,
    AI_CACHE_TTL_SECONDS: z.coerce.number().int().nonnegative().default(86400),
    OPENAI_API_KEY: optionalString,
    ANTHROPIC_API_KEY: optionalString,
    GOOGLE_AI_API_KEY: optionalString,

    /** openstreetmap: real businesses from open map data, no key needed. google_places needs GOOGLE_PLACES_API_KEY. mock: generated demo businesses. */
    LEAD_PROVIDER: z.enum(["openstreetmap", "google_places", "mock"]).default("openstreetmap"),
    GOOGLE_PLACES_API_KEY: optionalString,
    ENRICHMENT_WEBSITE_FETCH_ENABLED: bool(true),

    EMAIL_PROVIDER: z.enum(["mock", "resend", "sendgrid", "smtp"]).default("mock"),
    EMAIL_FROM: z.string().default("Reachly <outreach@example.com>"),
    RESEND_API_KEY: optionalString,
    RESEND_WEBHOOK_SECRET: optionalString,
    SENDGRID_API_KEY: optionalString,
    SENDGRID_WEBHOOK_PUBLIC_KEY: optionalString,
    SMTP_HOST: optionalString,
    SMTP_PORT: z.coerce.number().int().positive().default(1025),
    SMTP_USER: optionalString,
    SMTP_PASSWORD: optionalString,
    SMTP_SECURE: bool(false),

    WHATSAPP_PROVIDER: z.enum(["mock", "meta"]).default("mock"),
    WHATSAPP_PHONE_NUMBER_ID: optionalString,
    WHATSAPP_BUSINESS_ACCOUNT_ID: optionalString,
    WHATSAPP_ACCESS_TOKEN: optionalString,
    WHATSAPP_APP_SECRET: optionalString,
    WHATSAPP_VERIFY_TOKEN: optionalString,
    WHATSAPP_GRAPH_API_VERSION: z.string().default("v21.0"),

    VOICE_PROVIDER: z.enum(["mock", "twilio", "vapi"]).default("mock"),
    TWILIO_ACCOUNT_SID: optionalString,
    TWILIO_AUTH_TOKEN: optionalString,
    TWILIO_FROM_NUMBER: optionalString,
    VAPI_API_KEY: optionalString,
    VAPI_PHONE_NUMBER_ID: optionalString,
    VAPI_WEBHOOK_SECRET: optionalString,

    STRIPE_SECRET_KEY: optionalString,
    STRIPE_WEBHOOK_SECRET: optionalString,
    STRIPE_PRICE_PRO_MONTHLY: optionalString,
    STRIPE_PRICE_SCALE_MONTHLY: optionalString,

    RAZORPAY_KEY_ID: optionalString,
    RAZORPAY_KEY_SECRET: optionalString,
    RAZORPAY_WEBHOOK_SECRET: optionalString,

    N8N_URL: optionalString,
    N8N_API_KEY: optionalString,
    N8N_WEBHOOK_SECRET: optionalString,

    STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
    STORAGE_LOCAL_DIR: z.string().default(".storage"),
    S3_ENDPOINT: optionalString,
    S3_REGION: z.string().default("us-east-1"),
    S3_BUCKET: optionalString,
    S3_ACCESS_KEY_ID: optionalString,
    S3_SECRET_ACCESS_KEY: optionalString,
    S3_FORCE_PATH_STYLE: bool(true),

    SLACK_WEBHOOK_URL: optionalString,
  })
  .superRefine((env, ctx) => {
    if (env.APP_ENV === "production" && env.DEMO_MODE) {
      ctx.addIssue({
        code: "custom",
        path: ["DEMO_MODE"],
        message: "DEMO_MODE must be false when APP_ENV=production",
      });
    }
    if (env.APP_ENV === "production" && env.QUEUE_DRIVER === "inline") {
      ctx.addIssue({
        code: "custom",
        path: ["QUEUE_DRIVER"],
        message: "QUEUE_DRIVER=inline is for local development only",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Walks up from `start` to the monorepo root (the directory containing turbo.json). */
export function findRepoRoot(start: string = process.cwd()): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, "turbo.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

/** Loads the repo-root `.env` into process.env (existing variables win). */
export function loadRootEnv(): void {
  const root = findRepoRoot();
  const file = join(root, ".env");
  if (existsSync(file)) loadDotenv({ path: file, quiet: true });
}

let rootEnvLoaded = false;

export function getEnv(): Env {
  if (cached) return cached;
  // Every process (Next.js render workers, the queue worker, scripts) loads the single
  // repo-root .env on first access; variables already set in the environment win.
  if (!rootEnvLoaded) {
    rootEnvLoaded = true;
    loadRootEnv();
  }
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test helper: drop the memoised env so tests can mutate process.env. */
export function resetEnvCache(): void {
  cached = undefined;
}

export function isDemoMode(): boolean {
  return getEnv().DEMO_MODE;
}
