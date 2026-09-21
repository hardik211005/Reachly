import type { Metadata } from "next";
import { prisma } from "@repo/db";
import { readUnsubscribeToken } from "@repo/core/outreach/unsubscribe";
import { Logo } from "@/components/brand/logo";
import { UnsubscribeForm } from "./unsubscribe-form";

export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false } };

function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  const visible = local.slice(0, 2);
  return `${visible}${"•".repeat(Math.max(1, local.length - 2))}@${domain}`;
}

/**
 * Public unsubscribe page linked from every outreach email. Link scanners pre-fetch URLs,
 * so the GET only shows a confirmation; the unsubscribe happens on an explicit POST.
 */
export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const payload = readUnsubscribeToken(token);
  const organization = payload ? await prisma.organization.findUnique({ where: { id: payload.o }, select: { name: true } }) : null;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6 shadow-sm">
        {payload && organization ? (
          <UnsubscribeForm token={token} email={maskEmail(payload.e)} sender={organization.name} />
        ) : (
          <div>
            <h1 className="text-base font-semibold">This link has expired</h1>
            <p className="mt-2 text-[13px] text-foreground-muted">
              The unsubscribe link is invalid or too old. Reply to the email with “unsubscribe” and the sender will stop contacting you.
            </p>
          </div>
        )}
      </div>
      <div className="mt-6 flex items-center gap-2 text-xs text-foreground-subtle">
        Sent via <Logo className="scale-90 opacity-70" />
      </div>
    </main>
  );
}
