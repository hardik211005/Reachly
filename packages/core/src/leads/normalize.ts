import { getCategory, matchCategory } from "@repo/config/taxonomy";
import type { RawBusiness } from "@repo/integrations";
import { slugify } from "../shared/text";

/**
 * Normalisation + deduplication.
 * Every lead gets a deterministic `dedupeKey` (unique per organisation):
 *   domain:<registrable host>  →  phone:<E.164>  →  name:<slug>|<city slug>
 * so the same business found by two providers, two searches or a CSV import collapses
 * into one lead with multiple LeadSource rows.
 */

const COUNTRY_CALLING_CODES: Record<string, string> = {
  india: "91",
  "united kingdom": "44",
  uk: "44",
  "united states": "1",
  usa: "1",
  "united arab emirates": "971",
  uae: "971",
  singapore: "65",
};

export function normalizeDomain(website: string | null | undefined): string | null {
  if (!website) return null;
  try {
    const url = new URL(website.startsWith("http") ? website : `https://${website}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

export function normalizeWebsite(website: string | null | undefined): string | null {
  if (!website) return null;
  try {
    const url = new URL(website.startsWith("http") ? website : `https://${website}`);
    return `${url.protocol}//${url.hostname.toLowerCase()}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return null;
  }
}

/** Best-effort E.164. Assumes the business's country when the number has no country code. */
export function normalizePhone(phone: string | null | undefined, country?: string | null): string | null {
  if (!phone) return null;
  const hasPlus = phone.trim().startsWith("+");
  let digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return null;
  if (hasPlus) return `+${digits}`;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  const code = COUNTRY_CALLING_CODES[(country ?? "india").toLowerCase()] ?? "91";
  if (digits.startsWith("0")) digits = digits.replace(/^0+/, "");
  if (digits.startsWith(code) && digits.length > 10) return `+${digits}`;
  return `+${code}${digits}`;
}

export function normalizeEmail(email: string | null | undefined): string | null {
  const value = email?.trim().toLowerCase();
  return value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}

export function normalizeName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

export function dedupeKeyFor(input: { website?: string | null; phone?: string | null; name: string; city?: string | null; country?: string | null }): string {
  const domain = normalizeDomain(input.website);
  if (domain) return `domain:${domain}`;
  const phone = normalizePhone(input.phone, input.country);
  if (phone) return `phone:${phone}`;
  return `name:${slugify(input.name, 80)}|${slugify(input.city ?? "unknown", 40)}`;
}

export interface LeadCandidate {
  name: string;
  dedupeKey: string;
  category: string | null;
  industry: string | null;
  website: string | null;
  domain: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  locality: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  rating: number | null;
  reviewCount: number | null;
  priceLevel: number | null;
  openingHours: string[] | null;
  closed: boolean;
  externalId: string;
  sourceUrl: string | null;
  raw: Record<string, unknown>;
}

/** Maps a provider record to our lead shape, resolving the category to the taxonomy. */
export function normalizeRawBusiness(business: RawBusiness): LeadCandidate {
  const category =
    getCategory(business.primaryCategory ?? "") ??
    matchCategory([business.primaryCategory, ...business.categories].filter(Boolean).join(" ").replace(/_/g, " "));
  const website = normalizeWebsite(business.website);
  return {
    name: normalizeName(business.name),
    dedupeKey: dedupeKeyFor({ website, phone: business.phone, name: business.name, city: business.city, country: business.country }),
    category: category?.key ?? business.primaryCategory ?? null,
    industry: category?.industry ?? null,
    website,
    domain: normalizeDomain(website),
    phone: normalizePhone(business.phone, business.country),
    email: normalizeEmail(business.email),
    address: business.address,
    locality: business.locality,
    city: business.city,
    region: business.region,
    country: business.country,
    postalCode: business.postalCode,
    latitude: business.lat,
    longitude: business.lng,
    rating: business.rating,
    reviewCount: business.reviewCount,
    priceLevel: business.priceLevel,
    openingHours: business.openingHours,
    closed: business.businessStatus === "CLOSED_PERMANENTLY",
    externalId: business.externalId,
    sourceUrl: business.sourceUrl,
    raw: business.raw,
  };
}
