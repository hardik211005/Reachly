import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolvePlan } from "@repo/core/billing/plans";
import { NotFoundError } from "@repo/core/errors";
import { getLead, getLeadTimeline } from "@repo/core/leads/service";
import { listMembers } from "@repo/core/organizations/service";
import { channelAvailability } from "@repo/core/outreach/providers";
import { LeadWorkspace, type LeadDetail } from "@/components/leads/lead-workspace";
import { PageContainer } from "@/components/page";
import { requireWorkspace } from "@/lib/session";

export const metadata: Metadata = { title: "Lead" };

/** Serialises Prisma rows (Dates, Decimals) into the plain JSON the client components expect. */
function serialize<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function loadLead(ctx: Awaited<ReturnType<typeof requireWorkspace>>["ctx"], id: string) {
  try {
    return await Promise.all([getLead(ctx, id), getLeadTimeline(ctx, id), channelAvailability(ctx)]);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

const TABS = new Set(["overview", "outreach", "activity", "contacts", "deals", "tasks", "sources"]);

export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { ctx } = await requireWorkspace();
  const [{ id }, { tab }] = await Promise.all([params, searchParams]);
  const [[lead, timeline, providers], plan, members, org] = await Promise.all([
    loadLead(ctx, id),
    resolvePlan(ctx),
    listMembers(ctx.organizationId),
    ctx.db.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { currency: true } }),
  ]);
  const crm = { members: members.map((member) => ({ id: member.user.id, name: member.user.name })), currency: org.currency, quotesEnabled: Boolean(plan.features.quotes), planName: plan.name };
  return (
    <PageContainer wide>
      <LeadWorkspace lead={serialize<LeadDetail>(lead)} timeline={serialize(timeline)} providers={providers} crm={crm} initialTab={tab && TABS.has(tab) ? tab : "overview"} />
    </PageContainer>
  );
}
