import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { can } from "@repo/core/context";
import { listCampaignsWithStats } from "@repo/core/campaigns/stats";
import { countPendingApprovals } from "@repo/core/outreach/approvals";
import { Button, PageHeader } from "@repo/ui";
import { CampaignsList, type CampaignListItem } from "@/components/campaigns/campaigns-list";
import { PageContainer } from "@/components/page";
import { requireWorkspace } from "@/lib/session";

export const metadata: Metadata = { title: "Campaigns" };

export default async function CampaignsPage() {
  const { ctx } = await requireWorkspace();
  const [pendingApproval, campaigns] = await Promise.all([countPendingApprovals(ctx), listCampaignsWithStats(ctx)]);
  return (
    <PageContainer wide>
      <PageHeader
        title="Campaigns"
        description="Multi-step outreach sequences across email, WhatsApp and calls. Every number here comes from recorded events."
        actions={
          can(ctx, "campaigns:write") ? (
            <Button asChild variant="primary" size="sm">
              <Link href="/app/campaigns/new">
                <Plus /> New campaign
              </Link>
            </Button>
          ) : null
        }
        className="mb-5"
      />
      <CampaignsList pendingApproval={pendingApproval} initial={JSON.parse(JSON.stringify(campaigns)) as CampaignListItem[]} />
    </PageContainer>
  );
}
