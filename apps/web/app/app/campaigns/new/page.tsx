import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { formatCurrency } from "@repo/ui";
import { listOfferings } from "@repo/core/business/service";
import { resolvePlan } from "@repo/core/billing/plans";
import { can } from "@repo/core/context";
import { leadFilterOptions } from "@repo/core/leads/service";
import { channelAvailability } from "@repo/core/outreach/providers";
import { listWhatsAppTemplates } from "@repo/core/outreach/whatsapp-templates";
import { PageHeader } from "@repo/ui";
import { CampaignBuilder, type BuilderOptions } from "@/components/campaigns/campaign-builder";
import { PageContainer } from "@/components/page";
import { requireWorkspace } from "@/lib/session";

export const metadata: Metadata = { title: "New campaign" };

export default async function NewCampaignPage() {
  const { ctx } = await requireWorkspace();
  if (!can(ctx, "campaigns:write")) redirect("/app/campaigns");

  const [offerings, filters, plan, providers, templates, profile] = await Promise.all([
    listOfferings(ctx),
    leadFilterOptions(ctx),
    resolvePlan(ctx),
    channelAvailability(ctx),
    listWhatsAppTemplates(ctx),
    ctx.db.businessProfile.findFirst({ select: { outreachTone: true } }),
  ]);

  const options: BuilderOptions = {
    offerings: offerings
      .filter((offering) => offering.isActive)
      .map((offering) => ({
        id: offering.id,
        name: offering.name,
        description: offering.description,
        price: offering.unitPrice !== null ? `${formatCurrency(Number(offering.unitPrice), offering.currency)} / ${offering.unit}` : null,
      })),
    categories: filters.categories,
    cities: filters.cities,
    plan: { name: plan.name, automationModes: [...plan.features.automationModes], channels: [...plan.features.channels] },
    providers,
    voiceAvailable: false,
    templates: templates.templates.map((template) => ({ id: template.id, name: template.name, body: template.body, status: template.status, language: template.language })),
    defaultTone: profile?.outreachTone ?? "professional",
  };

  return (
    <PageContainer wide>
      <Link href="/app/campaigns" className="mb-3 inline-flex items-center gap-1 text-xs text-foreground-muted hover:text-foreground">
        <ArrowLeft className="size-3" /> Campaigns
      </Link>
      <PageHeader title="New campaign" description="Five short steps. Nothing is sent until you review the estimate and confirm the launch." className="mb-6" />
      <CampaignBuilder options={options} />
    </PageContainer>
  );
}
