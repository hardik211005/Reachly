import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getPlatformOverview, isPlatformAdmin } from "@repo/core/platform/admin";
import {
  getPlatformActivity,
  getPlatformFeed,
  getPlatformHealth,
} from "@repo/core/platform/monitor";
import { PlatformAdmin } from "@/components/admin/platform-admin";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Platform admin", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Every workspace and user on this deployment. Only PLATFORM_ADMIN_EMAILS can see it. */
export default async function AdminPage() {
  const session = await getSession();
  if (!session) redirect("/admin/login");
  // Anyone else gets a plain 404, so the page's existence isn't advertised.
  if (!isPlatformAdmin(session.user.email, session.user.emailVerified)) notFound();
  const [overview, activity, feed, health] = await Promise.all([
    getPlatformOverview(),
    getPlatformActivity(30),
    getPlatformFeed(40),
    getPlatformHealth(),
  ]);
  return (
    <PlatformAdmin
      overview={JSON.parse(JSON.stringify(overview))}

      activity={activity}
      feed={feed}
      health={health}
    />
  );
}
