import { createHash } from "node:crypto";
import { CHANNEL_UNIT_COST_USD } from "@repo/config";
import type { Prisma } from "@repo/db";
import { transcriptText } from "@repo/integrations";
import type { CallBrief } from "../ai/agents/calls";
import { consumeUsage } from "../billing/usage";
import { analyzeCall, prepareCall, saveTranscript } from "../calls/service";
import { buildSimulatedConversation, pickScenario } from "../calls/simulator";
import type { TenantContext } from "../context";
import { recordEvent } from "../events";

/**
 * Past AI calls for the demo workspace: calling setup completed (demo attestation),
 * simulated conversations built with the same turn policy as live calls, analysed by
 * the real analysis step, plus a few calls waiting in the queue.
 */

const DAY = 86_400_000;

function unit(seed: string): number {
  return createHash("sha256").update(seed).digest().readUInt32LE(0) / 0xffffffff;
}

export async function seedDemoCalls(ctx: TenantContext) {
  const now = Date.now();
  await ctx.db.complianceSettings.update({
    where: { organizationId: ctx.organizationId },
    data: {
      callingEnabled: true,
      callingConsentAttested: true,
      callingConsentAttestedAt: new Date(now - 20 * DAY),
      callingConsentAttestedById: ctx.userId,
      announceAiOnCalls: true,
      recordCalls: false,
    },
  });
  const [compliance, profile, subscription] = await Promise.all([
    ctx.db.complianceSettings.findFirstOrThrow({ select: { optOutKeywords: true } }),
    ctx.db.businessProfile.findFirstOrThrow({ select: { name: true } }),
    ctx.db.subscription.findUniqueOrThrow({ where: { organizationId: ctx.organizationId }, select: { currentPeriodStart: true } }),
  ]);

  // Contacted leads that never replied are the natural people to call.
  const candidates = await ctx.db.lead.findMany({
    where: { status: "CONTACTED", doNotContact: false, phone: { not: null } },
    orderBy: { score: { sort: "desc", nulls: "last" } },
    take: 14,
    select: { id: true, name: true },
  });

  let completed = 0;
  let unreached = 0;
  for (const [index, lead] of candidates.entries()) {
    const call = await prepareCall(ctx, { leadId: lead.id, type: "AI_AGENT" });
    const startedAt = new Date(now - (1 + Math.floor(unit(`${lead.name}:day`) * 12)) * DAY);
    startedAt.setUTCHours(5 + (index % 6), Math.floor(unit(`${lead.name}:min`) * 50), 0, 0);
    const scenario = pickScenario(`${lead.name}:seed`);
    const base = { leadId: lead.id, campaignId: null, callId: call.id, channel: "VOICE" as const };
    await ctx.db.event.updateMany({ where: { callId: call.id }, data: { occurredAt: new Date(startedAt.getTime() - 20 * 60_000) } });
    await recordEvent(ctx, { ...base, type: "call_started", occurredAt: startedAt, properties: { provider: "mock", simulated: true } });

    if (scenario === "no_answer" || scenario === "busy") {
      const endedAt = new Date(startedAt.getTime() + 28_000);
      await ctx.db.call.update({
        where: { id: call.id },
        data: { status: scenario === "busy" ? "BUSY" : "NO_ANSWER", provider: "mock", providerCallId: `mock_seed_${call.id}`, startedAt, endedAt, durationSeconds: 0, costCents: 0, createdAt: new Date(startedAt.getTime() - 20 * 60_000), metadata: { simulated: true, scenario } as Prisma.InputJsonValue },
      });
      await recordEvent(ctx, { ...base, type: "call_failed", occurredAt: endedAt, properties: { status: scenario, simulated: true } });
      unreached += 1;
      continue;
    }

    const segments = buildSimulatedConversation({ brief: call.brief as unknown as CallBrief, sellerName: profile.name, scenario, optOutKeywords: compliance.optOutKeywords });
    const answeredAt = new Date(startedAt.getTime() + 7_000);
    const durationSeconds = Math.round(((segments.at(-1)?.endMs ?? 0) + 1_500) / 1000);
    const endedAt = new Date(answeredAt.getTime() + durationSeconds * 1000);
    const minutes = Math.max(1, Math.ceil(durationSeconds / 60));
    await ctx.db.call.update({
      where: { id: call.id },
      data: {
        status: "COMPLETED",
        provider: "mock",
        providerCallId: `mock_seed_${call.id}`,
        startedAt,
        answeredAt,
        endedAt,
        durationSeconds,
        costCents: Math.round(minutes * CHANNEL_UNIT_COST_USD.VOICE_PER_MINUTE * 100),
        createdAt: new Date(startedAt.getTime() - 20 * 60_000),
        metadata: { simulated: true, scenario, endedReason: "assistant-ended-call" } as Prisma.InputJsonValue,
      },
    });
    await saveTranscript(ctx, call.id, { segments, fullText: transcriptText(segments), language: "en" }, "mock");
    await recordEvent(ctx, { ...base, type: "call_answered", occurredAt: answeredAt, properties: { simulated: true } });
    if (startedAt >= subscription.currentPeriodStart) {
      await consumeUsage(ctx, "VOICE_MINUTES", minutes, { sourceType: "call", sourceId: call.id, idempotencyKey: `call:${call.id}` });
    }
    const marker = new Date();
    await analyzeCall(ctx, call.id);
    // Side effects of the analysis (status changes, meetings, opt-outs) happened right after the call.
    await ctx.db.event.updateMany({ where: { leadId: lead.id, occurredAt: { gte: marker }, type: { in: ["lead_status_changed", "meeting_created", "opt_out"] } }, data: { occurredAt: new Date(endedAt.getTime() + 45_000) } });
    await ctx.db.task.updateMany({ where: { leadId: lead.id, createdAt: { gte: marker } }, data: { createdAt: new Date(endedAt.getTime() + 60_000) } });
    completed += 1;
  }

  // Waiting in the queue: fresh briefs for new leads, one manual.
  const fresh = await ctx.db.lead.findMany({ where: { status: { in: ["NEW", "QUALIFIED"] }, phone: { not: null }, doNotContact: false, campaignLeads: { none: {} } }, orderBy: { score: { sort: "desc", nulls: "last" } }, take: 3, select: { id: true } });
  for (const [index, lead] of fresh.entries()) {
    await prepareCall(ctx, { leadId: lead.id, type: index === 2 ? "MANUAL" : "AI_AGENT" });
  }
  return { completed, unreached, queued: fresh.length };
}
