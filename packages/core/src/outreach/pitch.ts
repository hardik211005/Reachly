import { pitchPackAgent } from "../ai/agents/outreach";
import { runAgent } from "../ai/service";
import { assertCan, type TenantContext } from "../context";
import { NotFoundError } from "../errors";
import { leadContext, sellerContext } from "./context";

/** A complete, editable set of sales assets for one lead (email, WhatsApp, call script, objections). */
export async function generatePitchPack(ctx: TenantContext, leadId: string, options: { campaignId?: string | null; tone?: string } = {}) {
  assertCan(ctx, "ai:use");
  const lead = await ctx.db.lead.findFirst({ where: { id: leadId, deletedAt: null }, include: { contacts: { where: { deletedAt: null } } } });
  if (!lead) throw new NotFoundError("Lead", leadId);
  const campaign = options.campaignId ? await ctx.db.campaign.findFirst({ where: { id: options.campaignId, deletedAt: null } }) : null;
  const profile = await ctx.db.businessProfile.findFirst({ select: { outreachTone: true } });
  const seller = await sellerContext(ctx, {
    offer: campaign?.offerSummary,
    pitchAngle: campaign?.pitchAngle,
    offeringIds: campaign?.offeringIds,
    includePricing: true,
  });
  const { output, meta } = await runAgent(
    ctx,
    pitchPackAgent,
    { tone: options.tone ?? campaign?.tone ?? profile?.outreachTone ?? "friendly and professional", lead: leadContext(lead), seller },
    { leadId, campaignId: campaign?.id ?? null },
  );
  return { pack: output, meta: { provider: meta.provider, model: meta.model, cached: meta.cached, credits: meta.credits, simulated: meta.provider === "mock" } };
}
