import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { can } from "@repo/core/context";
import { listCampaignsWithStats } from "@repo/core/campaigns/stats";
import { countPendingApprovals } from "@repo/core/outreach/approvals";
import { Button, PageHeader } from "@repo/ui";
import { CampaignsList, type CampaignListItem } from "@/components/campaigns/campaigns-list";
import { PageContainer } from "@/components/page";
import { PageGuide } from "@/components/page-guide";
import { requireWorkspace } from "@/lib/session";

export const metadata: Metadata = { title: "Send offers" };

export default async function CampaignsPage() {
  const { ctx } = await requireWorkspace();
  const [pendingApproval, campaigns] = await Promise.all([
    countPendingApprovals(ctx),
    listCampaignsWithStats(ctx),
  ]);
  return (
    <PageContainer wide>
      <PageHeader
        title="Send offers"
        description="Send a personal message to many businesses at once by email or WhatsApp, with polite follow-ups. Nothing goes out until you approve it."
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
      <div className="mb-5">
        <PageGuide
          id="send-offers"
          title="How sending offers works"
          steps={[
            {
              title: "Choose who gets it",
              body: "Pick businesses from your customer list — for example, cafés near you with a good score.",
            },
            {
              title: "We write each message",
              body: "A personal email or WhatsApp for every business. You read and approve it before anything is sent.",
            },
            {
              title: "Follow-ups stop on reply",
              body: "Polite reminders go out if there's no answer. When someone replies, it appears in Replies.",
            },
          ]}
        />
      </div>
      <CampaignsList
        pendingApproval={pendingApproval}
        initial={JSON.parse(JSON.stringify(campaigns)) as CampaignListItem[]}
      />
    </PageContainer>
  );
}
