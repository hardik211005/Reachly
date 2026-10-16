import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Aurora } from "@repo/ui";
import { isPlatformAdmin } from "@repo/core/platform/admin";
import { AdminHeader } from "@/components/admin/admin-header";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * The admin portal: its own sign-in (/admin/login), header and pages, not linked from the business
 * app. Only PLATFORM_ADMIN_EMAILS get in; anyone else signed in gets a plain 404. Each page checks
 * again, because layouts don't re-run on every client navigation.
 */
export default async function AdminPortalLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/admin/login");
  if (!isPlatformAdmin(session.user.email, session.user.emailVerified)) notFound();
  return (
    <div className="relative isolate min-h-dvh">
      <Aurora intensity={0.5} className="-z-10" />
      <AdminHeader viewer={session.user.email} />
      {children}
    </div>
  );
}
