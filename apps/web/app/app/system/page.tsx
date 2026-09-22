import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";
import { roleHas } from "@repo/core/rbac";
import { EmptyState } from "@repo/ui";
import { SystemView } from "@/components/system/system-view";
import { requireWorkspace } from "@/lib/session";

export const metadata: Metadata = { title: "System health" };

export default async function SystemPage() {
  const { membership } = await requireWorkspace();
  if (!roleHas(membership.role, "system:read")) {
    return <EmptyState icon={ShieldAlert} title="Admins only" description="Ask a workspace admin if you need to check system health." />;
  }
  return <SystemView />;
}
