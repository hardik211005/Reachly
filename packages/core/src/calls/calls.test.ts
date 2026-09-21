import { describe, expect, it } from "vitest";
import { analyzeCallDeterministically, composeCallBrief, decideVoiceTurn, type CallBrief } from "../ai/agents/calls";
import type { OutreachLeadContext, OutreachSellerContext } from "../ai/agents/outreach";
import { parseSuggestedTime } from "./schedule";
import { buildSimulatedConversation } from "./simulator";

const lead: OutreachLeadContext = {
  name: "Monsoon Café",
  category: "cafe",
  locality: "Hauz Khas",
  city: "New Delhi",
  description: null,
  services: [],
  rating: 4.6,
  reviewCount: 812,
  locationsCount: 3,
  signals: [{ key: "multiple_locations", label: "Multiple locations", evidence: "3 outlets" }],
  contactName: "Priya Sethi",
  contactTitle: "Owner",
};
const seller: OutreachSellerContext = {
  businessName: "Demo Growth Agency",
  senderName: "Aarav",
  description: "Growth agency",
  valueProposition: "More customers from social and search.",
  offer: "Social media management for cafés",
  pitchAngle: null,
  pricingFacts: [],
};
const brief: CallBrief = composeCallBrief({ lead, seller, campaignObjective: null, history: [], announceAi: true });
const KEYWORDS = ["stop", "unsubscribe", "remove me", "not interested"];

function turn(transcript: Array<{ speaker: "agent" | "prospect"; text: string }>) {
  return decideVoiceTurn({ brief, sellerName: "Demo Growth Agency", transcript, optOutKeywords: KEYWORDS, maxTurns: 6 });
}

describe("call brief", () => {
  it("discloses the AI and never states prices it wasn't given", () => {
    expect(brief.opening).toMatch(/^Hi Priya, I'm an AI assistant calling on behalf of Aarav at Demo Growth Agency\. Do you have a minute\?$/);
    expect(JSON.stringify(brief)).not.toMatch(/₹|\$\d/);
    const priced = composeCallBrief({ lead, seller: { ...seller, pricingFacts: ["Social media management: ₹35,000 per month"] }, campaignObjective: null, history: [], announceAi: false });
    expect(priced.objections.find((item) => /cost/i.test(item.objection))?.response).toContain("₹35,000");
    expect(priced.opening).not.toMatch(/AI assistant/);
  });
});

describe("voice turn policy", () => {
  it("opens with the brief's opening line", () => {
    expect(turn([])).toMatchObject({ say: brief.opening, end: false });
  });

  it("ends immediately and politely on an opt-out", () => {
    const result = turn([{ speaker: "agent", text: brief.opening }, { speaker: "prospect", text: "Please don't call this number again." }]);
    expect(result).toMatchObject({ end: true, reason: "opt_out" });
  });

  it("books the meeting when the prospect offers a time", () => {
    const result = turn([
      { speaker: "agent", text: brief.opening },
      { speaker: "prospect", text: "Sure." },
      { speaker: "agent", text: brief.pitch },
      { speaker: "prospect", text: "Thursday afternoon works." },
    ]);
    expect(result).toMatchObject({ end: true, reason: "meeting_booked" });
  });

  it("answers pricing only from the brief and moves to the close", () => {
    const result = turn([{ speaker: "agent", text: brief.opening }, { speaker: "prospect", text: "How much does this cost?" }]);
    expect(result.end).toBe(false);
    expect(result.say).toContain("accurate quote");
    expect(result.say).toContain(brief.closing);
  });

  it("agrees a callback instead of pitching when it's a bad time", () => {
    const first = turn([{ speaker: "agent", text: brief.opening }, { speaker: "prospect", text: "I'm driving, can you call me back later?" }]);
    expect(first.end).toBe(false);
    const second = turn([
      { speaker: "agent", text: brief.opening },
      { speaker: "prospect", text: "I'm driving, can you call me back later?" },
      { speaker: "agent", text: first.say },
      { speaker: "prospect", text: "Yes, later is better." },
    ]);
    expect(second).toMatchObject({ end: true, reason: "callback" });
  });
});

describe("call analysis", () => {
  const analyze = (lines: string[], durationSeconds = 70) =>
    analyzeCallDeterministically({ leadName: "Monsoon Café", sellerName: "Demo Growth Agency", transcript: lines.map((text) => ({ speaker: "prospect" as const, text })), durationSeconds, optOutKeywords: KEYWORDS });

  it.each([
    [["Thursday afternoon works for me."], "MEETING_REQUESTED"],
    [["Can you send me some details by email?"], "NEEDS_INFORMATION"],
    [["Sorry, can you call me back later?"], "CALL_BACK_LATER"],
    [["No thanks, we're all set."], "NOT_INTERESTED"],
    [["You've got the wrong person."], "WRONG_CONTACT"],
    [["Please stop calling me."], "DO_NOT_CONTACT"],
  ])("%s → %s", (lines, outcome) => {
    expect(analyze(lines).outcome).toBe(outcome);
  });

  it("marks opt-outs and never schedules follow-ups for them", () => {
    const result = analyze(["Remove me from your list, don't call again."]);
    expect(result).toMatchObject({ optOut: true, followUpInDays: null });
  });

  it("doesn't infer an outcome from a call that barely connected", () => {
    expect(analyze(["Hello?"], 4).outcome).toBe("UNKNOWN");
  });
});

describe("meeting time from what the prospect said", () => {
  // Monday 2026-09-21 10:30 IST
  const now = new Date("2026-09-21T05:00:00Z");
  it("resolves weekdays and parts of the day in the workspace timezone", () => {
    expect(parseSuggestedTime("Thursday afternoon works for me", "Asia/Kolkata", now)?.toISOString()).toBe("2026-09-24T09:30:00.000Z"); // Thu 15:00 IST
    expect(parseSuggestedTime("Tomorrow at 4pm?", "Asia/Kolkata", now)?.toISOString()).toBe("2026-09-22T10:30:00.000Z"); // Tue 16:00 IST
    expect(parseSuggestedTime("Monday morning", "Asia/Kolkata", now)?.toISOString()).toBe("2026-09-28T05:30:00.000Z"); // next Mon 11:00 IST
  });
  it("returns null when no day was given — no invented times", () => {
    expect(parseSuggestedTime("Sounds good, let's talk sometime", "Asia/Kolkata", now)).toBeNull();
  });
});

describe("simulated conversations", () => {
  it("follow the same policy and end cleanly", () => {
    const segments = buildSimulatedConversation({ brief, sellerName: "Demo Growth Agency", scenario: "meeting", optOutKeywords: KEYWORDS });
    expect(segments[0]).toMatchObject({ speaker: "agent", text: brief.opening });
    expect(segments.at(-1)?.speaker).toBe("agent");
    expect(segments.at(-1)?.text).toMatch(/calendar invite/);
    for (let index = 1; index < segments.length; index += 1) expect(segments[index]!.startMs).toBeGreaterThanOrEqual(segments[index - 1]!.endMs);
    const optOut = buildSimulatedConversation({ brief, sellerName: "Demo Growth Agency", scenario: "opt_out", optOutKeywords: KEYWORDS });
    expect(optOut.at(-1)?.text).toMatch(/not contacted again/);
  });
});
