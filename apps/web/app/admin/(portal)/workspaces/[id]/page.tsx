import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { isPlatformAdmin } from "@repo/core/platform/admin";
import { getWorkspaceDetail } from "@repo/core/platform/monitor";
import { WorkspaceDetail } from "@/components/admin/workspace-detail";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Workspace · Platform admin", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function AdminWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  const { id } = await params;
  if (!session) redirect("/admin/login");
  if (!isPlatformAdmin(session.user.email, session.user.emailVerified)) notFound();
  const detail = await getWorkspaceDetail(id).catch(() => null);
  if (!detail) notFound();
  return (
    <WorkspaceDetail detail={JSON.parse(JSON.stringify(detail))} now={new Date().toISOString()} />
  );
}
