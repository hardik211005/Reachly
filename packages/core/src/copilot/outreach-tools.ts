import { REPLY_INTENT_LABELS, type ReplyIntent } from "@repo/config";
import { z } from "zod";
import { getCampaignStats, listCampaignsWithStats } from "../campaigns/stats";
import { listLeads } from "../leads/service";
import { inboxSummary, listConversations } from "../outreach/inbox";
import { registerMockFormatter, registerMockIntent } from "./mock";
import { registerCopilotTool } from "./tools";

/** Copilot tools over campaigns, the inbox and leads — all thin wrappers over real services. */

const rate = (value: number | null) => (value === null ? "n/a" : `${Math.round(value * 100)}%`);

registerCopilotTool({
  name: "list_campaigns",
  description: "All campaigns with status, automation mode, audience size, messages sent, lead reply rate and meetings booked.",
  parameters: z.object({}),
  permission: "campaigns:read",
  async run(ctx) {
    const campaigns = await listCampaignsWithStats(ctx);
    return campaigns
      .filter((campaign) => campaign.status !== "ARCHIVED")
      .map((campaign) => ({
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        mode: campaign.automationMode,
        channels: campaign.channels,
        leads: campaign.audience,
        sent: campaign.sent,
        replyRate: campaign.replyRate,
        positiveReplies: campaign.positive,
        meetings: campaign.meetings,
      }));
  },
});

registerCopilotTool({
  name: "get_campaign_performance",
  description: "Detailed performance of one campaign, found by (part of) its name: funnel from leads contacted to meetings, delivery/open/reply rates, opt-outs and messages awaiting review.",
  parameters: z.object({ name: z.string().min(1).max(120) }),
  permission: "campaigns:read",
  async run(ctx, args) {
    // Accent- and order-insensitive: "delhi cafes" finds "Delhi Cafés — social media".
    const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const words = fold(args.name).split(/\W+/).filter(Boolean);
    const campaigns = await ctx.db.campaign.findMany({ where: { deletedAt: null }, select: { id: true, name: true, status: true }, orderBy: { createdAt: "desc" } });
    const campaign = campaigns.find((item) => words.every((word) => fold(item.name).includes(word)));
    if (!campaign) return { error: `No campaign matches “${args.name}”` };
    const stats = await getCampaignStats(ctx, campaign.id);
    return { name: campaign.name, status: campaign.status, leads: stats.audience, funnel: stats.leads, sent: stats.sent, rates: stats.rates, optOuts: stats.optOuts, awaitingReview: stats.pendingApproval };
  },
});

registerCopilotTool({
  name: "get_inbox_summary",
  description: "What needs attention in the inbox: conversations needing a response (with the AI-classified intent of the latest reply), unread count and messages waiting for approval.",
  parameters: z.object({}),
  permission: "conversations:read",
  async run(ctx) {
    const [summary, needs] = await Promise.all([inboxSummary(ctx), listConversations(ctx, { status: "NEEDS_RESPONSE", limit: 8 })]);
    return {
      ...summary,
      conversations: needs.items.map((item) => ({ lead: item.lead.name, channel: item.channel, intent: item.aiIntent, lastMessage: item.lastMessage?.body.slice(0, 160) ?? null, at: item.lastMessageAt })),
    };
  },
});

registerCopilotTool({
  name: "find_leads",
  description: "Search leads by text, status and minimum score, best-scoring first. Use it for questions like “show my hottest leads” or “qualified cafés in Noida”.",
  parameters: z.object({
    q: z.string().max(120).optional(),
    status: z.array(z.enum(["NEW", "QUALIFIED", "CONTACTED", "REPLIED", "INTERESTED", "MEETING", "QUOTE_SENT", "WON", "LOST"])).max(5).optional(),
    minScore: z.number().int().min(0).max(100).optional(),
    limit: z.number().int().min(1).max(20).default(8),
  }),
  permission: "leads:read",
  async run(ctx, args) {
    const result = await listLeads(ctx, { q: args.q, status: args.status?.join(","), minScore: args.minScore, pageSize: args.limit, sort: "score", order: "desc" });
    return {
      total: result.total,
      leads: result.items.map((lead) => ({ id: lead.id, name: lead.name, category: lead.category, city: lead.city, locality: lead.locality, score: lead.score, status: lead.status })),
    };
  },
});

// ----------------------------------------------------------------------------- Demo-mode intents

const CAMPAIGN_STOPWORDS = new Set(["how", "is", "was", "are", "the", "of", "for", "about", "my", "our", "all", "each", "every", "which", "what", "this", "that", "any", "a", "an", "doing", "did", "does", "show", "me", "tell"]);

registerMockIntent(
  {
    tool: "get_inbox_summary",
    match: (text) => (/\b(inbox|needs? (a )?(response|reply)|waiting for (me|approval|review)|approv\w*|review queue|who replied|unread)\b/.test(text) ? {} : null),
  },
  { first: true },
);
registerMockIntent(
  {
    tool: "find_leads",
    match: (text) =>
      /\b(leads?|prospects?)\b/.test(text) && /\b(hot|hottest|best|top|high|strongest|qualified|interested)\b/.test(text)
        ? { minScore: /\b(hot|hottest|best|top|strongest)\b/.test(text) ? 80 : undefined, status: /\binterested\b/.test(text) ? ["INTERESTED", "MEETING"] : undefined, limit: 8 }
        : null,
  },
  { first: true },
);
registerMockIntent({ tool: "list_campaigns", match: (text) => (/\bcampaigns?\b/.test(text) ? {} : null) }, { first: true });
// "How is the Noida D2C campaign doing?" → the words before "campaign" name it.
registerMockIntent(
  {
    tool: "get_campaign_performance",
    match: (text) => {
      const before = /^(.*?)\bcampaign\b/.exec(text)?.[1] ?? "";
      const words: string[] = [];
      for (const word of before.trim().split(/\s+/).reverse()) {
        if (!word || CAMPAIGN_STOPWORDS.has(word) || words.length === 4) break;
        words.unshift(word);
      }
      return words.length ? { name: words.join(" ") } : null;
    },
  },
  { first: true },
);

registerMockFormatter("list_campaigns", (result) => {
  const rows = result as Array<{ name: string; status: string; leads: number; sent: number; replyRate: number | null; meetings: number }>;
  if (!rows.length) return "There are no campaigns yet. Create one from Campaigns → New campaign.";
  return `You have ${rows.length} campaign${rows.length === 1 ? "" : "s"}:\n${rows
    .map((row) => `• ${row.name} (${row.status.toLowerCase()}): ${row.leads} leads, ${row.sent} messages sent, ${rate(row.replyRate)} of contacted leads replied, ${row.meetings} meeting${row.meetings === 1 ? "" : "s"}`)
    .join("\n")}`;
});

registerMockFormatter("get_campaign_performance", (result) => {
  const data = result as { error?: string; name: string; status: string; leads: number; funnel: { contacted: number; opened: number; replied: number; positive: number; meetings: number }; rates: { reply: number | null }; optOuts: number; awaitingReview: number };
  if (data.error) return data.error;
  return `${data.name} (${data.status.toLowerCase()}): ${data.funnel.contacted} of ${data.leads} leads contacted, ${data.funnel.opened} opened, ${data.funnel.replied} replied (${rate(data.rates.reply)}), ${data.funnel.positive} positive, ${data.funnel.meetings} meeting${data.funnel.meetings === 1 ? "" : "s"}. ${data.optOuts} opt-out${data.optOuts === 1 ? "" : "s"}${data.awaitingReview ? `, ${data.awaitingReview} message${data.awaitingReview === 1 ? "" : "s"} awaiting your review` : ""}.`;
});

registerMockFormatter("get_inbox_summary", (result) => {
  const data = result as { needsResponse: number; unread: number; pendingApproval: number; conversations: Array<{ lead: string; intent: ReplyIntent | null; lastMessage: string | null }> };
  const head = `${data.needsResponse} conversation${data.needsResponse === 1 ? " needs" : "s need"} a response, ${data.unread} unread, and ${data.pendingApproval} message${data.pendingApproval === 1 ? "" : "s"} waiting for approval.`;
  if (!data.conversations.length) return head;
  return `${head}\n${data.conversations
    .map((item) => `• ${item.lead}${item.intent ? ` — ${REPLY_INTENT_LABELS[item.intent].toLowerCase()}` : ""}${item.lastMessage ? `: “${item.lastMessage.slice(0, 90)}”` : ""}`)
    .join("\n")}`;
});

registerMockFormatter("find_leads", (result) => {
  const data = result as { total: number; leads: Array<{ name: string; score: number | null; status: string; locality: string | null; city: string | null }> };
  if (!data.leads.length) return "No leads match that.";
  return `${data.total} lead${data.total === 1 ? "" : "s"} match. The top ones:\n${data.leads
    .map((lead) => `• ${lead.name} — score ${lead.score ?? "–"}, ${lead.status.toLowerCase()}${lead.locality || lead.city ? `, ${[lead.locality, lead.city].filter(Boolean).join(", ")}` : ""}`)
    .join("\n")}`;
});
