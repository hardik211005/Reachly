/** Lead data provider contracts. Providers return raw businesses; core normalises them. */

export interface LeadSearchLocation {
  label: string;
  city: string | null;
  lat: number | null;
  lng: number | null;
  /** Named neighbourhoods to focus on (e.g. the localities of "South Delhi"). */
  localities?: string[];
}

export interface LeadSearchCriteria {
  /** Canonical category keys (see @repo/config/taxonomy) or free-text categories. */
  categories: string[];
  keywords: string[];
  location: LeadSearchLocation | null;
  radiusKm: number;
  limit: number;
  requireWebsite?: boolean;
  requirePhone?: boolean;
}

export type BusinessStatus = "OPERATIONAL" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY";

export interface RawBusiness {
  /** Provider's stable id (e.g. Google place id). */
  externalId: string;
  name: string;
  categories: string[];
  primaryCategory: string | null;
  address: string | null;
  locality: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  postalCode: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  website: string | null;
  email: string | null;
  rating: number | null;
  reviewCount: number | null;
  priceLevel: number | null;
  openingHours: string[] | null;
  businessStatus: BusinessStatus | null;
  sourceUrl: string | null;
  /** Untouched provider payload, stored for provenance. */
  raw: Record<string, unknown>;
}

export interface LeadDataProvider {
  readonly name: string;
  readonly label: string;
  readonly isMock: boolean;
  search(criteria: LeadSearchCriteria): Promise<RawBusiness[]>;
}

// ----------------------------------------------------------------------------- Enrichment

export interface EnrichmentInput {
  name: string;
  website: string | null;
  domain: string | null;
  city: string | null;
  category: string | null;
  phone: string | null;
  email: string | null;
  sourceProvider: string;
  raw: Record<string, unknown>;
}

export interface EnrichedContact {
  name: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  source: string;
}

export interface EnrichmentResult {
  emails: Array<{ value: string; source: string }>;
  phones: Array<{ value: string; source: string }>;
  socialProfiles: Record<string, string>;
  description: string | null;
  services: string[];
  /** Signal keys with human-readable evidence (validated against the catalogue in core). */
  signals: Array<{ key: string; evidence: string; weight: number; source: string }>;
  website: { reachable: boolean; https: boolean; hasOrdering: boolean; hasBooking: boolean; title: string | null } | null;
  contacts: EnrichedContact[];
  locationsCount: number | null;
  employeeRange: string | null;
}

export interface EnrichmentProvider {
  readonly name: string;
  readonly isMock: boolean;
  enrich(input: EnrichmentInput): Promise<EnrichmentResult>;
}

export function emptyEnrichment(): EnrichmentResult {
  return { emails: [], phones: [], socialProfiles: {}, description: null, services: [], signals: [], website: null, contacts: [], locationsCount: null, employeeRange: null };
}
