import { createHash } from "node:crypto";
import type { Prisma } from "@repo/db";
import type { TranscriptSegment } from "@repo/integrations";
import { getQueue } from "@repo/queue";
import { decideVoiceTurn, type CallBrief } from "../ai/agents/calls";
import type { TenantContext } from "../context";
import { registerCallSimulator } from "../outreach/simulator";
import { appendTranscript, applyCallStatus } from "./service";

/**
 * Demo-mode calls. Nobody is dialled: the simulator plays a realistic conversation
 * through the same turn policy real turn-based calls use, writing the transcript live,
 * then ends the call so analysis and CRM updates run exactly as for a real call.
 * Every simulated call is flagged `simulated` and labelled in the UI.
 */

type Scenario = "meeting" | "info" | "callback" | "not_interested" | "opt_out" | "wrong_person" | "no_answer" | "busy";

const SCENARIOS: Array<{ scenario: Scenario; weight: number }> = [
  { scenario: "meeting", weight: 15 },
  { scenario: "info", weight: 15 },
  { scenario: "callback", weight: 12 },
  { scenario: "not_interested", weight: 16 },
  { scenario: "opt_out", weight: 3 },
  { scenario: "wrong_person", weight: 6 },
  { scenario: "no_answer", weight: 28 },
  { scenario: "busy", weight: 5 },
];

/** What the prospect says after each agent line. */
const SCRIPTS: Record<Exclude<Scenario, "no_answer" | "busy">, string[]> = {
  meeting: [
    "Hi, yes, I have a minute. What's this about?",
    "Honestly we only post when we remember — nothing is really planned.",
    "Mostly more regulars on weekdays. That could help, actually. What does something like this cost?",
    "Okay, that's fair. Thursday afternoon works for me.",
  ],
  info: ["Sure, go ahead.", "We handle it ourselves right now, but it's a bit all over the place.", "Can you send me some details by email? I'll have a look.", "Okay, sounds good."],
  callback: ["Sorry, I'm in the middle of service right now — can you call me back later?", "Yes, later is much better, thanks."],
  not_interested: ["Who is this?", "No thanks, we're all set on that front."],
  opt_out: ["Please don't call this number again."],
  wrong_person: ["I just work the front desk — the owner isn't here. You've got the wrong person."],
};

function unit(seed: string): number {
  return createHash("sha256").update(seed).digest().readUInt32LE(0) / 0xffffffff;
}

export type { Scenario as SimulatedCallScenario };

export function pickScenario(seed: string): Scenario {
  const total = SCENARIOS.reduce((sum, item) => sum + item.weight, 0);
  let roll = unit(seed) * total;
  for (const item of SCENARIOS) {
    roll -= item.weight;
    if (roll <= 0) return item.scenario;
  }
  return "meeting";
}

/** ~2.6 words per second of speech. */
function speakingMs(text: string): number {
  return Math.max(1_200, Math.round((text.split(/\s+/).length / 2.6) * 1000));
}

/**
 * One simulated exchange: the agent's next line (same policy as real turn-based calls)
 * followed by the scripted prospect reply, with realistic timings.
 */
export function simulateTurn(input: { brief: CallBrief; sellerName: string; scenario: Scenario; index: number; segments: TranscriptSegment[]; optOutKeywords: string[] }) {
  const turn = decideVoiceTurn({
    brief: input.brief,
    sellerName: input.sellerName,
    transcript: input.segments.map((segment) => ({ speaker: segment.speaker, text: segment.text })),
    optOutKeywords: input.optOutKeywords,
    maxTurns: 6,
  });
  const clock = input.segments.at(-1)?.endMs ?? 0;
  const agentStart = clock + 600;
  const agentEnd = agentStart + speakingMs(turn.say);
  const added: TranscriptSegment[] = [{ speaker: "agent", text: turn.say, startMs: agentStart, endMs: agentEnd }];
  const reply = turn.end ? undefined : SCRIPTS[input.scenario as keyof typeof SCRIPTS]?.[input.index];
  if (reply) added.push({ speaker: "prospect", text: reply, startMs: agentEnd + 700, endMs: agentEnd + 700 + speakingMs(reply) });
  return { added, end: turn.end || !reply, say: turn.say };
}

/** A whole simulated conversation at once (used by the demo seed for past calls). */
export function buildSimulatedConversation(input: { brief: CallBrief; sellerName: string; scenario: Scenario; optOutKeywords: string[] }): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  for (let index = 0; index < 10; index += 1) {
    const { added, end } = simulateTurn({ ...input, index, segments });
    segments.push(...added);
    if (end) break;
  }
  return segments;
}

function step(ctx: TenantContext, callId: string, name: string, delayMs: number) {
  return getQueue().enqueue("demo.simulate", { organizationId: ctx.organizationId, kind: "call", refId: callId, step: name }, { jobId: `sim:${callId}:${name}`, delayMs });
}

async function simulate(ctx: TenantContext, callId: string, name: string): Promise<unknown> {
  const call = await ctx.db.call.findFirst({ where: { id: callId }, include: { lead: { select: { name: true } }, transcript: true } });
  if (!call || ["COMPLETED", "NO_ANSWER", "BUSY", "FAILED", "CANCELED"].includes(call.status)) return { skipped: "call ended" };
  const metadata = (call.metadata ?? {}) as { scenario?: Scenario; hangupRequested?: boolean };
  const scenario = metadata.scenario ?? pickScenario(`${call.lead.name}:${call.id.slice(0, 4)}`);

  if (name === "ringing") {
    await ctx.db.call.update({ where: { id: call.id }, data: { metadata: { ...(call.metadata as object), scenario } as Prisma.InputJsonValue } });
    await applyCallStatus(ctx, call.id, { status: "ringing" });
    if (scenario === "no_answer" || scenario === "busy") return step(ctx, call.id, scenario, scenario === "busy" ? 3_000 : 9_000);
    return step(ctx, call.id, "answered", 3_500 + unit(`${call.id}:ring`) * 2_500);
  }
  if (name === "no_answer" || name === "busy") {
    return applyCallStatus(ctx, call.id, { status: name, endedReason: name === "busy" ? "customer-busy" : "customer-did-not-answer" });
  }
  if (name === "answered") {
    await applyCallStatus(ctx, call.id, { status: "in_progress" });
    return step(ctx, call.id, "turn:0", 800);
  }

  const segments = (call.transcript?.segments ?? []) as unknown as TranscriptSegment[];
  const clock = segments.at(-1)?.endMs ?? 0;
  if (name === "end" || metadata.hangupRequested) {
    const endedAt = new Date((call.answeredAt ?? new Date()).getTime() + clock + 1_500);
    return applyCallStatus(ctx, call.id, { status: "completed", endedAt: endedAt.getTime() > Date.now() ? new Date() : endedAt, durationSeconds: Math.round((clock + 1_500) / 1000), endedReason: metadata.hangupRequested ? "ended-by-user" : "assistant-ended-call" });
  }

  if (name.startsWith("turn:")) {
    const index = Number(name.slice(5));
    const compliance = await ctx.db.complianceSettings.findFirst({ select: { optOutKeywords: true } });
    const seller = await ctx.db.businessProfile.findFirst({ select: { name: true } });
    const { added, end, say } = simulateTurn({
      brief: call.brief as unknown as CallBrief,
      sellerName: seller?.name ?? "our team",
      scenario,
      index,
      segments,
      optOutKeywords: compliance?.optOutKeywords ?? [],
    });
    await appendTranscript(ctx, call.id, added, "mock");
    if (end) return step(ctx, call.id, "end", speakingMs(say) * 0.6);
    return step(ctx, call.id, `turn:${index + 1}`, 2_600 + unit(`${call.id}:${index}`) * 1_400);
  }
  return { skipped: `unknown step ${name}` };
}

registerCallSimulator(simulate);
