import {
  MockEmailProvider,
  ResendEmailProvider,
  SendGridEmailProvider,
  SmtpEmailProvider,
  type EmailProvider,
} from "@repo/integrations";
import { brand } from "@repo/config";
import { getEnv } from "@repo/config/env";
import { logger } from "../logger";

/**
 * Platform-level email provider (env configured). Used for system email — verification,
 * password resets, invitations, digests. Outreach email uses the organisation's own
 * connected provider when present (see outreach/providers.ts).
 */

type GlobalWithEmail = typeof globalThis & { __reachPlatformEmail?: EmailProvider };

export function getPlatformEmailProvider(): EmailProvider {
  const g = globalThis as GlobalWithEmail;
  if (g.__reachPlatformEmail) return g.__reachPlatformEmail;
  const env = getEnv();
  let provider: EmailProvider;
  switch (env.EMAIL_PROVIDER) {
    case "resend":
      provider = env.RESEND_API_KEY ? new ResendEmailProvider(env.RESEND_API_KEY, env.RESEND_WEBHOOK_SECRET) : new MockEmailProvider();
      break;
    case "sendgrid":
      provider = env.SENDGRID_API_KEY
        ? new SendGridEmailProvider(env.SENDGRID_API_KEY, env.SENDGRID_WEBHOOK_PUBLIC_KEY)
        : new MockEmailProvider();
      break;
    case "smtp":
      provider = env.SMTP_HOST
        ? new SmtpEmailProvider({
            host: env.SMTP_HOST,
            port: env.SMTP_PORT,
            secure: env.SMTP_SECURE,
            user: env.SMTP_USER,
            password: env.SMTP_PASSWORD,
          })
        : new MockEmailProvider();
      break;
    default:
      provider = new MockEmailProvider();
  }
  g.__reachPlatformEmail = provider;
  return provider;
}

export interface TransactionalEmail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendTransactionalEmail(email: TransactionalEmail): Promise<void> {
  const provider = getPlatformEmailProvider();
  const env = getEnv();
  if (provider.isMock) {
    // No email provider configured: surface the message in the server log so local
    // development (e.g. email verification links) still works end to end.
    logger.info({ to: email.to, subject: email.subject, body: email.text }, "[mock email] transactional email not sent — no provider configured");
    return;
  }
  await provider.send({ from: env.EMAIL_FROM, to: email.to, subject: email.subject, text: email.text, html: email.html });
}

export function simpleEmailHtml(title: string, body: string, action?: { label: string; url: string }): string {
  const escape = (value: string) => value.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
  return `<!doctype html><html><body style="margin:0;background:#f9f9f7;font-family:-apple-system,Segoe UI,Inter,sans-serif;color:#0b0b0b">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px">
<table width="480" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #e6e5e0;border-radius:10px;padding:32px">
<tr><td style="font-size:13px;font-weight:600;color:#52514e;padding-bottom:24px">${escape(brand.name)}</td></tr>
<tr><td style="font-size:18px;font-weight:600;padding-bottom:12px">${escape(title)}</td></tr>
<tr><td style="font-size:14px;line-height:1.6;color:#52514e;padding-bottom:24px">${escape(body)}</td></tr>
${action ? `<tr><td><a href="${escape(action.url)}" style="display:inline-block;background:#0b0b0b;color:#fff;text-decoration:none;font-size:14px;font-weight:500;padding:10px 18px;border-radius:6px">${escape(action.label)}</a></td></tr>` : ""}
</table></td></tr></table></body></html>`;
}
