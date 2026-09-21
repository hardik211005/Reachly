import { REPLY_INTENTS, type ReplyIntent } from "@repo/config";
import { z } from "zod";
import { defineAgent } from "../agent";

/**
 * Conversation Analysis Agent — classifies an inbound reply (intent, sentiment, opt-out,
 * meeting request), summarises the thread and drafts a suggested response.
 */

export interface ConversationAnalysisInput {
  channel: "EMAIL" | "WHATSAPP" | "VOICE";
  leadName: string;
  sellerName: string;
  offer: string | null;
  /** Oldest first; the last message is the one to classify. */
  messages: Array<{ direction: "OUTBOUND" | "INBOUND"; body: string }>;
  optOutKeywords: string[];
  pricingFacts: string[];
}

export const conversationAnalysisSchema = z.object({
  intent: z.enum(REPLY_INTENTS),
  sentiment: z.enum(["POSITIVE", "NEUTRAL", "NEGATIVE"]),
  optOut: z.boolean().describe("True if the prospect asked not to be contacted again."),
  meetingRequested: z.boolean(),
  summary: z.string().describe("One or two sentences summarising the conversation so far."),
  suggestedReply: z.string().nullable().describe("A reply the seller could send; null if no reply should be sent (e.g. opt-out)."),
  questions: z.array(z.string()).describe("Questions the prospect asked that need an answer."),
});
export type ConversationAnalysis = z.infer<typeof conversationAnalysisSchema>;

const RULES: Array<{ intent: ReplyIntent; pattern: RegExp }> = [
  { intent: "OUT_OF_OFFICE", pattern: /\b(out of (the )?office|ooo|away until|on leave|auto-?reply)\b/i },
  { intent: "WRONG_PERSON", pattern: /\b(wrong person|not the right (person|contact)|no longer (work|with)|don'?t handle)\b/i },
  { intent: "MEETING_REQUEST", pattern: /\b(call me|let'?s (talk|meet|chat)|schedule|book a (call|time)|available (on|this|next)|meet (on|this|next)|tomorrow|(mon|tues|wednes|thurs|fri)day)\b/i },
  { intent: "PRICING_REQUEST", pattern: /\b(price|pricing|cost|quote|quotation|rate card|how much|rates?)\b/i },
  { intent: "NOT_NOW", pattern: /\b(not (right )?now|maybe later|next (month|quarter|year)|busy (right now|at the moment)|circle back|after (diwali|the season))\b/i },
  { intent: "NEGATIVE", pattern: /\b(not interested|no thanks|no thank you|we'?re (good|fine|all set)|not looking)\b/i },
  { intent: "POSITIVE", pattern: /\b(interested|sounds (good|great|interesting)|tell me more|yes|sure|love to|keen|go ahead|send (me )?(details|more))\b/i },
];

export function analyzeConversationDeterministically(input: ConversationAnalysisInput): ConversationAnalysis {
  const last = [...input.messages].reverse().find((message) => message.direction === "INBOUND")?.body ?? "";
  const text = last.toLowerCase();
  const optOut = input.optOutKeywords.some((keyword) => keyword && new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/'/g, "'?")}\\b`, "i").test(text));
  let intent: ReplyIntent = optOut ? "OPT_OUT" : "OTHER";
  if (!optOut) intent = RULES.find((rule) => rule.pattern.test(text))?.intent ?? (text.includes("?") ? "QUESTION" : "OTHER");

  const sentiment = ["POSITIVE", "MEETING_REQUEST", "PRICING_REQUEST"].includes(intent)
    ? "POSITIVE"
    : ["NEGATIVE", "OPT_OUT", "WRONG_PERSON"].includes(intent)
      ? "NEGATIVE"
      : "NEUTRAL";
  const questions = last
    .split(/(?<=[?])\s*/)
    .filter((sentence) => sentence.trim().endsWith("?"))
    .map((sentence) => sentence.trim())
    .slice(0, 3);
  const offer = input.offer?.toLowerCase() ?? "this";

  const replies: Record<ReplyIntent, string | null> = {
    POSITIVE: `Great to hear! I'll put together a couple of ideas for ${input.leadName}. Would a 15-minute call on Tuesday or Thursday work for you?`,
    MEETING_REQUEST: "Perfect — thank you. I'll send a calendar invite shortly; let me know if another time suits you better.",
    PRICING_REQUEST: input.pricingFacts.length
      ? `Thanks for asking. ${input.pricingFacts.join("; ")}. To give you an exact quote, could you share roughly what volume you'd need?`
      : `Thanks for asking — pricing depends on scope, and I'd like to give you an accurate quote rather than a guess. Could you share roughly what you'd need?`,
    QUESTION: `Good question. ${questions[0] ? "Let me answer that properly — " : ""}would a short call be easier, or shall I reply here in detail?`,
    NOT_NOW: "Completely understand. I'll check back in a few weeks — if anything changes before then, just reply here.",
    NEGATIVE: "Thanks for letting me know — I won't take more of your time. All the best!",
    OPT_OUT: null,
    WRONG_PERSON: "Thanks, and sorry for the mix-up. Would you mind pointing me to the right person?",
    OUT_OF_OFFICE: null,
    OTHER: `Thanks for getting back to me. Is ${offer} something worth a quick conversation?`,
  };

  return {
    intent,
    sentiment,
    optOut,
    meetingRequested: intent === "MEETING_REQUEST",
    summary: `${input.leadName} ${
      {
        POSITIVE: "responded positively and wants to know more",
        MEETING_REQUEST: "asked to set up a call",
        PRICING_REQUEST: "asked about pricing",
        QUESTION: "asked a question",
        NOT_NOW: "said it isn't the right time",
        NEGATIVE: "isn't interested",
        OPT_OUT: "asked not to be contacted again",
        WRONG_PERSON: "said they aren't the right contact",
        OUT_OF_OFFICE: "sent an out-of-office reply",
        OTHER: "replied",
      }[intent]
    }${questions.length ? `: “${questions[0]}”` : "."}`,
    suggestedReply: replies[intent],
    questions,
  };
}

export const conversationAnalysisAgent = defineAgent<ConversationAnalysisInput, ConversationAnalysis>({
  name: "conversation_analysis",
  version: "v1",
  description: "Classifies inbound replies and drafts a suggested response.",
  output: conversationAnalysisSchema,
  effort: "low",
  maxTokens: 2000,
  cacheable: true,
  buildPrompt(input) {
    return {
      system: [
        "You analyse a B2B sales conversation and classify the prospect's latest reply.",
        `Intents: ${REPLY_INTENTS.join(", ")}. OPT_OUT means they asked not to be contacted — always set optOut=true then and suggestedReply=null.`,
        "The suggested reply must be short, honest and must not state prices unless given in pricingFacts.",
      ].join("\n"),
      user: JSON.stringify(input),
    };
  },
  mock: analyzeConversationDeterministically,
});
