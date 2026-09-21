import type { Metadata } from "next";
import { getCategory } from "@repo/config/taxonomy";
import { resolvePlan } from "@repo/core/billing/plans";
import { readIcp } from "@repo/core/business/service";
import { campaignTargetSchema } from "@repo/core/campaigns/schemas";
import { PageHeader } from "@repo/ui";
import { DiscoverView, type DiscoverDefaults } from "@/components/discover/discover-view";
import { PageContainer } from "@/components/page";
import { requireWorkspace } from "@/lib/session";

export const metadata: Metadata = { title: "Discover" };

function labelFor(key: string): string {
  return getCategory(key)?.label ?? key.replace(/_/g, " ");
}

export default async function DiscoverPage({ searchParams }: { searchParams: Promise<{ campaignId?: string }> }) {
  const { ctx } = await requireWorkspace();
  const { campaignId } = await searchParams;
  const [profile, offerings, plan, campaign] = await Promise.all([
    ctx.db.businessProfile.findFirst(),
    ctx.db.offering.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { createdAt: "asc" }, take: 3 }),
    resolvePlan(ctx),
    campaignId ? ctx.db.campaign.findFirst({ where: { id: campaignId, deletedAt: null } }) : Promise.resolve(null),
  ]);
  const icp = profile ? readIcp(profile.icp) : null;
  const target = campaign ? campaignTargetSchema.safeParse(campaign.target) : null;
  const categories = target?.success && target.data.categories.length ? target.data.categories : (icp?.targetCategories.slice(0, 3) ?? []);

  const defaults: DiscoverDefaults = {
    offer: campaign?.offerSummary ?? offerings[0]?.name ?? "",
    audience: categories.map(labelFor).join(", "),
    location: target?.success && target.data.locations[0] ? target.data.locations[0].label : (icp?.recommendedLocations[0] ?? profile?.city ?? ""),
    radiusKm: target?.success ? target.data.radiusKm : 25,
    campaign: campaign ? { id: campaign.id, name: campaign.name } : null,
    maxResults: plan.limits.resources.discoveryResultsPerSearch,
  };

  return (
    <PageContainer wide>
      <PageHeader
        title="Find potential customers"
        description="Tell us what you sell and who buys it. We search approved data sources, enrich every business, and score it against your ideal customer profile."
        className="mb-6"
      />
      <DiscoverView defaults={defaults} />
    </PageContainer>
  );
}
