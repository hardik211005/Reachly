import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getPlatformOverview, isPlatformAdmin } from "@repo/core/platform/admin";
import { PlatformAdmin } from "@/components/admin/platform-admin";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Platform admin", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Every workspace and user on this deployment. Only PLATFORM_ADMIN_EMAILS can see it. */
export default async function AdminPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/admin");
  // Anyone else gets a plain 404, so the page's existence isn't advertised.
  if (!isPlatformAdmin(session.user.email, session.user.emailVerified)) notFound();
  const overview = await getPlatformOverview();
  return <PlatformAdmin overview={JSON.parse(JSON.stringify(overview))} viewer={session.user.email} />;
}
