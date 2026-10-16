import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldHalf } from "lucide-react";
import { isPlatformAdmin } from "@repo/core/platform/admin";
import { Aurora, Badge, Callout } from "@repo/ui";
import { AdminSignOutButton } from "@/components/admin/admin-header";
import { LoginForm } from "@/components/auth/auth-forms";
import { Logo } from "@/components/brand/logo";
import { authConfig } from "@/lib/auth";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Admin sign in", robots: { index: false } };
export const dynamic = "force-dynamic";

/** The admin portal's own sign-in. Admins go straight in; a business account is told it can't. */
export default async function AdminLoginPage() {
  const session = await getSession();
  const admin = session ? isPlatformAdmin(session.user.email, session.user.emailVerified) : false;
  if (session && admin) redirect("/admin");
  return (
    <main className="relative isolate flex min-h-dvh items-center justify-center px-6 py-10">
      <Aurora intensity={0.45} className="-z-10" />
      <div
        aria-hidden
        className="bg-grid absolute inset-0 -z-10 opacity-30 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]"
      />
      <div className="w-full max-w-[380px] animate-rise rounded-xl border border-border bg-surface p-6 shadow-md sm:p-7">
        <div className="mb-6 flex items-center gap-3">
          <Logo />
          <Badge tone="danger">
            <ShieldHalf className="size-3" /> Admin
          </Badge>
        </div>
        {session ? (
          <div className="grid gap-4">
            <Callout tone="warning" title="No admin access">
              {session.user.email} is a business account. Only the emails set in
              PLATFORM_ADMIN_EMAILS can open the admin portal.
            </Callout>
            <AdminSignOutButton />
          </div>
        ) : (
          <Suspense>
            <LoginForm admin googleEnabled={authConfig.googleConfigured} />
          </Suspense>
        )}
      </div>
    </main>
  );
}
