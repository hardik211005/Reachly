import type { Metadata } from "next";
import { resolvePlan } from "@repo/core/billing/plans";
import { listMembers } from "@repo/core/organizations/service";
import { CrmView, type CrmTab } from "@/components/crm/crm-view";
import { PageContainer } from "@/components/page";
import { requireWorkspace } from "@/lib/session";

export const metadata: Metadata = { title: "CRM" };

const TABS: readonly CrmTab[] = ["pipeline", "tasks", "meetings", "quotes", "contacts", "catalog"];

export default async function CrmPage({ searchParams }: { searchParams: Promise<{ tab?: string; deal?: string }> }) {
  const { ctx } = await requireWorkspace();
  const [plan, members, org, params] = await Promise.all([
    resolvePlan(ctx),
    listMembers(ctx.organizationId),
    ctx.db.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { currency: true } }),
    searchParams,
  ]);
  const tab = TABS.includes(params.tab as CrmTab) ? (params.tab as CrmTab) : "pipeline";
  return (
    <PageContainer wide>
      <CrmView
        settings={{ members: members.map((member) => ({ id: member.user.id, name: member.user.name })), currency: org.currency, quotesEnabled: Boolean(plan.features.quotes), planName: plan.name }}
        initialTab={tab}
        initialDeal={params.deal ?? null}
      />
    </PageContainer>
  );
}
