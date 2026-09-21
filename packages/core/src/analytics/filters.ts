import { CHANNELS } from "@repo/config";
import { Prisma } from "@repo/db";
import { z } from "zod";

/** Analytics filters shared by every analytics query and endpoint. */
export const analyticsFilterSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  /** Shortcut for the last N days when from/to are not given. */
  days: z.coerce.number().int().min(1).max(730).default(30),
  campaignId: z.uuid().optional(),
  channel: z.enum(CHANNELS).optional(),
  city: z.string().trim().min(1).max(120).optional(),
  industry: z.string().trim().min(1).max(120).optional(),
  source: z.string().trim().min(1).max(60).optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
});
export type AnalyticsFilterInput = z.input<typeof analyticsFilterSchema>;

export interface ResolvedFilters {
  from: Date;
  to: Date;
  previousFrom: Date;
  previousTo: Date;
  days: number;
  campaignId?: string;
  channel?: (typeof CHANNELS)[number];
  city?: string;
  industry?: string;
  source?: string;
  minScore?: number;
}

export function resolveFilters(input: AnalyticsFilterInput = {}): ResolvedFilters {
  const parsed = analyticsFilterSchema.parse(input);
  const to = parsed.to ?? new Date();
  const from = parsed.from ?? new Date(to.getTime() - parsed.days * 86_400_000);
  const span = Math.max(86_400_000, to.getTime() - from.getTime());
  return {
    from,
    to,
    previousFrom: new Date(from.getTime() - span),
    previousTo: from,
    days: Math.round(span / 86_400_000),
    campaignId: parsed.campaignId,
    channel: parsed.channel,
    city: parsed.city,
    industry: parsed.industry,
    source: parsed.source,
    minScore: parsed.minScore,
  };
}

/**
 * SQL predicate for `events e` rows matching the dimension filters. Lead-level filters
 * (city, industry, source, score) join through the lead the event belongs to.
 */
export function eventFilterSql(filters: ResolvedFilters): Prisma.Sql {
  const clauses: Prisma.Sql[] = [];
  if (filters.campaignId) clauses.push(Prisma.sql`e."campaignId" = ${filters.campaignId}::uuid`);
  if (filters.channel) clauses.push(Prisma.sql`e.channel = ${filters.channel}::"Channel"`);
  const leadClauses: Prisma.Sql[] = [];
  if (filters.city) leadClauses.push(Prisma.sql`l.city ILIKE ${filters.city}`);
  if (filters.industry) leadClauses.push(Prisma.sql`l.industry ILIKE ${filters.industry}`);
  if (filters.source) leadClauses.push(Prisma.sql`l."sourceProvider" = ${filters.source}`);
  if (filters.minScore !== undefined) leadClauses.push(Prisma.sql`l.score >= ${filters.minScore}`);
  if (leadClauses.length) {
    clauses.push(Prisma.sql`EXISTS (SELECT 1 FROM leads l WHERE l.id = e."leadId" AND ${Prisma.join(leadClauses, " AND ")})`);
  }
  return clauses.length ? Prisma.sql`AND ${Prisma.join(clauses, " AND ")}` : Prisma.empty;
}

/** Fractional change between periods; null when the previous period had no data. */
export function delta(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / previous;
}

export function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}
