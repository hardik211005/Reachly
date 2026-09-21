import "server-only";
import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { brand } from "@repo/config";
import { getEnv } from "@repo/config/env";
import { sendTransactionalEmail, simpleEmailHtml } from "@repo/core/email/platform";
import { prisma } from "@repo/db";

const env = getEnv();
const googleConfigured = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

/**
 * Better Auth: email/password (+ verification and reset), Google OAuth when configured,
 * database sessions in Postgres. Additional providers (Microsoft, GitHub, SSO) plug into
 * `socialProviders` / plugins without touching the rest of the app.
 */
export const auth = betterAuth({
  appName: brand.name,
  baseURL: env.APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    requireEmailVerification: env.AUTH_REQUIRE_EMAIL_VERIFICATION,
    resetPasswordTokenExpiresIn: 60 * 60,
    sendResetPassword: async ({ user, url }) => {
      await sendTransactionalEmail({
        to: user.email,
        subject: `Reset your ${brand.name} password`,
        text: `Reset your password: ${url}\n\nThis link expires in 1 hour. If you didn't request it, ignore this email.`,
        html: simpleEmailHtml("Reset your password", "This link expires in 1 hour. If you didn't request a reset, you can ignore this email.", {
          label: "Reset password",
          url,
        }),
      });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendTransactionalEmail({
        to: user.email,
        subject: `Verify your email for ${brand.name}`,
        text: `Confirm your email address: ${url}`,
        html: simpleEmailHtml("Confirm your email", "Confirm your email address to finish setting up your account.", {
          label: "Verify email",
          url,
        }),
      });
    },
  },
  socialProviders: googleConfigured
    ? { google: { clientId: env.GOOGLE_CLIENT_ID as string, clientSecret: env.GOOGLE_CLIENT_SECRET as string } }
    : {},
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 60,
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
      "/sign-up/email": { window: 60, max: 5 },
      "/forget-password": { window: 300, max: 5 },
      "/request-password-reset": { window: 300, max: 5 },
    },
  },
  advanced: {
    database: { generateId: () => randomUUID() },
    useSecureCookies: env.APP_URL.startsWith("https://"),
  },
  trustedOrigins: [env.APP_URL],
  plugins: [nextCookies()],
});

export const authConfig = { googleConfigured, requireEmailVerification: env.AUTH_REQUIRE_EMAIL_VERIFICATION };

export type AuthSession = typeof auth.$Infer.Session;
