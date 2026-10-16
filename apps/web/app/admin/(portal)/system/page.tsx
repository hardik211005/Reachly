import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { isPlatformAdmin } from "@repo/core/platform/admin";
import { SystemView } from "@/components/system/system-view";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Server health · Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Database, Redis, workers and dead letters. Admin portal only. */
export default async function AdminSystemPage() {
  const session = await getSession();
  if (!session) redirect("/admin/login");
  if (!isPlatformAdmin(session.user.email, session.user.emailVerified)) notFound();
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      <SystemView />
    </div>
  );
}
