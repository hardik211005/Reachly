import { CALL_OUTCOMES, type CallOutcome } from "@repo/config";
import { getCategory } from "@repo/config/taxonomy";
import { z } from "zod";
import { firstName } from "../../shared/text";
import { defineAgent } from "../agent";
import { observation, shortOffer, type OutreachLeadContext, type OutreachSellerContext } from "./outreach";

/**
 * Voice agents:
 *   call_brief    — prepares the call (objective, opening, pitch, questions, objections)
 *   voice_turn    — decides the agent's next line during a live call (turn-based providers)
 *   call_analysis — turns the transcript into an outcome, summary and next step
 * All three are grounded in real lead data and never invent prices, customers or claims.
 */

// ----------------------------------------------------------------------------- Brief

export const callBriefSchema = z.object({
  objective: z.string(),
  summary: z.string().describe("Who the prospect is and why we're calling, in two sentences."),
  opening: z.string().describe("First sentence of the call, including the AI disclosure when required."),
  pitch: z.string(),
  talkingPoints: z.array(z.string()),
  questions: z.array(z.string()).describe("Discovery / qualification questions to ask."),
  objections: z.array(z.object({ objection: z.string(), response: z.string() })),
  closing: z.string().describe("How to ask for the next step (usually a short meeting)."),
  voicemail: z.string(),
  guardrails: z.array(z.string()),
});
export type CallBrief = z.infer<typeof callBriefSchema>;

export interface CallBriefInput {
  lead: OutreachLeadContext;
  seller: OutreachSellerContext;
  campaignObjective: string | null;
  history: Array<{ direction: "OUTBOUND" | "INBOUND"; channel: string; body: string }>;
  announceAi: boolean;
}

const GUARDRAILS = [
  "Say you're an AI assistant if asked, and at the start when disclosure is required.",
  "Only quote prices listed in the pricing facts; otherwise offer a proper quote after a call.",
  "If they ask not to be called again, apologise, confirm, and end the call.",
  "Keep it under four minutes; aim for a short follow-up meeting, not a sale on this call.",
];

/** "a café", "a D2C brand", "an agency" — label from the taxonomy, readable mid-sentence. */
function describeCategory(category: string | null): string {
  const label = (category ? getCategory(category)?.label : null) ?? category?.replace(/_/g, " ") ?? "business";
  const phrase = /^[A-Z][a-z]/.test(label) ? `${label.charAt(0).toLowerCase()}${label.slice(1)}` : label;
  return `${/^[aeiou]/i.test(phrase) ? "an" : "a"} ${phrase}`;
}

export function composeCallBrief(input: CallBriefInput): CallBrief {
  const { lead, seller } = input;
  const first = firstName(lead.contactName) ?? null;
  const offer = shortOffer(seller.offer ?? seller.valueProposition ?? "our services");
  const obs = observation(lead);
  const replied = input.history.some((message) => message.direction === "INBOUND");
  const emailed = input.history.some((message) => message.direction === "OUTBOUND");
  const disclosure = input.announceAi ? `I'm an AI assistant calling on behalf of ${seller.senderName} at ${seller.businessName}` : `this is ${seller.senderName} from ${seller.businessName}`;
  return {
    objective: input.campaignObjective ?? `Qualify interest in ${offer} and book a 15-minute call with ${seller.senderName}.`,
    summary: `${lead.name} is ${describeCategory(lead.category)} in${[lead.locality, lead.city].filter(Boolean).join(", ") || "the area"}. ${obs.text}${emailed ? (replied ? " They've replied to our earlier message." : " We emailed them earlier without a reply.") : ""}`,
    opening: `Hi${first ? ` ${first}` : ""}, ${disclosure}. ${emailed ? "I sent a short note recently — do you have a minute?" : "Do you have a minute?"}`,
    pitch: `${seller.valueProposition ? `${seller.businessName} helps businesses like yours: ${seller.valueProposition.charAt(0).toLowerCase()}${seller.valueProposition.slice(1)}` : `We help businesses like ${lead.name} with ${offer}.`}${seller.pitchAngle ? ` ${seller.pitchAngle}` : ""}`,
    talkingPoints: [obs.text, `What ${offer} would look like for ${lead.name}.`, "A short call to see if it's a fit — no commitment."],
    questions: [`How are you handling ${offer} today?`, "What would you most like to improve in the next few months?", "Who else would be involved in a decision like this?"],
    objections: [
      { objection: "We already have someone for this.", response: "Makes sense — most people we speak to do. Would it help to compare notes? If there's nothing to improve, I'll say so." },
      {
        objection: "How much does it cost?",
        response: seller.pricingFacts.length ? `${seller.pricingFacts[0]}. The exact quote depends on what you need — that's what the short call is for.` : "It depends on scope, so I'd rather give you an accurate quote after a short call than guess now.",
      },
      { objection: "Send me an email.", response: "Happy to. What's the one thing you'd want it to cover so it's actually useful?" },
      { objection: "Not a good time.", response: "No problem at all — when would be better, later this week or next?" },
    ],
    closing: `Would you be open to a 15-minute call with ${seller.senderName} this week — Tuesday or Thursday afternoon?`,
    voicemail: `Hi${first ? ` ${first}` : ""}, ${disclosure}. I'll follow up by email with a short note about ${offer} for ${lead.name}. Have a great day.`,
    guardrails: GUARDRAILS,
  };
}

export const callBriefAgent = defineAgent<CallBriefInput, CallBrief>({
  name: "call_brief",
  version: "v2",
  description: "Prepares a phone call with one lead: objective, opening, pitch, questions, objection handling.",
  output: callBriefSchema,
  effort: "medium",
  maxTokens: 4000,
  cacheable: true,
  buildPrompt(input) {
    return {
      system: [
        "You prepare concise briefs for short B2B sales phone calls made by an AI voice agent on behalf of a seller.",
        "Ground everything in the lead facts and conversation history provided. Never invent prices (only seller.pricingFacts), customers, results or facts about the prospect.",
        input.announceAi ? "The opening must disclose that the caller is an AI assistant calling on behalf of the seller." : "The opening introduces the seller by name.",
        "Write for speech: short sentences, natural, respectful of the prospect's time.",
        `Always include these guardrails: ${GUARDRAILS.join(" ")}`,
      ].join("\n"),
      user: JSON.stringify(input),
    };
  },
  mock: composeCallBrief,
});

// ----------------------------------------------------------------------------- Live turn

export const voiceTurnSchema = z.object({
  say: z.string().describe("The agent's next spoken line (one to three short sentences)."),
  end: z.boolean().describe("True if the call should end after this line."),
  reason: z.enum(["continue", "meeting_booked", "callback", "not_interested", "opt_out", "wrong_person", "completed"]),
});
export type VoiceTurn = z.infer<typeof voiceTurnSchema>;

export interface VoiceTurnInput {
  brief: CallBrief;
  sellerName: string;
  transcript: Array<{ speaker: "agent" | "prospect"; text: string }>;
  optOutKeywords: string[];
  maxTurns: number;
}

const has = (text: string, pattern: RegExp) => pattern.test(text.toLowerCase());

/** Rule-based conversation policy, also the demo agent. */
export function decideVoiceTurn(input: VoiceTurnInput): VoiceTurn {
  const said = [...input.transcript].reverse().find((turn) => turn.speaker === "prospect")?.text ?? "";
  const agentTurns = input.transcript.filter((turn) => turn.speaker === "agent").length;
  const asked = (text: string) => input.transcript.some((turn) => turn.speaker === "agent" && turn.text === text);
  const optOut = input.optOutKeywords.some((keyword) => keyword && said.toLowerCase().includes(keyword.toLowerCase())) || has(said, /\b(don'?t call|do not call|stop calling|remove (me|my number))\b/);

  if (optOut) return { say: "Understood — I'm sorry for the interruption. I'll make sure you're not contacted again. Goodbye.", end: true, reason: "opt_out" };
  if (has(said, /\b(wrong (number|person)|not the (owner|right person)|doesn'?t work here)\b/)) {
    return { say: "Thanks for letting me know, and sorry to bother you. Have a good day.", end: true, reason: "wrong_person" };
  }
  if (has(said, /\b(not interested|no thanks|no thank you|we'?re (good|fine|all set))\b/)) {
    return { say: "Completely understand — thanks for your time, and all the best.", end: true, reason: "not_interested" };
  }
  const lastAgent = [...input.transcript].reverse().find((turn) => turn.speaker === "agent")?.text ?? "";
  if (said && /when would be (a )?better|better time to call/i.test(lastAgent)) {
    return { say: "Great — I'll call you back then. Thanks, and have a good day!", end: true, reason: "callback" };
  }
  if (has(said, /\b((mon|tues|wednes|thurs|fri)day|tomorrow|next week|\d{1,2} ?(am|pm)|afternoon|morning)\b/) && agentTurns > 1) {
    return { say: `Perfect — I'll send a calendar invite from ${input.sellerName} for then. Thanks so much, speak soon!`, end: true, reason: "meeting_booked" };
  }
  if (has(said, /\b(busy|call (me )?(back|later)|in a meeting|driving|bad time|not a good time)\b/)) {
    return { say: input.brief.objections.find((item) => item.objection.includes("Not a good time"))?.response ?? "No problem — when would be a better time to call back?", end: agentTurns >= 3, reason: agentTurns >= 3 ? "callback" : "continue" };
  }
  if (has(said, /\b(price|pricing|cost|how much|charges?|rates?)\b/)) {
    const answer = input.brief.objections.find((item) => /cost/i.test(item.objection))?.response ?? "It depends on scope — I'd rather give you an accurate quote.";
    return { say: `${answer} ${input.brief.closing}`, end: false, reason: "continue" };
  }
  if (has(said, /\b(email|send (me )?(some )?(details|info))\b/)) {
    return { say: input.brief.objections.find((item) => /email/i.test(item.objection))?.response ?? "Happy to send details by email.", end: false, reason: "continue" };
  }
  if (has(said, /\b(already (have|use|work with)|someone for (this|that))\b/)) {
    return { say: input.brief.objections.find((item) => /already/i.test(item.objection))?.response ?? "Makes sense. Would it help to compare notes?", end: false, reason: "continue" };
  }
  if (agentTurns >= input.maxTurns) return { say: `Thanks for your time today. ${input.sellerName} will follow up by email. Goodbye!`, end: true, reason: "completed" };
  if (agentTurns === 0) return { say: input.brief.opening, end: false, reason: "continue" };
  if (!asked(input.brief.pitch)) return { say: input.brief.pitch, end: false, reason: "continue" };
  const question = input.brief.questions.find((item) => !asked(item));
  if (question && agentTurns < 3) return { say: question, end: false, reason: "continue" };
  if (!asked(input.brief.closing)) return { say: input.brief.closing, end: false, reason: "continue" };
  return { say: `Thanks — ${input.sellerName} will follow up by email with a couple of ideas. Have a great day!`, end: true, reason: "completed" };
}

export const voiceTurnAgent = defineAgent<VoiceTurnInput, VoiceTurn>({
  name: "voice_turn",
  version: "v2",
  description: "Chooses the AI voice agent's next line during a live call.",
  output: voiceTurnSchema,
  effort: "low",
  maxTokens: 600,
  cacheable: false,
  buildPrompt(input) {
    return {
      system: [
        "You are a polite, concise AI sales caller following a brief. Reply with the next line to speak — one to three short, natural sentences.",
        "Follow the guardrails strictly. If the prospect asks not to be contacted, apologise and end the call. Never invent prices or facts.",
        "Aim to book a short meeting; end the call once a time is agreed, the prospect declines, or asks to be called back.",
        `Guardrails: ${input.brief.guardrails.join(" ")}`,
      ].join("\n"),
      user: JSON.stringify({ brief: input.brief, transcript: input.transcript, turnsSoFar: input.transcript.length, maxAgentTurns: input.maxTurns }),
    };
  },
  mock: decideVoiceTurn,
});

// ----------------------------------------------------------------------------- Analysis

export const callAnalysisSchema = z.object({
  outcome: z.enum(CALL_OUTCOMES),
  summary: z.string(),
  sentiment: z.enum(["POSITIVE", "NEUTRAL", "NEGATIVE"]),
  interestLevel: z.number().int().min(0).max(100),
  keyPoints: z.array(z.string()),
  objections: z.array(z.string()),
  nextAction: z.string(),
  followUpInDays: z.number().int().min(0).max(120).nullable(),
  meetingRequested: z.boolean(),
  optOut: z.boolean(),
});
export type CallAnalysis = z.infer<typeof callAnalysisSchema>;

export interface CallAnalysisInput {
  leadName: string;
  sellerName: string;
  transcript: Array<{ speaker: "agent" | "prospect"; text: string }>;
  durationSeconds: number;
  optOutKeywords: string[];
}

const OUTCOME_RULES: Array<{ outcome: CallOutcome; pattern: RegExp }> = [
  { outcome: "WRONG_CONTACT", pattern: /\b(wrong (number|person)|not the (owner|right person)|doesn'?t work here)\b/i },
  { outcome: "MEETING_REQUESTED", pattern: /\b((mon|tues|wednes|thurs|fri)day|tomorrow|next week|\d{1,2} ?(am|pm))\b/i },
  { outcome: "NOT_INTERESTED", pattern: /\b(not interested|no thanks|no thank you|we'?re (good|fine|all set))\b/i },
  { outcome: "CALL_BACK_LATER", pattern: /\b(busy|call (me )?(back|later)|in a meeting|bad time|not a good time)\b/i },
  { outcome: "NEEDS_INFORMATION", pattern: /\b(send (me )?(some )?(details|info)|email me|price|pricing|cost|how much)\b/i },
  { outcome: "INTERESTED", pattern: /\b(interested|sounds (good|great|interesting|useful)|tell me more|go ahead|sure|makes sense)\b/i },
];

export function analyzeCallDeterministically(input: CallAnalysisInput): CallAnalysis {
  const prospect = input.transcript.filter((turn) => turn.speaker === "prospect").map((turn) => turn.text);
  const text = prospect.join(" ");
  const optOut = input.optOutKeywords.some((keyword) => keyword && text.toLowerCase().includes(keyword.toLowerCase())) || /\b(don'?t call|do not call|stop calling|remove (me|my number))\b/i.test(text);
  let outcome: CallOutcome = "UNKNOWN";
  if (optOut) outcome = "DO_NOT_CONTACT";
  else if (!prospect.length || input.durationSeconds < 10) outcome = "UNKNOWN";
  else outcome = OUTCOME_RULES.find((rule) => rule.pattern.test(text))?.outcome ?? "UNKNOWN";
  const positive: CallOutcome[] = ["INTERESTED", "MEETING_REQUESTED", "NEEDS_INFORMATION"];
  const sentiment = positive.includes(outcome) ? "POSITIVE" : ["NOT_INTERESTED", "DO_NOT_CONTACT", "WRONG_CONTACT"].includes(outcome) ? "NEGATIVE" : "NEUTRAL";
  const interestLevel = { MEETING_REQUESTED: 85, INTERESTED: 70, NEEDS_INFORMATION: 55, CALL_BACK_LATER: 40, UNKNOWN: 25, NOT_INTERESTED: 10, WRONG_CONTACT: 0, DO_NOT_CONTACT: 0 }[outcome];
  const objections = prospect.filter((line) => /\b(already|cost|price|how much|busy|email|not sure|budget)\b/i.test(line)).slice(0, 3);
  const nextAction = {
    MEETING_REQUESTED: "Send the calendar invite and prepare for the meeting",
    INTERESTED: "Send a short follow-up email with examples and propose a meeting time",
    NEEDS_INFORMATION: "Email the requested details (only configured pricing) and follow up in 3 days",
    CALL_BACK_LATER: "Call back at the time they suggested",
    NOT_INTERESTED: "Close the lead politely; no further outreach this quarter",
    WRONG_CONTACT: "Find the right decision-maker before contacting again",
    DO_NOT_CONTACT: "Do not contact again — added to the suppression list",
    UNKNOWN: "Try again or follow up by email",
  }[outcome];
  const followUpInDays = { MEETING_REQUESTED: null, INTERESTED: 2, NEEDS_INFORMATION: 3, CALL_BACK_LATER: 7, NOT_INTERESTED: null, WRONG_CONTACT: null, DO_NOT_CONTACT: null, UNKNOWN: 3 }[outcome];
  const minutes = Math.max(1, Math.round(input.durationSeconds / 60));
  const summaryByOutcome: Record<CallOutcome, string> = {
    MEETING_REQUESTED: "agreed to a follow-up meeting",
    INTERESTED: "was interested and open to hearing more",
    NEEDS_INFORMATION: "asked for more information before deciding",
    CALL_BACK_LATER: "asked to be called back at a better time",
    NOT_INTERESTED: "wasn't interested",
    WRONG_CONTACT: "said they aren't the right contact",
    DO_NOT_CONTACT: "asked not to be contacted again",
    UNKNOWN: "didn't give a clear answer",
  };
  return {
    outcome,
    summary: `${minutes}-minute call. ${input.leadName} ${summaryByOutcome[outcome]}.${objections[0] ? ` They raised: “${objections[0]}”` : ""}`,
    sentiment,
    interestLevel,
    // Things they told us — not greetings, and not the concerns listed separately.
    keyPoints: prospect.filter((line) => line.split(" ").length > 5 && !objections.includes(line) && !/^(hi|hello|yes|sure|okay|ok|who)\b/i.test(line.trim())).slice(0, 4),
    objections,
    nextAction,
    followUpInDays,
    meetingRequested: outcome === "MEETING_REQUESTED",
    optOut,
  };
}

export const callAnalysisAgent = defineAgent<CallAnalysisInput, CallAnalysis>({
  name: "call_analysis",
  version: "v2",
  description: "Analyses a call transcript: outcome, sentiment, interest, objections and the next step.",
  output: callAnalysisSchema,
  effort: "medium",
  maxTokens: 2000,
  cacheable: true,
  buildPrompt(input) {
    return {
      system: [
        "You analyse transcripts of short B2B sales calls. Classify the outcome from what the prospect actually said — never infer interest that isn't there.",
        "optOut is true only if the prospect asked not to be contacted again. meetingRequested is true only if a meeting or call time was agreed.",
        "keyPoints are facts the prospect shared; objections are concerns they raised, in their words.",
      ].join("\n"),
      user: JSON.stringify(input),
    };
  },
  mock: analyzeCallDeterministically,
});
