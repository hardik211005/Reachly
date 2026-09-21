import { z } from "zod";
import { composeOutreachMessage, outreachMessageAgent } from "../ai/agents/outreach";
import { runAgent } from "../ai/service";
import { assertCan, type TenantContext } from "../context";
import { NotFoundError } from "../errors";
import { leadContext, sellerContext } from "./context";

export const previewInputSchema = z.object({
  leadId: z.uuid(),
  channel: z.enum(["EMAIL", "WHATSAPP"]),
  stepName: z.string().trim().max(80).default("Opener"),
  stepOrder: z.number().int().min(0).max(20).default(0),
  subject: z.string().trim().max(200).nullable().default(null),
  body: z.string().trim().min(1).max(5000),
  useAI: z.boolean().default(false),
  tone: z.string().trim().max(60).default("professional"),
  offerSummary: z.string().trim().max(1000).nullable().default(null),
  pitchAngle: z.string().trim().max(1000).nullable().default(null),
  offeringIds: z.array(z.uuid()).max(20).default([]),
});

/** Renders a sequence step for one real lead so users see exactly what would be sent. */
export async function previewStepMessage(ctx: TenantContext, input: z.input<typeof previewInputSchema>) {
  assertCan(ctx, "campaigns:read");
  const data = previewInputSchema.parse(input);
  const lead = await ctx.db.lead.findFirst({ where: { id: data.leadId, deletedAt: null }, include: { contacts: { where: { deletedAt: null } } } });
  if (!lead) throw new NotFoundError("Lead", data.leadId);
  const seller = await sellerContext(ctx, { offer: data.offerSummary, pitchAngle: data.pitchAngle, offeringIds: data.offeringIds });
  const agentInput = {
    channel: data.channel,
    stepName: data.stepName,
    stepOrder: data.stepOrder,
    template: { subject: data.subject, body: data.body },
    tone: data.tone,
    lead: leadContext(lead),
    seller,
    previousMessages: [],
  };
  if (data.useAI) {
    assertCan(ctx, "ai:use");
    const { output, meta } = await runAgent(ctx, outreachMessageAgent, agentInput, { leadId: lead.id });
    return { ...output, ai: true, simulated: meta.provider === "mock", credits: meta.credits, lead: { id: lead.id, name: lead.name } };
  }
  return { ...composeOutreachMessage(agentInput), ai: false, simulated: false, credits: 0, lead: { id: lead.id, name: lead.name } };
}
