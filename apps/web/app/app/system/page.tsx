import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";
import { roleHas } from "@repo/core/rbac";
import { EmptyState } from "@repo/ui";
import { SystemView } from "@/components/system/system-view";
import { requireWorkspace } from "@/lib/session";
import { PageContainer } from "@/components/page";

export const metadata: Metadata = { title: "System health" };

export default async function SystemPage() {
  const { membership } = await requireWorkspace();
  if (!roleHas(membership.role, "system:read")) {
    return (
      <PageContainer>
        <EmptyState icon={ShieldAlert} title="Admins only" description="Ask a workspace admin if you need to check system health." />
      </PageContainer>
    );
  }
  return (
    <PageContainer wide>
      <SystemView />
    </PageContainer>
  );
}
