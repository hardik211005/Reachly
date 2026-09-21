import { createHash } from "node:crypto";
import { CITIES, getCategory, haversineKm, matchCategory, matchCity, type CategoryDefinition, type CityDefinition, type Locality } from "@repo/config/taxonomy";
import { emptyEnrichment, type EnrichmentInput, type EnrichmentProvider, type EnrichmentResult, type LeadDataProvider, type LeadSearchCriteria, type RawBusiness } from "./types";

/**
 * Deterministic mock lead source for demo mode.
 *
 * The same criteria always produce the same fictional businesses, so demos and tests are
 * reproducible. Websites and emails use the reserved `.example` TLD and every record is
 * tagged `simulated`, so mock data can never be mistaken for — or reach — a real business.
 */

function seededRandom(seed: string): () => number {
  let state = createHash("sha256").update(seed).digest().readUInt32LE(0);
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length)] as T;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const FIRST_NAMES = ["Aditi", "Rohan", "Kavya", "Arjun", "Meera", "Vikram", "Ananya", "Karan", "Isha", "Nikhil", "Priya", "Siddharth", "Tanya", "Rahul", "Neha", "Aman"];
const LAST_NAMES = ["Sharma", "Kapoor", "Mehra", "Bhatia", "Malhotra", "Gupta", "Arora", "Khanna", "Sethi", "Chopra", "Verma", "Singh", "Jain", "Bansal"];
const TITLES = ["Founder", "Co-founder", "Owner", "Operations Manager", "Marketing Manager", "General Manager"];
const STREETS = ["Main Market", "Block M", "Central Avenue", "Shopping Complex", "Sector Road", "High Street", "Commercial Plaza"];

interface MockTraits {
  locations: number;
  takeaway: boolean;
  instagram: string | null;
  facebook: string | null;
  linkedin: string | null;
  contactName: string | null;
  contactTitle: string | null;
  email: string | null;
  hiring: boolean;
  openedRecently: boolean;
  onlineOrdering: boolean;
  booking: boolean;
  https: boolean;
  employees: string;
}

function localitiesFor(city: CityDefinition, criteria: LeadSearchCriteria): Locality[] {
  const named = criteria.location?.localities?.length
    ? city.localities.filter((locality) => criteria.location?.localities?.includes(locality.name))
    : city.localities;
  const center = criteria.location?.lat !== null && criteria.location?.lat !== undefined && criteria.location.lng !== null
    ? { lat: criteria.location.lat, lng: criteria.location.lng }
    : null;
  const inRadius = center ? named.filter((locality) => haversineKm(center, locality) <= Math.max(3, criteria.radiusKm)) : named;
  return inRadius.length ? inRadius : named.length ? named : city.localities;
}

function genericCity(label: string): CityDefinition {
  return {
    key: slug(label),
    name: label,
    region: label,
    country: "India",
    aliases: [label.toLowerCase()],
    lat: 0,
    lng: 0,
    phonePrefix: "+91 90",
    localities: ["Central", "Old Town", "North", "South", "Market Area"].map((name) => ({ name: `${label} ${name}`, lat: 0, lng: 0 })),
  };
}

function resolveCategories(criteria: LeadSearchCriteria): Array<{ category: CategoryDefinition | null; label: string }> {
  const resolved = criteria.categories.map((value) => {
    const category = getCategory(value) ?? matchCategory(value) ?? null;
    return { category, label: category?.label ?? value };
  });
  return resolved.length ? resolved : [{ category: getCategory("corporate_office") ?? null, label: "Business" }];
}

export class MockLeadProvider implements LeadDataProvider {
  readonly name = "mock";
  readonly label = "Demo data (simulated)";
  readonly isMock = true;

  async search(criteria: LeadSearchCriteria): Promise<RawBusiness[]> {
    const city =
      (criteria.location?.city ? matchCity(criteria.location.city) : undefined) ??
      (criteria.location?.label ? matchCity(criteria.location.label) : undefined) ??
      (criteria.location ? genericCity(criteria.location.city ?? criteria.location.label) : (CITIES[0] as CityDefinition));
    const localities = localitiesFor(city, criteria);
    const categories = resolveCategories(criteria);
    const results: RawBusiness[] = [];
    const usedNames = new Set<string>();
    const perCategory = Math.ceil(criteria.limit / categories.length);

    for (const { category, label } of categories) {
      const random = seededRandom(`${city.key}|${label}|${localities.map((l) => l.name).join(",")}`);
      // Real search results thin out: fewer businesses match narrow areas.
      const available = Math.min(perCategory, 10 + localities.length * 9);
      for (let index = 0; index < available * 3 && results.length < criteria.limit; index += 1) {
        const prefix = pick(category?.namePrefixes ?? ["Prime", "Metro", "City", "Urban"], random);
        const suffix = pick(category?.nameSuffixes ?? [label], random);
        const name = `${prefix} ${suffix}`;
        if (usedNames.has(name)) continue;
        usedNames.add(name);
        const business = this.generate(name, category, label, city, localities, random);
        if (criteria.requireWebsite && !business.website) continue;
        if (criteria.requirePhone && !business.phone) continue;
        results.push(business);
        if (results.filter((item) => item.primaryCategory === (category?.key ?? label)).length >= available) break;
      }
    }
    return results;
  }

  private generate(
    name: string,
    category: CategoryDefinition | null,
    label: string,
    city: CityDefinition,
    localities: Locality[],
    random: () => number,
  ): RawBusiness {
    const locality = pick(localities, random);
    const [minLocations, maxLocations] = category?.locationsRange ?? [1, 3];
    const locations = random() < 0.55 ? 1 : Math.max(1, Math.round(minLocations + random() ** 2 * (maxLocations - minLocations)));
    const hasWebsite = random() < (category?.websiteRate ?? 0.6);
    const domain = `${slug(name)}.example`;
    const contactName = random() < 0.6 ? `${pick(FIRST_NAMES, random)} ${pick(LAST_NAMES, random)}` : null;
    const reviewCount = Math.round(Math.exp(2.5 + random() * 4.2));
    const traits: MockTraits = {
      locations,
      takeaway: ["cafe", "restaurant", "cloud_kitchen", "bakery"].includes(category?.key ?? "") ? random() < 0.8 : random() < 0.2,
      instagram: random() < 0.7 ? `@${slug(name).replace(/-/g, "")}` : null,
      facebook: random() < 0.4 ? slug(name) : null,
      linkedin: ["startup", "corporate_office", "agency", "manufacturer", "d2c_brand"].includes(category?.key ?? "") && random() < 0.8 ? slug(name) : null,
      contactName,
      contactTitle: contactName ? pick(TITLES, random) : null,
      email: hasWebsite && random() < 0.85 ? `${pick(["hello", "info", "contact", "team"], random)}@${domain}` : null,
      hiring: random() < 0.22,
      openedRecently: random() < 0.15,
      onlineOrdering: hasWebsite && random() < 0.4,
      booking: hasWebsite && random() < 0.3,
      https: hasWebsite && random() < 0.85,
      employees: pick(["1–10", "11–50", "11–50", "51–200"], random),
    };
    const digits = String(Math.floor(random() * 9_000_000) + 1_000_000);
    const lat = locality.lat ? locality.lat + (random() - 0.5) * 0.012 : null;
    const lng = locality.lng ? locality.lng + (random() - 0.5) * 0.012 : null;
    const externalId = `mock_${createHash("sha1").update(`${city.key}|${name}`).digest("hex").slice(0, 16)}`;

    return {
      externalId,
      name,
      categories: [category?.key ?? slug(label), ...(traits.takeaway ? ["takeaway"] : [])],
      primaryCategory: category?.key ?? label,
      address: `${Math.floor(random() * 90) + 1}, ${pick(STREETS, random)}, ${locality.name}`,
      locality: locality.name,
      city: city.name,
      region: city.region,
      country: city.country,
      postalCode: locality.postalCode ?? null,
      lat,
      lng,
      phone: random() < 0.9 ? `${city.phonePrefix}${digits.slice(0, 3)} ${digits.slice(3)}` : null,
      website: hasWebsite ? `${traits.https ? "https" : "http"}://${domain}` : null,
      email: null,
      rating: Math.round((3.6 + random() * 1.3) * 10) / 10,
      reviewCount,
      priceLevel: Math.ceil(random() * 3),
      openingHours: ["Mon–Sun 08:00–23:00"],
      businessStatus: random() < 0.03 ? "CLOSED_TEMPORARILY" : "OPERATIONAL",
      sourceUrl: null,
      raw: { simulated: true, provider: "mock", traits, generatedFor: { city: city.name, locality: locality.name, category: label } },
    };
  }
}

/** Reads the fictional business's traits back, as if its website had been analysed. */
export class MockEnrichmentProvider implements EnrichmentProvider {
  readonly name = "mock";
  readonly isMock = true;

  async enrich(input: EnrichmentInput): Promise<EnrichmentResult> {
    const result = emptyEnrichment();
    const traits = (input.raw.traits ?? null) as MockTraits | null;
    if (!traits) return result;
    const source = "mock-website";
    if (traits.email) result.emails.push({ value: traits.email, source });
    if (traits.instagram) result.socialProfiles.instagram = `https://instagram.com/${traits.instagram.slice(1)}`;
    if (traits.facebook) result.socialProfiles.facebook = `https://facebook.com/${traits.facebook}`;
    if (traits.linkedin) result.socialProfiles.linkedin = `https://linkedin.com/company/${traits.linkedin}`;
    if (traits.contactName) {
      result.contacts.push({ name: traits.contactName, title: traits.contactTitle, email: traits.email, phone: null, source });
    }
    result.locationsCount = traits.locations;
    result.employeeRange = traits.employees;
    result.website = input.website
      ? { reachable: true, https: traits.https, hasOrdering: traits.onlineOrdering, hasBooking: traits.booking, title: input.name }
      : null;
    const category = input.category ? getCategory(input.category) : undefined;
    result.services = category?.offerings.slice(0, 3) ?? [];
    result.description = category ? `${category.label} in ${input.city ?? "the area"} offering ${result.services.join(", ").toLowerCase()}.` : null;

    if (traits.locations > 1) result.signals.push({ key: "multiple_locations", evidence: `${traits.locations} outlets listed`, weight: Math.min(1, 0.5 + traits.locations * 0.1), source });
    if (traits.takeaway) result.signals.push({ key: "takeaway_delivery", evidence: "Offers takeaway and delivery", weight: 0.8, source });
    if (traits.hiring) result.signals.push({ key: "hiring", evidence: "Careers page lists open roles", weight: 0.7, source });
    if (traits.openedRecently) result.signals.push({ key: "new_opening", evidence: "Opened within the last year", weight: 0.7, source });
    if (!input.website) result.signals.push({ key: "no_website", evidence: "No website listed", weight: 0.9, source });
    else if (!traits.https || (!traits.onlineOrdering && !traits.booking)) {
      result.signals.push({ key: "weak_website", evidence: !traits.https ? "Website has no HTTPS" : "No online ordering or booking on website", weight: 0.6, source });
    }
    if (!traits.instagram && !traits.facebook) result.signals.push({ key: "no_social_presence", evidence: "No social profiles found", weight: 0.8, source });
    else result.signals.push({ key: "active_social", evidence: `Instagram ${traits.instagram ?? "—"}`, weight: 0.5, source });
    if (input.website && !traits.onlineOrdering && ["cafe", "restaurant", "bakery", "cloud_kitchen"].includes(input.category ?? "")) {
      result.signals.push({ key: "no_online_ordering", evidence: "No direct online ordering", weight: 0.6, source });
    }
    return result;
  }
}
