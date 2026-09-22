import { DEAL_STAGE_LABELS, type DealStage } from "@repo/config";
import { breakdown, counts, lossReasons, stepPerformance, type BreakdownRow } from "../analytics/report";
import type { ResolvedFilters } from "../analytics/filters";
import type { TenantContext } from "../context";
import { formatMoney } from "../quotes/pricing";
import { compareProportions, coverageConfidence, pct } from "./stats";

/**
 * Insight generators. Each one runs real analytics queries and only proposes an insight when
 * the data supports it: minimum sample sizes, a meaningful difference and a stated
 * confidence. The template wording uses only numbers from `facts`; AI may rephrase it later
 * but may not add numbers.
 */

export type Sentiment = "POSITIVE" | "NEGATIVE" | "NEUTRAL";

export interface Candidate {
  kind: string;
  /** Distinguishes candidates of the same kind (e.g. which channel). */
  key: string;
  title: string;
  body: string;
  metric: string;
  currentValue: number;
  comparisonValue: number | null;
  comparisonLabel: string | null;
  sentiment: Sentiment;
  confidence: number;
  campaignId?: string | null;
  supportingData: Record<string, unknown>;
  /** The only figures AI phrasing may use. */
  facts: Record<string, string | number>;
  /** Ranking weight: confidence × how actionable / large the effect is. */
  weight: number;
}

export interface GeneratorContext {
  ctx: TenantContext;
  filters: ResolvedFilters;
  currency: string;
  now: Date;
  periodLabel: string;
}

const MIN_GROUP = 8;

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** How each channel reads mid-sentence. */
const CHANNEL_PHRASE: Record<string, string> = { EMAIL: "email", WHATSAPP: "WhatsApp", VOICE: "AI calls", MANUAL_CALL: "phone calls" };
const channelPhrase = (row: BreakdownRow) => CHANNEL_PHRASE[row.key] ?? row.label;
const MIN_CONFIDENCE = 0.7;

function best(rows: BreakdownRow[], rate: (row: BreakdownRow) => number | null, minContacted = MIN_GROUP) {
  return rows.filter((row) => row.contacted >= minContacted && rate(row) !== null).sort((a, b) => (rate(b) ?? 0) - (rate(a) ?? 0));
}

/** One group against everyone else in the breakdown. */
function versusRest(rows: BreakdownRow[], winner: BreakdownRow, field: "positive" | "replied" | "meetings") {
  const rest = rows.filter((row) => row.key !== winner.key);
  const restContacted = rest.reduce((sum, row) => sum + row.contacted, 0);
  const restHits = rest.reduce((sum, row) => sum + row[field], 0);
  return { restContacted, restHits, test: compareProportions(winner[field], winner.contacted, restHits, restContacted) };
}

// ----------------------------------------------------------------------------- Channels

async function channels(g: GeneratorContext): Promise<Candidate[]> {
  const rows = (await breakdown(g.ctx, g.filters, "channel", g.currency)).filter((row) => row.contacted > 0);
  const ranked = best(rows, (row) => row.positiveRate);
  if (ranked.length < 2) return [];
  const [top, second] = ranked as [BreakdownRow, BreakdownRow];
  const test = compareProportions(top.positive, top.contacted, second.positive, second.contacted);
  if (!test || test.confidence < MIN_CONFIDENCE || (test.lift !== null && test.lift < 0.25) || top.positive < 2) return [];
  const topPhrase = channelPhrase(top);
  const otherPhrase = channelPhrase(second);
  const facts = { channel: topPhrase, other: otherPhrase, rate: pct(test.rateA), otherRate: pct(test.rateB), n: top.contacted, otherN: second.contacted, positives: top.positive, otherPositives: second.positive };
  return [
    {
      kind: "channel_comparison",
      key: `${top.key}-vs-${second.key}`,
      title: `${capitalize(topPhrase)} ${topPhrase.endsWith("s") ? "get" : "gets"} more positive responses than ${otherPhrase}`,
      body: `${facts.rate} of leads contacted by ${topPhrase} responded positively, against ${facts.otherRate} by ${otherPhrase} (${facts.n} and ${facts.otherN} leads, ${g.periodLabel}). Consider leading with ${topPhrase} for similar leads.`,
      metric: "positive_reply_rate",
      currentValue: test.rateA,
      comparisonValue: test.rateB,
      comparisonLabel: `vs ${second.label}`,
      sentiment: "POSITIVE",
      confidence: test.confidence,
      supportingData: { method: "Two-proportion z-test on positive responses per contacted lead", p: test.p, groups: rows.map((row) => ({ label: row.label, contacted: row.contacted, positive: row.positive, rate: row.positiveRate })) },
      facts,
      weight: test.confidence * 1.2,
    },
  ];
}

// ----------------------------------------------------------------------------- Segments (area, category, score, campaign)

async function segment(g: GeneratorContext, dimension: "area" | "category" | "campaign", noun: (row: BreakdownRow) => string, kind: string): Promise<Candidate[]> {
  const rows = (await breakdown(g.ctx, g.filters, dimension, g.currency, 30)).filter((row) => row.contacted > 0);
  const field: "positive" | "replied" = rows.reduce((sum, row) => sum + row.positive, 0) >= 6 ? "positive" : "replied";
  const rate = (row: BreakdownRow) => (field === "positive" ? row.positiveRate : row.replyRate);
  const minimum = dimension === "campaign" ? MIN_GROUP : 5;
  const top = best(rows, rate, minimum)[0];
  if (!top) return [];
  const { restContacted, restHits, test } = versusRest(rows, top, field);
  if (!test || restContacted < MIN_GROUP || test.confidence < MIN_CONFIDENCE || (test.lift !== null && test.lift < 0.3) || top[field] < 2) return [];
  const what = field === "positive" ? "responded positively" : "replied";
  const facts = { segment: noun(top), rate: pct(test.rateA), restRate: pct(test.rateB), n: top.contacted, restN: restContacted, hits: top[field], restHits };
  return [
    {
      kind,
      key: top.key,
      title: dimension === "campaign" ? `${top.label} is your strongest campaign` : `${capitalize(noun(top))} convert better than the rest`,
      body:
        dimension === "campaign"
          ? `${facts.rate} of leads in “${top.label}” ${what}, against ${facts.restRate} across your other campaigns (${facts.n} vs ${facts.restN} leads contacted, ${g.periodLabel}).`
          : `${facts.rate} of ${noun(top)} ${what}, compared with ${facts.restRate} of other leads (${facts.n} vs ${facts.restN} contacted, ${g.periodLabel}). Worth prioritising in your next discovery run.`,
      metric: field === "positive" ? "positive_reply_rate" : "reply_rate",
      currentValue: test.rateA,
      comparisonValue: test.rateB,
      comparisonLabel: "vs everyone else",
      sentiment: "POSITIVE",
      confidence: test.confidence,
      campaignId: dimension === "campaign" ? top.key : null,
      supportingData: { method: `Two-proportion z-test, ${field === "positive" ? "positive responses" : "replies"} per contacted lead`, p: test.p, dimension, groups: rows.slice(0, 10).map((row) => ({ label: row.label, contacted: row.contacted, hits: row[field], rate: rate(row) })) },
      facts,
      weight: test.confidence,
    },
  ];
}

// ----------------------------------------------------------------------------- Lead score calibration

async function scoreCalibration(g: GeneratorContext): Promise<Candidate[]> {
  const rows = (await breakdown(g.ctx, g.filters, "score", g.currency)).filter((row) => row.contacted > 0 && row.key !== "Unscored");
  const high = rows.find((row) => row.key === "80–100");
  const lower = rows.filter((row) => row.key !== "80–100");
  if (!high) return [];
  const lowContacted = lower.reduce((sum, row) => sum + row.contacted, 0);
  const lowReplied = lower.reduce((sum, row) => sum + row.replied, 0);
  if (high.contacted < MIN_GROUP || lowContacted < MIN_GROUP) return [];
  const test = compareProportions(high.replied, high.contacted, lowReplied, lowContacted);
  if (!test || test.confidence < MIN_CONFIDENCE || Math.abs(test.rateA - test.rateB) < 0.08) return [];
  const better = test.rateA > test.rateB;
  const facts = { highRate: pct(test.rateA), lowRate: pct(test.rateB), n: high.contacted, lowN: lowContacted };
  return [
    {
      kind: "score_calibration",
      key: better ? "high-scores-reply-more" : "high-scores-reply-less",
      title: better ? "Your lead scores predict replies" : "High scores aren't predicting replies",
      body: better
        ? `Leads scored 80+ replied ${facts.highRate} of the time, against ${facts.lowRate} for lower scores (${facts.n} vs ${facts.lowN} contacted, ${g.periodLabel}). Contact high scorers first.`
        : `Leads scored 80+ replied ${facts.highRate} of the time, against ${facts.lowRate} for lower scores (${facts.n} vs ${facts.lowN} contacted, ${g.periodLabel}). Review your scoring weights in Settings.`,
      metric: "reply_rate",
      currentValue: test.rateA,
      comparisonValue: test.rateB,
      comparisonLabel: "vs scores below 80",
      sentiment: better ? "POSITIVE" : "NEGATIVE",
      confidence: test.confidence,
      supportingData: { method: "Two-proportion z-test on replies per contacted lead, by score band", p: test.p, groups: rows.map((row) => ({ label: row.label, contacted: row.contacted, replied: row.replied, rate: row.replyRate })) },
      facts,
      weight: test.confidence * 0.9,
    },
  ];
}

// ----------------------------------------------------------------------------- Objections & losses

async function objections(g: GeneratorContext): Promise<Candidate[]> {
  const losses = await lossReasons(g.ctx, g.filters);
  const objectionTotal = losses.objections.reduce((sum, row) => sum + row.count, 0);
  const lostTotal = losses.deals.reduce((sum, row) => sum + row.count, 0);
  const evidence = objectionTotal + lostTotal;
  if (evidence < 4) return [];
  const priceObjections = losses.objections.find((row) => row.theme === "Price / budget")?.count ?? 0;
  const priceLosses = losses.deals.filter((row) => /price|budget|cost|expensive/i.test(row.reason)).reduce((sum, row) => sum + row.count, 0);
  const topTheme = losses.objections[0];
  const topLoss = losses.deals[0];
  const priceShare = (priceObjections + priceLosses) / evidence;
  if (priceShare >= 0.35) {
    const facts = { priceObjections, objectionTotal, priceLosses, lostTotal, share: pct(priceShare) };
    return [
      {
        kind: "loss_reasons",
        key: "price",
        title: "Pricing is the most common objection",
        body: `Price or budget came up in ${priceObjections} of ${objectionTotal} objections raised on calls${lostTotal ? `, and ${priceLosses} of ${lostTotal} lost deal${lostTotal === 1 ? "" : "s"} ${priceLosses === 1 ? "was" : "were"} lost on price` : ""} (${g.periodLabel}). Lead with value and a smaller starter package, or add a volume discount rule.`,
        metric: "objection_share",
        currentValue: priceShare,
        comparisonValue: null,
        comparisonLabel: null,
        sentiment: "NEGATIVE",
        confidence: coverageConfidence(evidence),
        supportingData: { method: "Share of call objections (keyword themes) and deal loss reasons", objections: losses.objections, lostDeals: losses.deals },
        facts,
        weight: coverageConfidence(evidence) * 1.1,
      },
    ];
  }
  if (topTheme && topTheme.count >= 3) {
    const facts = { theme: topTheme.theme, count: topTheme.count, objectionTotal };
    return [
      {
        kind: "loss_reasons",
        key: topTheme.theme,
        title: `“${topTheme.theme}” is the objection you hear most`,
        body: `${topTheme.theme} came up in ${topTheme.count} of ${objectionTotal} objections raised on calls (${g.periodLabel}). Add a prepared answer to your call brief and outreach.`,
        metric: "objection_share",
        currentValue: topTheme.count / objectionTotal,
        comparisonValue: null,
        comparisonLabel: null,
        sentiment: "NEUTRAL",
        confidence: coverageConfidence(evidence),
        supportingData: { method: "Share of call objections (keyword themes)", objections: losses.objections, lostDeals: losses.deals, topLoss: topLoss ?? null },
        facts,
        weight: coverageConfidence(evidence) * 0.8,
      },
    ];
  }
  return [];
}

// ----------------------------------------------------------------------------- Follow-ups

async function followUps(g: GeneratorContext): Promise<Candidate[]> {
  const steps = (await stepPerformance(g.ctx, g.filters)).filter((step) => step.sent > 0);
  const first = steps[0];
  if (!first || first.sent < MIN_GROUP) return [];
  const totalReplies = steps.reduce((sum, step) => sum + step.replied, 0);
  if (totalReplies < 4) return [];
  const followUpReplies = totalReplies - first.replied;
  // Decay: the first follow-up step whose reply rate falls below half of the first message.
  const drop = steps.slice(1).find((step) => step.sent >= MIN_GROUP && (step.replyRate ?? 0) < (first.replyRate ?? 0) / 2);
  if (drop && first.replied >= 3) {
    const test = compareProportions(first.replied, first.sent, drop.replied, drop.sent);
    if (test && test.confidence >= MIN_CONFIDENCE) {
      const facts = { step: drop.label.toLowerCase(), firstRate: pct(test.rateA), dropRate: pct(test.rateB), n: first.sent, dropN: drop.sent };
      return [
        {
          kind: "followup_decay",
          key: `step-${drop.step}`,
          title: `Replies drop off by the ${drop.label.toLowerCase()}`,
          body: `The first message gets replies from ${facts.firstRate} of leads; by the ${facts.step} that falls to ${facts.dropRate} (${facts.n} and ${facts.dropN} leads, ${g.periodLabel}). Consider ending sequences earlier or changing the angle of later steps.`,
          metric: "reply_rate_by_step",
          currentValue: test.rateB,
          comparisonValue: test.rateA,
          comparisonLabel: "vs first message",
          sentiment: "NEGATIVE",
          confidence: test.confidence,
          supportingData: { method: "Replies credited to the last step received before the first reply", steps },
          facts,
          weight: test.confidence,
        },
      ];
    }
  }
  const share = followUpReplies / totalReplies;
  if (followUpReplies >= 3 && share >= 0.3) {
    const facts = { share: pct(share), followUpReplies, totalReplies };
    return [
      {
        kind: "followup_value",
        key: "followups-earn-replies",
        title: "Follow-ups bring in a big share of your replies",
        body: `${facts.followUpReplies} of ${facts.totalReplies} replies (${facts.share}) came after a follow-up rather than the first message (${g.periodLabel}). Keep at least two follow-ups in your sequences.`,
        metric: "followup_reply_share",
        currentValue: share,
        comparisonValue: null,
        comparisonLabel: null,
        sentiment: "POSITIVE",
        confidence: coverageConfidence(totalReplies, 20),
        supportingData: { method: "Replies credited to the last step received before the first reply", steps },
        facts,
        weight: coverageConfidence(totalReplies, 20) * 0.9,
      },
    ];
  }
  return [];
}

// ----------------------------------------------------------------------------- Period over period

async function periodChange(g: GeneratorContext): Promise<Candidate[]> {
  const [now, before] = await Promise.all([counts(g.ctx, g.filters.from, g.filters.to, g.filters), counts(g.ctx, g.filters.previousFrom, g.filters.previousTo, g.filters)]);
  if (now.contacted < MIN_GROUP * 2 || before.contacted < MIN_GROUP * 2) return [];
  const test = compareProportions(now.replied, now.contacted, before.replied, before.contacted);
  if (!test || test.confidence < MIN_CONFIDENCE || Math.abs(test.rateA - test.rateB) < 0.05) return [];
  const up = test.rateA > test.rateB;
  const facts = { rate: pct(test.rateA), previousRate: pct(test.rateB), n: now.contacted, previousN: before.contacted };
  return [
    {
      kind: "period_change",
      key: up ? "reply-rate-up" : "reply-rate-down",
      title: up ? "Reply rate is up on the previous period" : "Reply rate has dropped",
      body: `${facts.rate} of leads contacted replied ${g.periodLabel}, against ${facts.previousRate} in the period before (${facts.n} vs ${facts.previousN} leads).${up ? "" : " Check recent campaign changes, list quality and deliverability."}`,
      metric: "reply_rate",
      currentValue: test.rateA,
      comparisonValue: test.rateB,
      comparisonLabel: "vs previous period",
      sentiment: up ? "POSITIVE" : "NEGATIVE",
      confidence: test.confidence,
      supportingData: { method: "Two-proportion z-test, replies per contacted lead, period over period", p: test.p, current: { contacted: now.contacted, replied: now.replied }, previous: { contacted: before.contacted, replied: before.replied } },
      facts,
      weight: test.confidence * 1.1,
    },
  ];
}

// ----------------------------------------------------------------------------- Pipeline hygiene (exact, current state)

async function stalledDeals(g: GeneratorContext): Promise<Candidate[]> {
  const cutoff = new Date(g.now.getTime() - 14 * 86_400_000);
  const deals = await g.ctx.db.deal.findMany({
    where: { deletedAt: null, stage: { in: ["QUALIFIED", "CONTACTED", "INTERESTED", "MEETING", "PROPOSAL", "NEGOTIATION"] }, stageChangedAt: { lt: cutoff }, lead: { deletedAt: null } },
    select: { id: true, title: true, stage: true, value: true, stageChangedAt: true },
    orderBy: { value: "desc" },
  });
  if (deals.length < 2) return [];
  const value = deals.reduce((sum, deal) => sum + Number(deal.value), 0);
  const facts = { count: deals.length, value: formatMoney(value, g.currency, { decimals: false }) };
  return [
    {
      kind: "stalled_deals",
      key: "stalled",
      title: `${deals.length} deals haven't moved in two weeks`,
      body: `${facts.count} open deals worth ${facts.value} have sat in the same stage for 14+ days. Add a next step to each, or close the ones that went quiet.`,
      metric: "stalled_deal_value",
      currentValue: value,
      comparisonValue: null,
      comparisonLabel: null,
      sentiment: "NEGATIVE",
      confidence: 0.99,
      supportingData: { method: "Open deals whose stage hasn't changed for 14 days (current state)", deals: deals.slice(0, 8).map((deal) => ({ title: deal.title, stage: DEAL_STAGE_LABELS[deal.stage as DealStage], value: Number(deal.value), since: deal.stageChangedAt })) },
      facts,
      weight: 0.95,
    },
  ];
}

async function unopenedQuotes(g: GeneratorContext): Promise<Candidate[]> {
  const cutoff = new Date(g.now.getTime() - 3 * 86_400_000);
  const quotes = await g.ctx.db.quote.findMany({ where: { deletedAt: null, status: "SENT", viewedAt: null, sentAt: { lt: cutoff }, lead: { deletedAt: null } }, select: { number: true, total: true, sentAt: true, lead: { select: { name: true } } } });
  if (!quotes.length) return [];
  const facts = { count: quotes.length, value: formatMoney(quotes.reduce((sum, quote) => sum + Number(quote.total), 0), g.currency, { decimals: false }) };
  return [
    {
      kind: "unopened_quotes",
      key: "unopened",
      title: quotes.length === 1 ? `A sent quote hasn't been opened` : `${quotes.length} sent quotes haven't been opened`,
      body: `${facts.count} quote${quotes.length === 1 ? "" : "s"} worth ${facts.value} ${quotes.length === 1 ? "was" : "were"} sent 3+ days ago and not opened yet. A quick call or WhatsApp nudge usually helps.`,
      metric: "unopened_quote_value",
      currentValue: quotes.length,
      comparisonValue: null,
      comparisonLabel: null,
      sentiment: "NEGATIVE",
      confidence: 0.99,
      supportingData: { method: "Sent quotes with no recorded view after 3 days (current state)", quotes: quotes.map((quote) => ({ number: quote.number, company: quote.lead.name, total: Number(quote.total), sentAt: quote.sentAt })) },
      facts,
      weight: 0.85,
    },
  ];
}

// ----------------------------------------------------------------------------- All

export async function runGenerators(g: GeneratorContext): Promise<Candidate[]> {
  const results = await Promise.all([
    channels(g),
    segment(g, "area", (row) => `leads in ${row.label}`, "area_comparison"),
    segment(g, "category", (row) => `${row.label} leads`, "category_comparison"),
    segment(g, "campaign", (row) => row.label, "campaign_comparison"),
    scoreCalibration(g),
    objections(g),
    followUps(g),
    periodChange(g),
    stalledDeals(g),
    unopenedQuotes(g),
  ]);
  return results.flat().sort((a, b) => b.weight - a.weight);
}
