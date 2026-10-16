import type { Metadata } from "next";
import Link from "next/link";
import { previewInvitation } from "@repo/core/organizations/members";
import { Aurora, Button } from "@repo/ui";
import { Logo } from "@/components/brand/logo";
import { AcceptInvitation } from "@/components/auth/accept-invitation";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Join a workspace" };

const MESSAGES = {
  expired: { title: "This invitation has expired", body: "Invitations last 7 days. Ask whoever invited you to send a new one." },
  used: { title: "This invitation was already used", body: "If that was you, just sign in." },
  revoked: { title: "This invitation was withdrawn", body: "Ask the workspace admin to invite you again." },
  not_found: { title: "We couldn't find that invitation", body: "The link may be incomplete. Try copying it again from the email." },
} as const;

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [invitation, session] = await Promise.all([previewInvitation(token), getSession()]);
  const next = `/invite/${token}`;

  return (
    <main className="relative isolate flex min-h-dvh items-center justify-center overflow-hidden px-6 py-16">
      <Aurora intensity={1.1} />
      <div aria-hidden className="bg-grid absolute inset-0 -z-10 opacity-40 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" />
      <Link href="/" className="absolute top-6 left-6" aria-label="Home">
        <Logo />
      </Link>
      <div className="w-full max-w-md animate-rise rounded-2xl border border-border bg-surface/90 p-8 text-center shadow-lg backdrop-blur">
        {invitation.state === "valid" ? (
          <>
            <p className="text-xs font-semibold tracking-[0.14em] text-brand-1 uppercase">You&apos;re invited</p>
            <h1 className="mt-3 text-[24px] leading-tight font-semibold tracking-[-0.02em]">
              Join <span className="text-gradient">{invitation.workspace}</span>
            </h1>
            <p className="mt-3 text-[14px] leading-relaxed text-foreground-secondary">
              {invitation.invitedBy ?? "A teammate"} invited <span className="font-medium text-foreground">{invitation.email}</span> to join as {invitation.role.toLowerCase()}.
            </p>
            <div className="mt-7">
              {session ? (
                <AcceptInvitation token={token} signedInAs={session.user.email} invitedEmail={invitation.email} />
              ) : (
                <div className="grid gap-2">
                  <Button asChild variant="primary" size="lg">
                    <Link href={`/signup?next=${encodeURIComponent(next)}&email=${encodeURIComponent(invitation.email)}`}>Create an account to join</Link>
                  </Button>
                  <Button asChild variant="secondary" size="lg">
                    <Link href={`/login?next=${encodeURIComponent(next)}`}>I already have an account</Link>
                  </Button>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <h1 className="text-[22px] font-semibold tracking-[-0.02em]">{MESSAGES[invitation.state].title}</h1>
            <p className="mt-2 text-[14px] text-foreground-secondary">{MESSAGES[invitation.state].body}</p>
            <Button asChild variant="secondary" className="mt-6">
              <Link href={session ? "/app" : "/login"}>{session ? "Go to your workspace" : "Sign in"}</Link>
            </Button>
          </>
        )}
      </div>
    </main>
  );
}
