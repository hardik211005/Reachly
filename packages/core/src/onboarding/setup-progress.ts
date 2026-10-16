import type { TenantContext } from "../context";
import { getProviderStatuses } from "../integrations/status";

/**
 * The "Getting started" checklist on the home screen: the handful of things that make Reachly
 * actually grow a business, in plain words, each with why it matters and where to do it. Every
 * step is read from real data, so it ticks itself off as the owner goes.
 */

export interface SetupStep {
  key: "profile" | "find" | "connect" | "offer" | "followups" | "page";
  title: string;
  why: string;
  href: string;
  cta: string;
  done: boolean;
}

export async function getSetupProgress(ctx: TenantContext) {
  const [profile, searches, launched, activeFollowUps, page, providers] = await Promise.all([
    ctx.db.businessProfile.findFirst({ select: { id: true } }),
    ctx.db.discoveryRun.count(),
    ctx.db.campaign.count({ where: { launchedAt: { not: null } } }),
    ctx.db.workflow.count({ where: { status: "ACTIVE", deletedAt: null } }),
    ctx.db.publicPage.findFirst({ select: { enabled: true, afterWinFollowUps: true } }),
    getProviderStatuses(ctx),
  ]);
  const canSend = providers.some((status) => (status.category === "EMAIL" || status.category === "WHATSAPP") && (status.mode === "connected" || status.mode === "platform"));

  const steps: SetupStep[] = [
    { key: "profile", title: "Tell us about your business", why: "So we know what you sell and who buys it.", href: "/app/settings/business", cta: "Edit details", done: Boolean(profile) },
    { key: "find", title: "Find your first customers", why: "We search for businesses near you that are likely to buy, and rank the best ones first.", href: "/app/discover", cta: "Find customers", done: searches > 0 },
    { key: "connect", title: "Connect your email or WhatsApp", why: "So your messages go out from your own business, not a test mode.", href: "/app/integrations", cta: "Connect", done: canSend },
    { key: "offer", title: "Send your first offer", why: "Reachly writes a personal message for each business. You check it, then it's sent.", href: "/app/campaigns/new", cta: "Create an offer", done: launched > 0 },
    { key: "followups", title: "Switch on auto follow-ups", why: "Reachly reminds you to reply, call back and check in — so no customer slips through.", href: "/app/workflows", cta: "Choose follow-ups", done: activeFollowUps > 0 },
    { key: "page", title: "Put your business page online", why: "A link you can share anywhere, with your prices and reviews. Customers can enquire directly.", href: "/app/grow", cta: "Set up page", done: Boolean(page?.enabled) },
  ];
  return { steps, done: steps.filter((step) => step.done).length, total: steps.length };
}
