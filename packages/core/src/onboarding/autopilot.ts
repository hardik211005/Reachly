import { getCategory } from "@repo/config/taxonomy";
import { getEnv } from "@repo/config/env";
import { prisma } from "@repo/db";
import { getQueue } from "@repo/queue";
import { audit } from "../audit";
import { hasFeature, resolvePlan } from "../billing/plans";
import { readIcp } from "../business/service";
import { campaignTargetSchema } from "../campaigns/schemas";
import { systemContext, type TenantContext } from "../context";
import { startDiscovery } from "../discovery/service";
import { isGapSeller } from "../leads/scoring";
import { resolveLocation } from "../leads/scoring-service";
import { logger } from "../logger";
import { notify } from "../notifications";
import { createWorkflow, setWorkflowStatus } from "../workflows/service";
import { getTemplate } from "../workflows/templates";

/**
 * Onboarding autopilot: the moment a business finishes registering, Reachly starts working for it
 * without any further clicks —
 *   1. the first lead search runs from its campaign (or ideal customer profile),
 *   2. the standard automations are switched on (plans with workflows),
 *   3. the operator's n8n hears "business registered" (when N8N_URL is set),
 *   4. the owner is told what's running.
 * Every step is independent and failure-tolerant: a step that can't run is skipped with a reason
 * and never blocks onboarding.
 */

/** Ready-made automations that need no configuration, switched on for every new workspace. */
export const AUTOPILOT_WORKFLOWS = ["positive-reply-follow-up", "high-fit-to-campaign", "callback-requested", "opt-out-alert"] as const;

/** n8n webhook path the operator's "business registered" workflow listens on. */
export const BUSINESS_REGISTERED_WEBHOOK_PATH = "reachly-business-registered";

type StepStatus = "done" | "skipped" | "failed";
export interface AutopilotResult {
  chains: { status: StepStatus; policy: string | null; detail: string };
  discovery: { status: StepStatus; runId: string | null; query: string | null; detail: string };
  workflows: { status: StepStatus; activated: string[]; drafts: string[]; detail: string };
  n8n: { status: StepStatus; detail: string };
}

const label = (key: string) => getCategory(key)?.label ?? key.replace(/_/g, " ");

async function firstSearch(ctx: TenantContext, campaignId: string | null): Promise<AutopilotResult["discovery"]> {
  const [profile, offering, campaign] = await Promise.all([
    ctx.db.businessProfile.findFirst(),
    ctx.db.offering.findFirst({ where: { deletedAt: null, isActive: true }, orderBy: { createdAt: "asc" } }),
    campaignId ? ctx.db.campaign.findFirst({ where: { id: campaignId, deletedAt: null } }) : Promise.resolve(null),
  ]);
  const icp = profile ? readIcp(profile.icp) : null;
  const target = campaign ? campaignTargetSchema.safeParse(campaign.target) : null;
  const fromCampaign = target?.success && target.data.categories.length ? target.data : null;

  const categories = (fromCampaign?.categories ?? icp?.targetCategories ?? []).slice(0, 3);
  const locationLabel = fromCampaign?.locations[0]?.label ?? icp?.recommendedLocations[0] ?? profile?.city ?? null;
  if (!categories.length) return { status: "skipped", runId: null, query: null, detail: "No target customers in the profile yet — add them in Settings → Business & services" };
  if (!locationLabel) return { status: "skipped", runId: null, query: null, detail: "No city in the profile yet — add one to start searching" };

  const query = `${categories.map(label).join(", ")} in ${locationLabel}`;
  const run = await startDiscovery(ctx, {
    query,
    campaignId: fromCampaign ? (campaignId ?? undefined) : undefined,
    criteria: {
      categories,
      keywords: fromCampaign?.keywords ?? icp?.leadKeywords.slice(0, 6) ?? [],
      locations: [resolveLocation(locationLabel)],
      radiusKm: fromCampaign?.radiusKm ?? 25,
      criteria: fromCampaign?.criteria ?? null,
      requireContact: true,
      preferredSignals: icp?.buyingSignals.map((signal) => signal.key).slice(0, 10) ?? [],
      offer: campaign?.offerSummary ?? offering?.name ?? icp?.valueProposition ?? null,
    },
    // startDiscovery caps this at the plan's per-search limit.
    limit: 250,
  });
  return { status: "done", runId: run.id, query, detail: `Searching for ${query}` };
}

/**
 * Sellers who fix weak online presence (agencies, web/marketing services) rarely win chain outlets,
 * which buy centrally. For them, chains start on "Avoid" — still visible, scored down — before the
 * first search runs. Anyone can change it in Settings → Lead scoring.
 */
async function smartChainDefault(ctx: TenantContext): Promise<AutopilotResult["chains"]> {
  const [profile, scoring] = await Promise.all([ctx.db.businessProfile.findFirst({ select: { icp: true } }), ctx.db.scoringProfile.findFirst({ select: { id: true, chainPolicy: true } })]);
  if (!scoring || scoring.chainPolicy !== "neutral") return { status: "skipped", policy: scoring?.chainPolicy ?? null, detail: "Chain setting already chosen" };
  const icp = profile ? readIcp(profile.icp) : null;
  if (!isGapSeller(icp?.buyingSignals.map((signal) => signal.key) ?? [])) return { status: "skipped", policy: "neutral", detail: "Chains treated like any business" };
  await ctx.db.scoringProfile.update({ where: { id: scoring.id }, data: { chainPolicy: "avoid" } });
  await audit(ctx, { action: "scoring.updated", resourceType: "scoring_profile", resourceId: scoring.id, metadata: { chainPolicy: "avoid", reason: "autopilot: sells to businesses with weak online presence" } });
  return { status: "done", policy: "avoid", detail: "Chains and franchises are scored down — you sell to businesses with weak online presence" };
}

async function standardAutomations(ctx: TenantContext): Promise<AutopilotResult["workflows"]> {
  if (!(await hasFeature(ctx, "workflows"))) return { status: "skipped", activated: [], drafts: [], detail: "Automations are available on Pro and above" };
  const existing = new Set((await ctx.db.workflow.findMany({ where: { deletedAt: null }, select: { name: true } })).map((workflow) => workflow.name));
  const activated: string[] = [];
  const drafts: string[] = [];
  for (const key of AUTOPILOT_WORKFLOWS) {
    const template = getTemplate(key);
    if (!template || existing.has(template.definition.name)) continue;
    const workflow = await createWorkflow(ctx, { template: key });
    try {
      await setWorkflowStatus(ctx, workflow.id, "ACTIVE");
      activated.push(workflow.name);
    } catch (error) {
      // e.g. a step needs a provider this workspace hasn't connected yet — leave it ready to switch on.
      drafts.push(workflow.name);
      logger.info({ err: error, workflow: workflow.name }, "autopilot left workflow as draft");
    }
  }
  return { status: "done", activated, drafts, detail: `${activated.length} automations switched on${drafts.length ? `, ${drafts.length} saved as drafts` : ""}` };
}

/** Runs once, right after a workspace finishes onboarding. */
export async function runOnboardingAutopilot(ctx: TenantContext, options: { campaignId?: string | null } = {}): Promise<AutopilotResult> {
  const result: AutopilotResult = {
    chains: { status: "skipped", policy: null, detail: "" },
    discovery: { status: "skipped", runId: null, query: null, detail: "" },
    workflows: { status: "skipped", activated: [], drafts: [], detail: "" },
    n8n: { status: "skipped", detail: "" },
  };

  try {
    // Before the search, so its results are scored with the right chain setting.
    result.chains = await smartChainDefault(ctx);
  } catch (error) {
    result.chains = { status: "failed", policy: null, detail: error instanceof Error ? error.message : String(error) };
  }
  try {
    result.discovery = await firstSearch(ctx, options.campaignId ?? null);
  } catch (error) {
    result.discovery = { status: "failed", runId: null, query: null, detail: error instanceof Error ? error.message : String(error) };
    logger.warn({ err: error, organizationId: ctx.organizationId }, "autopilot: first search failed");
  }
  try {
    result.workflows = await standardAutomations(ctx);
  } catch (error) {
    result.workflows = { status: "failed", activated: [], drafts: [], detail: error instanceof Error ? error.message : String(error) };
    logger.warn({ err: error, organizationId: ctx.organizationId }, "autopilot: automations failed");
  }
  if (getEnv().N8N_URL) {
    try {
      await getQueue().enqueue("platform.business-registered", { organizationId: ctx.organizationId, discoveryRunId: result.discovery.runId ?? undefined }, { jobId: `business-registered:${ctx.organizationId}` });
      result.n8n = { status: "done", detail: "Sent to n8n" };
    } catch (error) {
      result.n8n = { status: "failed", detail: error instanceof Error ? error.message : String(error) };
    }
  } else {
    result.n8n = { status: "skipped", detail: "n8n isn't connected (N8N_URL is empty)" };
  }

  const lines = [result.discovery.status === "done" ? `Finding leads: ${result.discovery.query}.` : null, result.workflows.activated.length ? `${result.workflows.activated.length} automations are on: ${result.workflows.activated.join(", ")}.` : null, result.chains.status === "done" ? "Chains and franchises are scored down (change in Settings → Lead scoring)." : null].filter(Boolean);
  if (lines.length) {
    await notify(ctx, {
      type: "onboarding.autopilot",
      userId: ctx.userId,
      title: "Reachly is already working for you",
      body: lines.join(" "),
      link: result.discovery.runId ? `/app/discover?run=${result.discovery.runId}` : "/app/workflows",
    });
  }
  await audit(ctx, { action: "onboarding.autopilot", resourceType: "organization", resourceId: ctx.organizationId, metadata: result as unknown as Record<string, unknown> });
  return result;
}

/** What the operator's n8n receives when a business registers. Keeps to what onboarding collected. */
export async function businessRegisteredPayload(organizationId: string, discoveryRunId: string | null) {
  const env = getEnv();
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { id: true, name: true, slug: true, createdAt: true, currency: true, timezone: true, memberships: { where: { role: "OWNER" }, take: 1, select: { user: { select: { name: true, email: true } } } } },
  });
  const [profile, offerings, workflows] = await Promise.all([
    prisma.businessProfile.findFirst({ where: { organizationId }, select: { name: true, industry: true, description: true, website: true, city: true, region: true, country: true, businessSize: true } }),
    prisma.offering.findMany({ where: { organizationId, deletedAt: null }, select: { name: true, type: true, unitPrice: true, currency: true }, take: 20 }),
    prisma.workflow.findMany({ where: { organizationId, deletedAt: null, status: "ACTIVE" }, select: { name: true } }),
  ]);
  const plan = await resolvePlan(systemContext(organizationId)).catch(() => null);
  const base = env.APP_URL.replace(/\/+$/, "");
  return {
    event: "business.registered",
    occurredAt: new Date().toISOString(),
    workspace: { id: organization.id, name: organization.name, slug: organization.slug, createdAt: organization.createdAt.toISOString(), plan: plan?.name ?? null, currency: organization.currency, timezone: organization.timezone },
    owner: organization.memberships[0]?.user ?? null,
    business: profile ? { ...profile, offerings: offerings.map((offering) => ({ ...offering, unitPrice: offering.unitPrice === null ? null : Number(offering.unitPrice) })) } : null,
    autopilot: { discoveryRunId, activeWorkflows: workflows.map((workflow) => workflow.name) },
    links: { admin: `${base}/admin`, discovery: discoveryRunId ? `${base}/app/discover?run=${discoveryRunId}` : null },
  };
}
