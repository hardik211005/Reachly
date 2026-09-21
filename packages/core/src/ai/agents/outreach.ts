import { getCategory } from "@repo/config/taxonomy";
import { z } from "zod";
import { firstName, renderTemplate } from "../../shared/text";
import { defineAgent } from "../agent";

/**
 * Outreach Agent — writes one message for one lead for one sequence step, grounded in the
 * lead's real signals and the seller's configured offer. Never invents prices, customers,
 * results or claims about the prospect.
 */

export interface OutreachLeadContext {
  name: string;
  category: string | null;
  locality: string | null;
  city: string | null;
  description: string | null;
  services: string[];
  rating: number | null;
  reviewCount: number | null;
  locationsCount: number | null;
  signals: Array<{ key: string; label: string; evidence: string }>;
  contactName: string | null;
  contactTitle: string | null;
}

export interface OutreachSellerContext {
  businessName: string;
  senderName: string;
  description: string;
  valueProposition: string | null;
  offer: string | null;
  pitchAngle: string | null;
  /** Only configured prices may be mentioned; empty = don't mention pricing. */
  pricingFacts: string[];
}

export interface OutreachMessageInput {
  channel: "EMAIL" | "WHATSAPP";
  stepName: string;
  stepOrder: number;
  template: { subject: string | null; body: string };
  tone: string;
  lead: OutreachLeadContext;
  seller: OutreachSellerContext;
  previousMessages: Array<{ direction: "OUTBOUND" | "INBOUND"; channel: string; body: string }>;
}

export const outreachMessageSchema = z.object({
  subject: z.string().nullable(),
  body: z.string(),
  personalization: z.array(z.string()).describe("Facts about the lead that were used, for transparency."),
  callToAction: z.string(),
});
export type OutreachMessage = z.infer<typeof outreachMessageSchema>;

// ----------------------------------------------------------------------------- Deterministic composition (mock)

function plural(label: string): string {
  if (/[^aeiou]y$/i.test(label)) return `${label.slice(0, -1)}ies`;
  if (/(s|x|ch|sh)$/i.test(label)) return `${label}es`;
  return `${label}s`;
}

/** One specific, verifiable thing about the lead to open with (from its signals). */
export function observation(lead: OutreachLeadContext): { text: string; fact: string } {
  const where = lead.locality ?? lead.city ?? "your area";
  const bySignal = Object.fromEntries(lead.signals.map((signal) => [signal.key, signal]));
  if (bySignal.multiple_locations && lead.locationsCount && lead.locationsCount > 1) {
    return { text: `I noticed ${lead.name} now runs ${lead.locationsCount} outlets${lead.city ? ` across ${lead.city}` : ""} — impressive growth.`, fact: `${lead.locationsCount} locations` };
  }
  if (bySignal.new_opening) return { text: `Congratulations on the recent opening in ${where}.`, fact: "recently opened" };
  if (bySignal.high_review_volume && lead.reviewCount) {
    return { text: `${lead.reviewCount} reviews${lead.rating ? ` at ${lead.rating}★` : ""} says your regulars really love ${lead.name}.`, fact: `${lead.reviewCount} reviews` };
  }
  if (bySignal.takeaway_delivery) return { text: `I saw ${lead.name} does a lot of takeaway and delivery in ${where}.`, fact: "takeaway & delivery" };
  if (bySignal.no_social_presence) return { text: `I was looking for ${lead.name} on Instagram and couldn't find an active page.`, fact: "no social presence" };
  if (bySignal.weak_website) return { text: `I had a look at your website — it doesn't take orders or bookings online yet.`, fact: bySignal.weak_website.evidence };
  if (bySignal.no_website) return { text: `I couldn't find a website for ${lead.name}, which usually means customers can't find you online either.`, fact: "no website" };
  if (bySignal.hiring) return { text: `Saw that ${lead.name} is hiring — sounds like a busy season.`, fact: "hiring" };
  return { text: `I came across ${lead.name} in ${where}.`, fact: where };
}

const PROPER_NOUNS = new Set(["Meta", "Google", "Instagram", "Facebook", "WhatsApp", "LinkedIn", "Shopify", "Amazon", "YouTube", "Zomato", "Swiggy", "SEO", "AI"]);

/**
 * A short noun phrase for mid-sentence use: "Social media management for cafés: 12 posts…"
 * → "social media management for cafés".
 */
export function shortOffer(text: string): string {
  let phrase = text.split(/[.:;!?(]|\s[—–-]\s/)[0]?.trim() ?? text.trim();
  if (phrase.split(/\s+/).length > 6 && phrase.includes(",")) phrase = phrase.split(",")[0]?.trim() ?? phrase;
  phrase = phrase.replace(/[,\s]+$/, "");
  const first = phrase.split(/\s+/)[0] ?? "";
  if (/^[A-Z][a-z-]+$/.test(first) && !PROPER_NOUNS.has(first)) phrase = `${phrase.charAt(0).toLowerCase()}${phrase.slice(1)}`;
  return phrase || text;
}

export function composeOutreachMessage(input: OutreachMessageInput): OutreachMessage {
  const { lead, seller } = input;
  const category = lead.category ? getCategory(lead.category) : undefined;
  const audience = category ? plural(category.label.toLowerCase()) : "businesses";
  const obs = observation(lead);
  const offerShort = shortOffer(seller.offer ?? seller.valueProposition ?? seller.description.split(/(?<=\.)\s/)[0] ?? "what we do");
  const isWhatsApp = input.channel === "WHATSAPP";
  const followUp = input.stepOrder > 0;
  const cta = isWhatsApp
    ? "Would a quick call this week work?"
    : followUp
      ? "Would a 15-minute call this week be useful?"
      : "Would you be open to a 15-minute call this week to see if it's a fit?";
  const valueProp = seller.valueProposition
    ? `At ${seller.businessName}, ${seller.valueProposition.charAt(0).toLowerCase()}${seller.valueProposition.slice(1)}`
    : `At ${seller.businessName} we help ${audience} like yours with ${offerShort}.`;
  const pricing = seller.pricingFacts[0] ? ` ${seller.pricingFacts[0]}.` : "";

  const variables = {
    first_name: firstName(lead.contactName) ?? "there",
    business_name: lead.name,
    locality: lead.locality ?? lead.city ?? "",
    city: lead.city ?? "",
    category: category?.label.toLowerCase() ?? "business",
    sender_name: seller.senderName,
    sender_company: seller.businessName,
    offer_short: offerShort,
    personal_observation: obs.text,
    value_proposition: `${valueProp}${pricing}`,
    call_to_action: cta,
    follow_up_hook: `I'd be happy to share how we'd approach ${offerShort} for ${lead.name} specifically`,
  };

  const body = renderTemplate(input.template.body, variables)
    // Remove any placeholder the template referenced but we couldn't fill.
    .replace(/\{\{\s*[\w.]+\s*\}\}/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const subject = input.template.subject ? renderTemplate(input.template.subject, variables).replace(/\{\{\s*[\w.]+\s*\}\}/g, "").trim() : null;

  return {
    subject: isWhatsApp ? null : subject,
    body: isWhatsApp ? body.replace(/\n\n/g, "\n") : body,
    personalization: [obs.fact, ...(lead.contactName ? [`contact: ${lead.contactName}`] : []), ...(category ? [category.label] : [])],
    callToAction: cta,
  };
}

export const outreachMessageAgent = defineAgent<OutreachMessageInput, OutreachMessage>({
  name: "outreach_message",
  version: "v2",
  description: "Writes one personalised outreach message for a lead and sequence step.",
  output: outreachMessageSchema,
  effort: "low",
  maxTokens: 3000,
  cacheable: true,
  buildPrompt(input) {
    return {
      system: [
        `You write ${input.channel === "WHATSAPP" ? "short WhatsApp messages (under 60 words, no subject)" : "concise cold emails (under 120 words)"} for a B2B seller.`,
        `Tone: ${input.tone}. Sound like a real person, not marketing copy. One clear call to action.`,
        "Personalise using ONLY the lead facts provided (signals, location, category, reviews). Do not invent facts, customers, results or statistics.",
        "Never mention prices, discounts or quantities unless they appear in seller.pricingFacts.",
        "Follow the structure of the template but rewrite it naturally. Return which lead facts you used in `personalization`.",
        input.stepOrder > 0 ? "This is a follow-up: reference the earlier message briefly and add something new." : "This is the first message.",
      ].join("\n"),
      user: JSON.stringify(input),
    };
  },
  mock: composeOutreachMessage,
});

// ----------------------------------------------------------------------------- Pitch pack

export const pitchPackSchema = z.object({
  email: z.object({ subject: z.string(), body: z.string() }),
  whatsapp: z.string(),
  callOpening: z.string(),
  callPitch: z.string(),
  followUp: z.string(),
  meetingRequest: z.string(),
  objections: z.array(z.object({ objection: z.string(), response: z.string() })),
  personalization: z.array(z.string()),
});
export type PitchPack = z.infer<typeof pitchPackSchema>;

export interface PitchPackInput {
  tone: string;
  lead: OutreachLeadContext;
  seller: OutreachSellerContext;
}

export function composePitchPack(input: PitchPackInput): PitchPack {
  const base = { tone: input.tone, lead: input.lead, seller: input.seller, previousMessages: [] };
  const email = composeOutreachMessage({
    ...base,
    channel: "EMAIL",
    stepName: "Opener",
    stepOrder: 0,
    template: { subject: "Quick idea for {{business_name}}", body: "Hi {{first_name}},\n\n{{personal_observation}}\n\n{{value_proposition}}\n\n{{call_to_action}}\n\n{{sender_name}}" },
  });
  const whatsapp = composeOutreachMessage({
    ...base,
    channel: "WHATSAPP",
    stepName: "Opener",
    stepOrder: 0,
    template: { subject: null, body: "Hi {{first_name}}, {{sender_name}} from {{sender_company}} here. {{personal_observation}} {{value_proposition}} {{call_to_action}}" },
  });
  const obs = observation(input.lead);
  const offer = shortOffer(input.seller.offer ?? input.seller.valueProposition ?? "our service");
  const first = firstName(input.lead.contactName) ?? "there";
  return {
    email: { subject: email.subject ?? `Quick idea for ${input.lead.name}`, body: email.body },
    whatsapp: whatsapp.body,
    callOpening: `Hi ${first}, this is ${input.seller.senderName} from ${input.seller.businessName}. ${obs.text} Do you have two minutes? I'll be brief.`,
    callPitch: `We work with businesses like ${input.lead.name} on ${offer}. ${input.seller.pitchAngle ?? ""} The goal is simple: see whether it's worth a proper conversation.`.replace(/\s+/g, " ").trim(),
    followUp: `Hi ${first}, following up on my note about ${offer} for ${input.lead.name}. Happy to send a short example — would that help?`,
    meetingRequest: `Would you have 15 minutes on Tuesday or Thursday afternoon? I'll bring a couple of ideas specific to ${input.lead.name}.`,
    objections: [
      { objection: "We already have someone for this.", response: "Makes sense — most people we speak to do. Would it be useful to compare notes anyway? If there's nothing to improve, I'll say so." },
      { objection: "Send me some information.", response: `Happy to. So it's relevant, what matters most to ${input.lead.name} right now?` },
      {
        objection: "How much does it cost?",
        response: input.seller.pricingFacts.length
          ? `${input.seller.pricingFacts.join("; ")}. The exact quote depends on your volume — can I ask a couple of questions?`
          : "It depends on scope — I'd rather give you an accurate quote than a guess. Can I ask a couple of questions about what you need?",
      },
      { objection: "Not right now.", response: "No problem. When would be a better time to revisit — next month or next quarter?" },
    ],
    personalization: email.personalization,
  };
}

export const pitchPackAgent = defineAgent<PitchPackInput, PitchPack>({
  name: "pitch_pack",
  version: "v2",
  description: "Prepares a full set of sales assets for one lead: email, WhatsApp, call opening, objections.",
  output: pitchPackSchema,
  effort: "medium",
  maxTokens: 6000,
  cacheable: true,
  buildPrompt(input) {
    return {
      system: [
        "You prepare concise, personalised sales assets for a B2B seller contacting one specific business.",
        `Tone: ${input.tone}. Natural, specific, respectful of the prospect's time.`,
        "Use only the lead facts provided. Never invent prices (only seller.pricingFacts), customers, results or claims.",
        "Objection responses must be honest and non-pushy.",
      ].join("\n"),
      user: JSON.stringify(input),
    };
  },
  mock: composePitchPack,
});
