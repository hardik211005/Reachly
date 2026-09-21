import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCampaign } from "@repo/core/campaigns/service";
import { NotFoundError } from "@repo/core/errors";
import { channelAvailability } from "@repo/core/outreach/providers";
import { CampaignDetail, type CampaignDetailData } from "@/components/campaigns/campaign-detail";
import { PageContainer } from "@/components/page";
import { requireWorkspace } from "@/lib/session";

export const metadata: Metadata = { title: "Campaign" };

async function load(ctx: Awaited<ReturnType<typeof requireWorkspace>>["ctx"], id: string) {
  try {
    return await Promise.all([getCampaign(ctx, id), channelAvailability(ctx)]);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requireWorkspace();
  const { id } = await params;
  const [campaign, providers] = await load(ctx, id);
  return (
    <PageContainer wide>
      <CampaignDetail initial={JSON.parse(JSON.stringify(campaign)) as CampaignDetailData} providers={providers} />
    </PageContainer>
  );
}
