import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NotFoundError } from "@repo/core/errors";
import { getLead, getLeadTimeline } from "@repo/core/leads/service";
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

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requireWorkspace();
  const { id } = await params;
  const [lead, timeline, providers] = await loadLead(ctx, id);
  return (
    <PageContainer wide>
      <LeadWorkspace lead={serialize<LeadDetail>(lead)} timeline={serialize(timeline)} providers={providers} />
    </PageContainer>
  );
}
