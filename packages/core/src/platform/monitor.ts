import { getEnv } from "@repo/config/env";
import { prisma } from "@repo/db";
import { NotFoundError } from "../errors";
import { learnedModelSchema } from "../leads/learned-model";
import { readChainOverrides } from "../leads/chains";

/**
 * Platform monitoring for whoever runs this deployment: what's happening across every workspace —
 * growth over time, a live activity feed, problems in the last 24 hours and a per-workspace view.
 * Cross-tenant by design (base client); callers must check platform-admin access first.
 */

const DAY = 86_400_000;

/** Daily signups, new workspaces, leads found and searches run (UTC days). */
export async function getPlatformActivity(days = 30, now: Date = new Date()) {
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (days - 1) * DAY);
  const rows = await prisma.$queryRaw<Array<{ day: Date; signups: bigint; workspaces: bigint; leads: bigint; searches: bigint; sent: bigint }>>`
    WITH days AS (SELECT generate_series(${since}::timestamp, ${since}::timestamp + (${days - 1} * interval '1 day'), interval '1 day') AS day)
    SELECT d.day,
      (SELECT count(*) FROM users u WHERE u."createdAt" >= d.day AND u."createdAt" < d.day + interval '1 day') AS signups,
      (SELECT count(*) FROM organizations o WHERE o."createdAt" >= d.day AND o."createdAt" < d.day + interval '1 day') AS workspaces,
      (SELECT count(*) FROM leads l WHERE l."createdAt" >= d.day AND l."createdAt" < d.day + interval '1 day') AS leads,
      (SELECT count(*) FROM discovery_runs r WHERE r."createdAt" >= d.day AND r."createdAt" < d.day + interval '1 day') AS searches,
      (SELECT count(*) FROM messages m WHERE m."createdAt" >= d.day AND m."createdAt" < d.day + interval '1 day' AND m.status IN ('SENT', 'DELIVERED', 'READ')) AS sent
    FROM days d ORDER BY d.day`;
  return rows.map((row) => ({
    date: row.day.toISOString().slice(0, 10),
    signups: Number(row.signups),
    workspaces: Number(row.workspaces),
    leads: Number(row.leads),
    searches: Number(row.searches),
    sent: Number(row.sent),
  }));
}

export type FeedKind = "signup" | "onboarded" | "search" | "campaign" | "deal" | "deleted" | "problem";
export interface FeedItem {
  at: string;
  kind: FeedKind;
  title: string;
  detail: string | null;
  workspaceId: string | null;
  workspace: string | null;
}

/** The latest things that happened anywhere on the platform, newest first. */
export async function getPlatformFeed(limit = 40): Promise<FeedItem[]> {
  const take = limit;
  const [users, onboarded, runs, campaigns, deals, deleted] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: "desc" }, take, select: { name: true, email: true, createdAt: true } }),
    prisma.auditLog.findMany({ where: { action: "onboarding.autopilot" }, orderBy: { createdAt: "desc" }, take, select: { createdAt: true, organizationId: true, metadata: true, organization: { select: { name: true } } } }),
    prisma.discoveryRun.findMany({ where: { status: { in: ["COMPLETED", "FAILED"] } }, orderBy: { createdAt: "desc" }, take, select: { createdAt: true, completedAt: true, status: true, query: true, stats: true, error: true, organizationId: true, organization: { select: { name: true } } } }),
    prisma.campaign.findMany({ where: { launchedAt: { not: null } }, orderBy: { launchedAt: "desc" }, take, select: { launchedAt: true, name: true, organizationId: true, organization: { select: { name: true } } } }),
    prisma.deal.findMany({ where: { wonAt: { not: null } }, orderBy: { wonAt: "desc" }, take, select: { wonAt: true, title: true, value: true, currency: true, organizationId: true, organization: { select: { name: true } } } }),
    prisma.auditLog.findMany({ where: { action: "workspace.deleted" }, orderBy: { createdAt: "desc" }, take, select: { createdAt: true, organizationId: true, metadata: true } }),
  ]);

  const items: FeedItem[] = [
    ...users.map((user) => ({ at: user.createdAt.toISOString(), kind: "signup" as const, title: `${user.name || "Someone"} signed up`, detail: user.email, workspaceId: null, workspace: null })),
    ...onboarded.map((entry) => {
      const meta = entry.metadata as { discovery?: { query?: string | null }; workflows?: { activated?: string[] } } | null;
      const parts = [meta?.discovery?.query ? `first search: ${meta.discovery.query}` : null, meta?.workflows?.activated?.length ? `${meta.workflows.activated.length} automations on` : null].filter(Boolean);
      return { at: entry.createdAt.toISOString(), kind: "onboarded" as const, title: `${entry.organization.name} finished registering`, detail: parts.join(" · ") || null, workspaceId: entry.organizationId, workspace: entry.organization.name };
    }),
    ...runs.map((run) => {
      const stats = (run.stats ?? {}) as { new?: number; found?: number; skippedChains?: number };
      const failed = run.status === "FAILED";
      return {
        at: (run.completedAt ?? run.createdAt).toISOString(),
        kind: failed ? ("problem" as const) : ("search" as const),
        title: failed ? `Search failed for ${run.organization.name}` : `${run.organization.name} found ${stats.new ?? 0} new leads`,
        detail: failed ? (run.error ?? run.query) : `${run.query}${stats.skippedChains ? ` · ${stats.skippedChains} chains skipped` : ""}`,
        workspaceId: run.organizationId,
        workspace: run.organization.name,
      };
    }),
    ...campaigns.map((campaign) => ({ at: campaign.launchedAt!.toISOString(), kind: "campaign" as const, title: `${campaign.organization.name} launched a campaign`, detail: campaign.name, workspaceId: campaign.organizationId, workspace: campaign.organization.name })),
    ...deals.map((deal) => ({ at: deal.wonAt!.toISOString(), kind: "deal" as const, title: `${deal.organization.name} won a deal`, detail: `${deal.title} · ${deal.currency} ${Number(deal.value).toLocaleString("en-IN")}`, workspaceId: deal.organizationId, workspace: deal.organization.name })),
    ...deleted.map((entry) => ({ at: entry.createdAt.toISOString(), kind: "deleted" as const, title: `Workspace deleted: ${(entry.metadata as { name?: string } | null)?.name ?? "unknown"}`, detail: "Recoverable for 30 days", workspaceId: entry.organizationId, workspace: (entry.metadata as { name?: string } | null)?.name ?? null })),
  ];
  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

/** Problems in the last 24 hours across all workspaces, plus which providers are really connected. */
export async function getPlatformHealth(now: Date = new Date()) {
  const since = new Date(now.getTime() - DAY);
  const [failedSearches, failedMessages, failedWorkflows, failedWebhooks] = await Promise.all([
    prisma.discoveryRun.count({ where: { status: "FAILED", createdAt: { gte: since } } }),
    prisma.message.count({ where: { status: "FAILED", createdAt: { gte: since } } }),
    prisma.workflowExecution.count({ where: { status: "FAILED", createdAt: { gte: since } } }),
    prisma.webhookDelivery.count({ where: { status: "FAILED", createdAt: { gte: since } } }),
  ]);
  const env = getEnv();
  // Only whether each platform-level provider is set — never the keys themselves.
  const providers = [
    { label: "AI", value: env.AI_DEFAULT_PROVIDER === "mock" ? "Built-in rules (no AI key)" : env.AI_DEFAULT_PROVIDER, live: env.AI_DEFAULT_PROVIDER !== "mock" },
    { label: "Lead data", value: env.LEAD_PROVIDER === "google_places" && env.GOOGLE_PLACES_API_KEY ? "Google Places" : env.LEAD_PROVIDER === "mock" ? "Demo data" : "OpenStreetMap (free)", live: env.LEAD_PROVIDER !== "mock" },
    { label: "Email", value: env.EMAIL_PROVIDER === "mock" ? "Not connected" : env.EMAIL_PROVIDER, live: env.EMAIL_PROVIDER !== "mock" },
    { label: "WhatsApp", value: env.WHATSAPP_PROVIDER === "mock" ? "Not connected" : "Meta Cloud API", live: env.WHATSAPP_PROVIDER !== "mock" },
    { label: "Calling", value: env.VOICE_PROVIDER === "mock" ? "Not connected" : env.VOICE_PROVIDER, live: env.VOICE_PROVIDER !== "mock" },
    { label: "Payments", value: [env.STRIPE_SECRET_KEY ? "Stripe" : null, env.RAZORPAY_KEY_ID ? "Razorpay (UPI)" : null].filter(Boolean).join(" + ") || "Not connected", live: Boolean(env.STRIPE_SECRET_KEY || env.RAZORPAY_KEY_ID) },
    { label: "n8n", value: env.N8N_URL ? "Connected" : "Not connected", live: Boolean(env.N8N_URL) },
  ];
  return {
    failures: [
      { label: "Lead searches", count: failedSearches },
      { label: "Messages", count: failedMessages },
      { label: "Workflow runs", count: failedWorkflows },
      { label: "Webhook deliveries", count: failedWebhooks },
    ],
    totalFailures: failedSearches + failedMessages + failedWorkflows + failedWebhooks,
    providers,
    demoMode: env.DEMO_MODE,
  };
}

/** Everything about one workspace, for the platform admin's drill-down. */
export async function getWorkspaceDetail(organizationId: string) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true, name: true, slug: true, createdAt: true, deletedAt: true, onboardingCompleted: true, currency: true, timezone: true,
      subscription: { select: { status: true, billingProvider: true, cancelAtPeriodEnd: true, currentPeriodEnd: true, plan: { select: { name: true } } } },
      memberships: { orderBy: { createdAt: "asc" }, select: { role: true, createdAt: true, user: { select: { name: true, email: true, emailVerified: true } } } },
      businessProfile: { select: { name: true, industry: true, description: true, website: true, city: true, businessSize: true } },
      scoringProfile: { select: { chainPolicy: true, chainOverrides: true, learnedModel: true } },
    },
  });
  if (!organization) throw new NotFoundError("Workspace", organizationId);
  const where = { organizationId };
  const [leads, qualified, chains, campaigns, activeCampaigns, sent, calls, deals, wonDeals, workflows, searches, recentRuns, recentAudit, lastEvent] = await Promise.all([
    prisma.lead.count({ where: { ...where, deletedAt: null } }),
    prisma.lead.count({ where: { ...where, deletedAt: null, qualification: "QUALIFIED" } }),
    prisma.lead.count({ where: { ...where, deletedAt: null, signals: { array_contains: [{ key: "chain_or_franchise" }] } } }),
    prisma.campaign.count({ where: { ...where, deletedAt: null } }),
    prisma.campaign.count({ where: { ...where, deletedAt: null, status: "ACTIVE" } }),
    prisma.message.count({ where: { ...where, status: { in: ["SENT", "DELIVERED", "READ"] } } }),
    prisma.call.count({ where }),
    prisma.deal.count({ where: { ...where, deletedAt: null } }),
    prisma.deal.aggregate({ where: { ...where, wonAt: { not: null } }, _count: { _all: true }, _sum: { value: true } }),
    prisma.workflow.count({ where: { ...where, deletedAt: null, status: "ACTIVE" } }),
    prisma.discoveryRun.count({ where }),
    prisma.discoveryRun.findMany({ where, orderBy: { createdAt: "desc" }, take: 8, select: { id: true, query: true, status: true, stats: true, createdAt: true, error: true } }),
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: 15, select: { action: true, createdAt: true, actorType: true } }),
    prisma.event.findFirst({ where, orderBy: { occurredAt: "desc" }, select: { occurredAt: true } }),
  ]);
  const model = learnedModelSchema.safeParse(organization.scoringProfile?.learnedModel);
  return {
    ...organization,
    scoring: {
      chainPolicy: organization.scoringProfile?.chainPolicy ?? "neutral",
      markedChains: readChainOverrides(organization.scoringProfile?.chainOverrides).chains.length,
      model: model.success ? { auc: model.data.metrics.auc, samples: model.data.metrics.samples, trainedAt: model.data.trainedAt } : null,
    },
    counts: { leads, qualified, chains, campaigns, activeCampaigns, sent, calls, deals, wonDeals: wonDeals._count._all, wonValue: Number(wonDeals._sum.value ?? 0), workflows, searches },
    lastActivityAt: lastEvent?.occurredAt ?? null,
    recentRuns: recentRuns.map((run) => ({ ...run, stats: run.stats as { found?: number; new?: number; qualified?: number; skippedChains?: number } })),
    recentAudit,
  };
}
