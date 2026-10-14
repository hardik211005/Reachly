import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@repo/config/env";
import { prisma } from "@repo/db";
import { analyzeBusiness } from "../../src/business/service";
import { createTenantContext } from "../../src/context";
import { executeDiscoveryRun } from "../../src/discovery/service";
import { processJob } from "../../src/jobs";
import { AUTOPILOT_WORKFLOWS, BUSINESS_REGISTERED_WEBHOOK_PATH } from "../../src/onboarding/autopilot";
import { finishOnboarding, saveOnboardingBusiness } from "../../src/onboarding/service";
import { createUser, resetDatabase, setPlan } from "./helpers";

const businessInput = {
  profile: {
    name: "Visibl Studio",
    industry: "Marketing agency",
    description: "We run social media marketing and build websites for cafes and restaurants in Delhi.",
    city: "New Delhi",
    businessSize: "SMALL" as const,
    targetCustomerTypes: ["Cafes", "Restaurants"],
  },
  offerings: [{ type: "SERVICE" as const, name: "Social media management", unitPrice: 15000 }],
};

async function registeredBusiness(plan: "free" | "pro", options: { analyse?: boolean; city?: string | null } = {}) {
  const user = await createUser("Owner");
  const { organizationId } = await saveOnboardingBusiness(user.id, { ...businessInput, profile: { ...businessInput.profile, city: options.city === undefined ? businessInput.profile.city : options.city } });
  await setPlan(organizationId, plan);
  const ctx = createTenantContext({ organizationId, userId: user.id, role: "OWNER" });
  if (options.analyse !== false) await analyzeBusiness(ctx);
  return { ctx, organizationId, userId: user.id };
}

async function setBuyingSignals(organizationId: string, keys: string[]) {
  const profile = await prisma.businessProfile.findFirstOrThrow({ where: { organizationId } });
  const icp = (profile.icp ?? {}) as Record<string, unknown>;
  await prisma.businessProfile.update({ where: { id: profile.id }, data: { icp: { ...icp, buyingSignals: keys.map((key) => ({ key, label: key, description: key })) } } });
}

describe("onboarding autopilot", () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.N8N_URL = "";
    resetEnvCache();
  });

  it("starts the first lead search and switches on the standard automations as soon as onboarding finishes", async () => {
    const { ctx, organizationId, userId } = await registeredBusiness("pro");
    const result = await finishOnboarding(ctx, { campaign: null });

    expect(result.discoveryRunId).not.toBeNull();
    const run = await prisma.discoveryRun.findUniqueOrThrow({ where: { id: result.discoveryRunId! } });
    const criteria = run.criteria as { categories: string[]; locations: Array<{ label: string }>; requireContact: boolean };
    expect(criteria.categories.length).toBeGreaterThan(0);
    expect(criteria.locations[0]?.label).toBe("New Delhi");
    expect(criteria.requireContact).toBe(true);
    expect(run.createdById).toBe(userId);

    // The search runs for real (mock lead data in tests) and fills the workspace with leads.
    const stats = await executeDiscoveryRun(ctx, run.id);
    expect(stats.new).toBeGreaterThan(0);

    const workflows = await prisma.workflow.findMany({ where: { organizationId, deletedAt: null } });
    expect(workflows).toHaveLength(AUTOPILOT_WORKFLOWS.length);
    expect(result.autopilot?.workflows.activated.length).toBeGreaterThanOrEqual(3);
    expect(workflows.filter((workflow) => workflow.status === "ACTIVE").map((workflow) => workflow.name).sort()).toEqual([...(result.autopilot?.workflows.activated ?? [])].sort());

    const notification = await prisma.notification.findFirst({ where: { organizationId, type: "onboarding.autopilot" } });
    expect(notification?.title).toBe("Reachly is already working for you");
    expect(notification?.link).toBe(`/app/discover?run=${run.id}`);
    expect(result.autopilot?.n8n.status).toBe("skipped");
    expect(await prisma.auditLog.count({ where: { organizationId, action: "onboarding.autopilot" } })).toBe(1);
  });

  it("scores chains down by default for businesses that sell to weak online presence", async () => {
    const gap = await registeredBusiness("pro");
    await setBuyingSignals(gap.organizationId, ["no_social_presence", "few_reviews"]);
    const gapResult = await finishOnboarding(gap.ctx, { campaign: null });
    expect(gapResult.autopilot?.chains.policy).toBe("avoid");
    expect((await prisma.scoringProfile.findUniqueOrThrow({ where: { organizationId: gap.organizationId } })).chainPolicy).toBe("avoid");

    // A supplier that wants established, multi-outlet buyers keeps chains neutral.
    const supplier = await registeredBusiness("pro");
    await setBuyingSignals(supplier.organizationId, ["multiple_locations", "high_review_volume"]);
    const supplierResult = await finishOnboarding(supplier.ctx, { campaign: null });
    expect(supplierResult.autopilot?.chains.status).toBe("skipped");
    expect((await prisma.scoringProfile.findUniqueOrThrow({ where: { organizationId: supplier.organizationId } })).chainPolicy).toBe("neutral");
  });

  it("still searches on the Free plan and explains why automations were skipped", async () => {
    const { ctx, organizationId } = await registeredBusiness("free");
    const result = await finishOnboarding(ctx, { campaign: null });
    expect(result.autopilot?.discovery.status).toBe("done");
    expect(result.autopilot?.workflows.status).toBe("skipped");
    expect(result.autopilot?.workflows.detail).toMatch(/Pro/);
    expect(await prisma.workflow.count({ where: { organizationId } })).toBe(0);
  });

  it("runs only once per workspace", async () => {
    const { ctx, organizationId } = await registeredBusiness("pro");
    await finishOnboarding(ctx, { campaign: null });
    const again = await finishOnboarding(ctx, { campaign: null });
    expect(again.autopilot).toBeNull();
    expect(await prisma.discoveryRun.count({ where: { organizationId } })).toBe(1);
    expect(await prisma.workflow.count({ where: { organizationId } })).toBe(AUTOPILOT_WORKFLOWS.length);
  });

  it("never blocks onboarding when there's nothing to search for yet", async () => {
    const { ctx, organizationId } = await registeredBusiness("pro", { analyse: false, city: null });
    const result = await finishOnboarding(ctx, { campaign: null });
    expect(result.autopilot?.discovery.status).toBe("skipped");
    expect(result.discoveryRunId).toBeNull();
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } })).onboardingCompleted).toBe(true);
  });

  it("tells the operator's n8n, signed, when N8N_URL is set", async () => {
    process.env.N8N_URL = "https://n8n.example.test";
    process.env.N8N_WEBHOOK_SECRET = "test-n8n-secret-value";
    resetEnvCache();
    const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    vi.stubGlobal("fetch", async (url: string, init: { headers: Record<string, string>; body: string }) => {
      calls.push({ url: String(url), headers: init.headers, body: init.body });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const { ctx, organizationId } = await registeredBusiness("pro");
    const result = await finishOnboarding(ctx, { campaign: null });
    expect(result.autopilot?.n8n.status).toBe("done");

    // Process the queued hand-off directly (the inline driver would do the same in the background).
    await processJob("platform.business-registered", { organizationId, discoveryRunId: result.discoveryRunId ?? undefined }, { jobId: "test", attempt: 1, maxAttempts: 1 });
    const call = calls.find((item) => item.url.endsWith(`/webhook/${BUSINESS_REGISTERED_WEBHOOK_PATH}`));
    expect(call).toBeDefined();
    expect(call?.headers["x-reachai-signature"]).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    const payload = JSON.parse(call!.body) as { event: string; workspace: { name: string }; owner: { email: string }; business: { offerings: Array<{ name: string }> }; autopilot: { activeWorkflows: string[] } };
    expect(payload.event).toBe("business.registered");
    expect(payload.workspace.name).toBe("Visibl Studio");
    expect(payload.owner.email).toMatch(/@example\.test$/);
    expect(payload.business.offerings[0]?.name).toBe("Social media management");
    expect(payload.autopilot.activeWorkflows.length).toBeGreaterThan(0);
  });
});
