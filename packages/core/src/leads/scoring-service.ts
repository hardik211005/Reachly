import { CITIES, matchArea, matchCity } from "@repo/config/taxonomy";
import type { Prisma } from "@repo/db";
import { leadQualificationAgent } from "../ai/agents/lead-qualification";
import { runAgent } from "../ai/service";
import { hasFeature } from "../billing/plans";
import { readIcp } from "../business/service";
import { campaignTargetSchema } from "../campaigns/schemas";
import type { TenantContext } from "../context";
import { NotFoundError } from "../errors";
import { recordEvent } from "../events";
import { logger } from "../logger";
import { DEFAULT_SCORING_WEIGHTS, type ScoringFactor } from "./scoring-defaults";
import { recomputeTotal, scoreLead as computeScore, scoringRuleSchema, type ScoreResult, type ScoringContext, type ScoringTarget } from "./scoring";
import type { LeadSignal } from "./signals";

/** Resolves free-text locations ("South Delhi", "Gurugram") to coordinates/localities where known. */
export function resolveLocation(label: string): ScoringTarget["locations"][number] {
  const city = matchCity(label);
  if (!city) return { label, city: label, lat: null, lng: null };
  const area = matchArea(label, city);
  if (area && area.localities.length) {
    const points = city.localities.filter((locality) => area.localities.includes(locality.name));
    const lat = points.reduce((sum, point) => sum + point.lat, 0) / Math.max(1, points.length);
    const lng = points.reduce((sum, point) => sum + point.lng, 0) / Math.max(1, points.length);
    return { label, city: city.name, lat: points.length ? lat : city.lat, lng: points.length ? lng : city.lng, localities: area.localities };
  }
  return { label, city: city.name, lat: city.lat, lng: city.lng };
}

export { CITIES };

async function scoringContext(ctx: TenantContext, campaignId: string | null): Promise<{ context: ScoringContext; offer: string | null; useAI: boolean }> {
  const [profile, scoring, campaign] = await Promise.all([
    ctx.db.businessProfile.findFirst(),
    ctx.db.scoringProfile.findFirst(),
    campaignId ? ctx.db.campaign.findFirst({ where: { id: campaignId } }) : Promise.resolve(null),
  ]);
  const icp = profile ? readIcp(profile.icp) : null;
  const target = campaign ? campaignTargetSchema.safeParse(campaign.target) : null;
  const rules = scoringRuleSchema.array().safeParse(scoring?.rules ?? []);

  const locations = target?.success && target.data.locations.length
    ? target.data.locations.map((location) =>
        location.lat !== null && location.lng !== null ? { ...location, localities: undefined } : resolveLocation(location.label),
      )
    : (icp?.recommendedLocations ?? (profile?.city ? [profile.city] : [])).map(resolveLocation);

  return {
    context: {
      icp,
      target: {
        categories: target?.success ? target.data.categories : [],
        locations,
        radiusKm: target?.success ? target.data.radiusKm : 25,
        preferredSignals: [],
        criteria: target?.success ? target.data.criteria : null,
      },
      weights: { ...DEFAULT_SCORING_WEIGHTS, ...((scoring?.weights ?? {}) as Partial<Record<ScoringFactor, number>>) },
      rules: rules.success ? rules.data : [],
      qualifiedThreshold: scoring?.qualifiedThreshold ?? 65,
      highFitThreshold: scoring?.highFitThreshold ?? 80,
    },
    offer: campaign?.offerSummary ?? icp?.valueProposition ?? profile?.valueProposition ?? null,
    useAI: scoring?.useAI ?? true,
  };
}

export interface ScoreLeadOptions {
  campaignId?: string | null;
  /** Extra signals the discovery request asked for (e.g. "2+ locations"). */
  preferredSignals?: string[];
  criteria?: string | null;
  /** What is being offered in this search (overrides the campaign/ICP offer). */
  offer?: string | null;
  /** Override target for discovery runs that aren't tied to a campaign. */
  target?: Partial<ScoringTarget>;
}

export async function scoreLeadById(ctx: TenantContext, leadId: string, options: ScoreLeadOptions = {}): Promise<ScoreResult & { reasoning: string | null }> {
  const lead = await ctx.db.lead.findFirst({ where: { id: leadId, deletedAt: null }, include: { contacts: { where: { deletedAt: null } } } });
  if (!lead) throw new NotFoundError("Lead", leadId);

  const campaignId = options.campaignId ?? lead.primaryCampaignId;
  const { context, offer: defaultOffer, useAI } = await scoringContext(ctx, campaignId);
  const offer = options.offer ?? defaultOffer;
  if (options.target) context.target = { ...context.target, ...options.target };
  if (options.preferredSignals?.length) context.target.preferredSignals = options.preferredSignals;
  if (options.criteria) context.target.criteria = options.criteria;

  const signals = (Array.isArray(lead.signals) ? lead.signals : []) as unknown as LeadSignal[];
  const scorable = {
    name: lead.name,
    category: lead.category,
    industry: lead.industry,
    city: lead.city,
    locality: lead.locality,
    latitude: lead.latitude,
    longitude: lead.longitude,
    website: lead.website,
    email: lead.email,
    phone: lead.phone,
    socialProfiles: (lead.socialProfiles ?? {}) as Record<string, string>,
    reviewCount: lead.reviewCount,
    rating: lead.rating ? Number(lead.rating) : null,
    locationsCount: lead.locationsCount,
    signals,
    contacts: lead.contacts.map((contact) => ({ name: contact.name, email: contact.email, phone: contact.phone })),
    doNotContact: lead.doNotContact,
  };

  let result = computeScore(scorable, context);
  let reasoning: string | null = null;
  let aiRequestId: string | null = null;

  // AI qualification (plan feature + workspace setting). Failures fall back to rules only.
  if (useAI && !lead.doNotContact && (await hasFeature(ctx, "aiQualification"))) {
    try {
      const factors = Object.fromEntries(result.breakdown.map((item) => [item.factor, item.score]));
      const { output, meta } = await runAgent(
        ctx,
        leadQualificationAgent,
        {
          lead: {
            name: lead.name,
            category: lead.category,
            industry: lead.industry,
            locality: lead.locality,
            city: lead.city,
            description: lead.description,
            services: lead.services,
            locationsCount: lead.locationsCount,
            reviewCount: lead.reviewCount,
            rating: scorable.rating,
            hasWebsite: Boolean(lead.website),
            hasEmail: Boolean(scorable.email ?? scorable.contacts.find((contact) => contact.email)),
            signals: signals.map((signal) => ({ key: signal.key, evidence: signal.evidence })),
          },
          seller: {
            summary: context.icp?.summary ?? null,
            offer,
            mustHaves: context.icp?.idealCustomerProfile.mustHaves ?? [],
            disqualifiers: context.icp?.idealCustomerProfile.disqualifiers ?? [],
            buyingSignals: [...(context.icp?.buyingSignals.map((signal) => signal.key) ?? []), ...context.target.preferredSignals],
          },
          ruleFactors: factors,
        },
        { leadId: lead.id, campaignId },
      );
      aiRequestId = meta.aiRequestId;
      reasoning = output.summary;
      result = {
        ...result,
        breakdown: result.breakdown.map((item) => {
          if (item.factor === "icpMatch") {
            return { ...item, score: Math.round(item.score * 0.6 + output.relevance * 0.4), reasons: [...item.reasons, ...output.reasons.slice(0, 2).map((reason) => `AI: ${reason}`)] };
          }
          if (item.factor === "buyingSignals") {
            return { ...item, score: Math.round(item.score * 0.6 + output.buyingSignalScore * 0.4), reasons: [...item.reasons, ...output.risks.slice(0, 2).map((risk) => `AI risk: ${risk}`)] };
          }
          return item;
        }),
      };
      result = recomputeTotal(result, context, lead.doNotContact);
    } catch (error) {
      logger.warn({ err: error, leadId }, "AI qualification failed; using rule-based score only");
    }
  }

  const previousStatus = lead.status;
  await ctx.db.leadScore.create({
    data: {
      organizationId: ctx.organizationId,
      leadId: lead.id,
      campaignId,
      total: result.total,
      fitTier: result.fitTier,
      qualification: result.qualification,
      breakdown: { factors: result.breakdown, adjustments: result.adjustments } as unknown as Prisma.InputJsonValue,
      reasoning,
      scoringVersion: aiRequestId ? `${result.version}+ai` : result.version,
      aiRequestId,
    },
  });
  const promote = result.qualification === "QUALIFIED" && previousStatus === "NEW";
  await ctx.db.lead.update({
    where: { id: lead.id },
    data: {
      score: result.total,
      fitTier: result.fitTier,
      qualification: result.qualification,
      aiSummary: reasoning ?? lead.aiSummary,
      ...(promote ? { status: "QUALIFIED" } : {}),
    },
  });

  await recordEvent(ctx, {
    type: "lead_scored",
    leadId: lead.id,
    campaignId,
    properties: { total: result.total, fitTier: result.fitTier, qualification: result.qualification, ai: Boolean(aiRequestId) },
  });
  if (promote) {
    await recordEvent(ctx, { type: "lead_qualified", leadId: lead.id, campaignId, properties: { score: result.total } });
  }
  return { ...result, reasoning };
}
