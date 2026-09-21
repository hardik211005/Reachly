import type { Prisma } from "@repo/db";
import { getQueue } from "@repo/queue";
import { discoveryParserAgent } from "../ai/agents/discovery-parser";
import { runAgent } from "../ai/service";
import { audit } from "../audit";
import { resolvePlan } from "../billing/plans";
import { consumeUsage, isLimitError } from "../billing/usage";
import { readIcp } from "../business/service";
import { campaignTargetSchema } from "../campaigns/schemas";
import { assertCan, type TenantContext } from "../context";
import { NotFoundError, ValidationError } from "../errors";
import { recordEvent } from "../events";
import { logger } from "../logger";
import { notify } from "../notifications";
import { enrichLead } from "../leads/enrichment";
import { normalizeRawBusiness, type LeadCandidate } from "../leads/normalize";
import { resolveLeadProvider } from "../leads/providers";
import { resolveLocation, scoreLeadById } from "../leads/scoring-service";
import { mapWithConcurrency } from "../shared/concurrency";
import { discoveryRequestSchema, emptyStats, searchCriteriaSchema, type DiscoveryRequest, type DiscoveryStats, type SearchCriteria } from "./schemas";

/** Natural language → structured criteria (Discovery Parser agent), prefilled from the ICP. */
export async function parseDiscoveryQuery(ctx: TenantContext, query: string, campaignId?: string) {
  assertCan(ctx, "discovery:run");
  const [profile, offerings, campaign] = await Promise.all([
    ctx.db.businessProfile.findFirst(),
    ctx.db.offering.findMany({ where: { deletedAt: null, isActive: true }, select: { name: true } }),
    campaignId ? ctx.db.campaign.findFirst({ where: { id: campaignId, deletedAt: null } }) : Promise.resolve(null),
  ]);
  const icp = profile ? readIcp(profile.icp) : null;
  const campaignTarget = campaign ? campaignTargetSchema.safeParse(campaign.target) : null;

  const { output, meta } = await runAgent(ctx, discoveryParserAgent, {
    query,
    icpCategories: campaignTarget?.success && campaignTarget.data.categories.length ? campaignTarget.data.categories : (icp?.targetCategories ?? []),
    icpLocations: campaignTarget?.success && campaignTarget.data.locations.length ? campaignTarget.data.locations.map((l) => l.label) : (icp?.recommendedLocations ?? []),
    offerings: offerings.map((offering) => offering.name),
    defaultRadiusKm: campaignTarget?.success ? campaignTarget.data.radiusKm : 25,
  });

  const location = output.locationLabel ? resolveLocation(output.locationLabel) : null;
  const criteria: SearchCriteria = searchCriteriaSchema.parse({
    categories: output.categories,
    keywords: output.keywords,
    locations: location ? [{ label: location.label, city: location.city, lat: location.lat, lng: location.lng }] : [],
    radiusKm: output.radiusKm ?? (campaignTarget?.success ? campaignTarget.data.radiusKm : 25),
    criteria: output.criteria ?? (campaignTarget?.success ? campaignTarget.data.criteria : null),
    requireWebsite: output.requireWebsite,
    requireContact: true,
    preferredSignals: output.preferredSignals,
    offer: output.offer ?? campaign?.offerSummary ?? null,
  });
  return { criteria, interpretation: output.interpretation, meta: { provider: meta.provider, cached: meta.cached } };
}

export async function startDiscovery(ctx: TenantContext, input: DiscoveryRequest) {
  assertCan(ctx, "discovery:run");
  const request = discoveryRequestSchema.parse(input);
  const plan = await resolvePlan(ctx);
  const limit = Math.min(request.limit, plan.limits.resources.discoveryResultsPerSearch);

  let criteria = request.criteria ? searchCriteriaSchema.parse(request.criteria) : null;
  if (!criteria) {
    if (!request.query) throw new ValidationError("Describe what you're looking for or provide criteria");
    criteria = (await parseDiscoveryQuery(ctx, request.query, request.campaignId)).criteria;
  }
  if (!criteria.categories.length && !criteria.keywords.length) throw new ValidationError("Add at least one business category or keyword");
  if (request.campaignId) {
    const campaign = await ctx.db.campaign.findFirst({ where: { id: request.campaignId, deletedAt: null }, select: { id: true } });
    if (!campaign) throw new NotFoundError("Campaign", request.campaignId);
  }

  const provider = await resolveLeadProvider(ctx);
  const run = await ctx.db.discoveryRun.create({
    data: {
      organizationId: ctx.organizationId,
      createdById: ctx.userId,
      query: request.query || criteria.categories.join(", "),
      criteria: criteria as unknown as Prisma.InputJsonValue,
      providers: [provider.name],
      status: "PENDING",
      stage: "QUEUED",
      stats: emptyStats() as unknown as Prisma.InputJsonValue,
      resultLimit: limit,
      campaignId: request.campaignId ?? null,
    },
  });
  await recordEvent(ctx, { type: "discovery_started", campaignId: request.campaignId, properties: { runId: run.id, provider: provider.name, limit } });
  await getQueue().enqueue("discovery.run", { organizationId: ctx.organizationId, runId: run.id }, { jobId: `discovery:${run.id}` });
  await audit(ctx, { action: "discovery.started", resourceType: "discovery_run", resourceId: run.id, metadata: { query: request.query } });
  return run;
}

export async function getDiscoveryRun(ctx: TenantContext, runId: string) {
  assertCan(ctx, "leads:read");
  const run = await ctx.db.discoveryRun.findFirst({ where: { id: runId } });
  if (!run) throw new NotFoundError("Discovery run", runId);
  const links = await ctx.db.discoveryRunLead.findMany({
    where: { runId },
    orderBy: [{ lead: { score: { sort: "desc", nulls: "last" } } }, { rank: "asc" }],
    include: {
      lead: {
        select: {
          id: true, name: true, category: true, industry: true, locality: true, city: true, website: true, phone: true, email: true,
          rating: true, reviewCount: true, score: true, fitTier: true, qualification: true, status: true, enrichmentStatus: true,
          signals: true, sourceProvider: true, locationsCount: true, aiSummary: true,
          contacts: { where: { deletedAt: null }, select: { id: true, email: true, phone: true, name: true } },
        },
      },
    },
  });
  return { run, results: links.map((link) => ({ ...link.lead, isNew: link.isNew, rank: link.rank })) };
}

export async function listDiscoveryRuns(ctx: TenantContext, limit = 10) {
  assertCan(ctx, "leads:read");
  return ctx.db.discoveryRun.findMany({ orderBy: { createdAt: "desc" }, take: limit });
}

// ----------------------------------------------------------------------------- Pipeline

async function updateRun(ctx: TenantContext, runId: string, data: { stage?: Prisma.DiscoveryRunUpdateInput["stage"]; stats?: DiscoveryStats; status?: Prisma.DiscoveryRunUpdateInput["status"]; error?: string | null; completedAt?: Date; startedAt?: Date }) {
  await ctx.db.discoveryRun.update({
    where: { id: runId },
    data: { ...data, stats: data.stats ? (data.stats as unknown as Prisma.InputJsonValue) : undefined },
  });
}

async function upsertCandidate(ctx: TenantContext, runId: string, candidate: LeadCandidate, rank: number, providerName: string, stats: DiscoveryStats): Promise<string | null> {
  const existing = await ctx.db.lead.findFirst({ where: { dedupeKey: candidate.dedupeKey }, select: { id: true, deletedAt: true } });
  let leadId: string;
  let isNew = false;

  if (existing && !existing.deletedAt) {
    leadId = existing.id;
    stats.duplicates += 1;
  } else {
    if (stats.creditsExhausted) return null;
    try {
      await consumeUsage(ctx, "LEAD_CREDITS", 1, { sourceType: "discovery", sourceId: runId, idempotencyKey: `discovery:${runId}:${candidate.dedupeKey}` });
    } catch (error) {
      if (isLimitError(error)) {
        stats.creditsExhausted = true;
        return null;
      }
      throw error;
    }
    const data = {
      name: candidate.name,
      category: candidate.category,
      industry: candidate.industry,
      website: candidate.website,
      domain: candidate.domain,
      phone: candidate.phone,
      email: candidate.email,
      address: candidate.address,
      locality: candidate.locality,
      city: candidate.city,
      region: candidate.region,
      country: candidate.country,
      postalCode: candidate.postalCode,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      rating: candidate.rating,
      reviewCount: candidate.reviewCount,
      priceLevel: candidate.priceLevel,
      openingHours: candidate.openingHours ?? undefined,
      sourceType: "DISCOVERY" as const,
      sourceProvider: providerName,
      status: "NEW" as const,
      enrichmentStatus: "PENDING" as const,
    };
    if (existing?.deletedAt) {
      // Previously deleted lead rediscovered: restore rather than duplicate.
      await ctx.db.lead.update({ where: { id: existing.id }, data: { ...data, deletedAt: null } });
      leadId = existing.id;
    } else {
      const lead = await ctx.db.lead.create({ data: { ...data, organizationId: ctx.organizationId, dedupeKey: candidate.dedupeKey } });
      leadId = lead.id;
    }
    isNew = true;
    stats.new += 1;
    await recordEvent(ctx, { type: "lead_created", leadId, properties: { source: "discovery", provider: providerName, runId }, idempotencyKey: `lead_created:${leadId}` });
  }

  await ctx.db.leadSource.upsert({
    where: { leadId_provider_externalId: { leadId, provider: providerName, externalId: candidate.externalId } },
    create: {
      organizationId: ctx.organizationId,
      leadId,
      sourceType: "DISCOVERY",
      provider: providerName,
      externalId: candidate.externalId,
      url: candidate.sourceUrl,
      rawData: candidate.raw as Prisma.InputJsonValue,
      discoveryRunId: runId,
    },
    update: { rawData: candidate.raw as Prisma.InputJsonValue, fetchedAt: new Date(), discoveryRunId: runId },
  });
  await ctx.db.discoveryRunLead.upsert({
    where: { runId_leadId: { runId, leadId } },
    create: { runId, leadId, isNew, rank },
    update: {},
  });
  return leadId;
}

export async function executeDiscoveryRun(ctx: TenantContext, runId: string): Promise<DiscoveryStats> {
  const run = await ctx.db.discoveryRun.findFirst({ where: { id: runId } });
  if (!run) throw new NotFoundError("Discovery run", runId);
  if (run.status === "COMPLETED" || run.status === "CANCELED") return run.stats as unknown as DiscoveryStats;
  const criteria = searchCriteriaSchema.parse(run.criteria);
  const stats = emptyStats();

  try {
    await updateRun(ctx, runId, { status: "RUNNING", stage: "SEARCHING", startedAt: new Date(), stats });
    const provider = await resolveLeadProvider(ctx);
    const primaryLocation = criteria.locations[0];
    const raw = await provider.search({
      categories: criteria.categories,
      keywords: criteria.keywords,
      location: primaryLocation
        ? { label: primaryLocation.label, city: primaryLocation.city, lat: primaryLocation.lat, lng: primaryLocation.lng, localities: resolveLocation(primaryLocation.label).localities }
        : null,
      radiusKm: criteria.radiusKm,
      limit: run.resultLimit,
      requireWebsite: criteria.requireWebsite,
    });
    stats.found = raw.length;
    await updateRun(ctx, runId, { stage: "NORMALIZING", stats });

    const leadIds: string[] = [];
    for (const [index, business] of raw.entries()) {
      const candidate = normalizeRawBusiness(business);
      if (candidate.closed) {
        stats.skippedClosed += 1;
        continue;
      }
      const leadId = await upsertCandidate(ctx, runId, candidate, index, provider.name, stats);
      if (leadId) leadIds.push(leadId);
      if (index % 5 === 4) await updateRun(ctx, runId, { stats });
    }
    await updateRun(ctx, runId, { stage: "ENRICHING", stats });

    const toEnrich = await ctx.db.lead.findMany({ where: { id: { in: leadIds }, enrichmentStatus: { in: ["PENDING", "FAILED"] } }, select: { id: true } });
    await mapWithConcurrency(toEnrich, 4, async ({ id }) => {
      await enrichLead(ctx, id).catch((error: unknown) => logger.warn({ err: error, leadId: id }, "enrichment failed during discovery"));
      stats.enriched += 1;
      if (stats.enriched % 5 === 0) await updateRun(ctx, runId, { stats });
    });
    await updateRun(ctx, runId, { stage: "SCORING", stats });

    const target = {
      categories: criteria.categories,
      locations: criteria.locations.map((location) => ({ ...location, localities: resolveLocation(location.label).localities })),
      radiusKm: criteria.radiusKm,
    };
    await mapWithConcurrency(leadIds, 4, async (leadId) => {
      try {
        const result = await scoreLeadById(ctx, leadId, { campaignId: run.campaignId, preferredSignals: criteria.preferredSignals, criteria: criteria.criteria, offer: criteria.offer, target });
        stats.scored += 1;
        if (result.fitTier === "HIGH") stats.highFit += 1;
        if (result.qualification === "QUALIFIED") stats.qualified += 1;
      } catch (error) {
        logger.warn({ err: error, leadId }, "scoring failed during discovery");
      }
      if (stats.scored % 5 === 0) await updateRun(ctx, runId, { stats });
    });

    stats.contactable = await ctx.db.lead.count({
      where: { id: { in: leadIds }, OR: [{ email: { not: null } }, { phone: { not: null } }, { contacts: { some: { OR: [{ email: { not: null } }, { phone: { not: null } }] } } }] },
    });
    await updateRun(ctx, runId, { status: "COMPLETED", stage: "DONE", stats, completedAt: new Date() });
    await recordEvent(ctx, { type: "discovery_completed", campaignId: run.campaignId, properties: { runId, ...stats } });
    await notify(ctx, {
      type: "discovery.completed",
      userId: run.createdById,
      title: `Discovery finished: ${stats.new} new leads`,
      body: `${stats.found} businesses found, ${stats.highFit} high-fit, ${stats.contactable} contactable${stats.creditsExhausted ? " — lead credits ran out" : ""}.`,
      link: `/app/discover?run=${runId}`,
    });
    return stats;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateRun(ctx, runId, { status: "FAILED", error: message.slice(0, 500), stats, completedAt: new Date() });
    await recordEvent(ctx, { type: "discovery_failed", campaignId: run.campaignId, properties: { runId, error: message.slice(0, 200) } });
    throw error;
  }
}
