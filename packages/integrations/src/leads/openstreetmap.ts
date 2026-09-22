import { getCategory } from "@repo/config/taxonomy";
import { IntegrationError, providerFetch } from "../lib/errors";
import type { LeadDataProvider, LeadSearchCriteria, RawBusiness } from "./types";

/**
 * OpenStreetMap — real businesses from open map data, no API key needed.
 *
 *  - Places are geocoded with Nominatim (https://nominatim.org/release-docs/latest/api/Search/).
 *  - Fast pass: Nominatim place search for each business type, bounded to the search radius.
 *  - Deep pass: the Overpass API (https://wiki.openstreetmap.org/wiki/Overpass_API) returns
 *    every tagged business in the radius when a mirror answers within the time budget.
 *
 * Data © OpenStreetMap contributors, available under the Open Database Licence (ODbL);
 * leads keep a link to their OSM object. Both public services ask for light use and an
 * identifying User-Agent: Nominatim requests are spaced over a second apart, geocodes are
 * cached, and each search is one Overpass query.
 */

const USER_AGENT = "Reachly/1.0 (lead discovery; https://reachai.dev)";
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
// Public Overpass instances are often busy; mirrors are tried in turn within a time budget.
const OVERPASS = ["https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass-api.de/api/interpreter"];
/** How long a search may wait for Overpass before returning what Nominatim found. */
const OVERPASS_BUDGET_MS = 30_000;
const NOMINATIM_GAP_MS = 1_100;

/** OSM tag filters per taxonomy category. Each entry becomes `nwr[key=value]` or `nwr[key~regex]`. */
const CATEGORY_TAGS: Record<string, Array<[string, string]>> = {
  cafe: [["amenity", "cafe"]],
  restaurant: [["amenity", "restaurant"], ["amenity", "fast_food"], ["amenity", "food_court"]],
  cloud_kitchen: [["amenity", "restaurant"], ["amenity", "fast_food"]],
  bakery: [["shop", "bakery"], ["shop", "pastry"], ["shop", "confectionery"]],
  hotel: [["tourism", "hotel"], ["tourism", "guest_house"], ["tourism", "motel"]],
  event_venue: [["amenity", "events_venue"], ["amenity", "conference_centre"], ["amenity", "community_centre"]],
  wedding_planner: [["shop", "wedding"], ["office", "event_management"], ["craft", "event"]],
  salon: [["shop", "hairdresser"], ["shop", "beauty"], ["leisure", "spa"]],
  gym: [["leisure", "fitness_centre"], ["leisure", "sports_centre"]],
  clinic: [["amenity", "clinic"], ["amenity", "doctors"], ["amenity", "dentist"], ["healthcare", "clinic"]],
  retail_store: [["shop", "clothes"], ["shop", "shoes"], ["shop", "electronics"], ["shop", "gift"], ["shop", "department_store"], ["shop", "furniture"]],
  d2c_brand: [["shop", "clothes"], ["shop", "cosmetics"], ["shop", "boutique"], ["office", "company"]],
  startup: [["office", "company"], ["office", "it"], ["amenity", "coworking_space"], ["office", "coworking"]],
  real_estate: [["office", "estate_agent"], ["office", "property_management"]],
  school: [["amenity", "school"], ["amenity", "college"], ["amenity", "kindergarten"], ["amenity", "language_school"], ["amenity", "training"]],
  manufacturer: [["man_made", "works"], ["industrial", "factory"], ["craft", "manufacturer"], ["landuse", "industrial"]],
  agency: [["office", "advertising_agency"], ["office", "marketing"], ["office", "consulting"], ["office", "company"]],
  corporate_office: [["office", "company"], ["office", "corporate"], ["office", "financial"], ["office", "insurance"]],
};

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

type Point = { lat: number; lng: number; city: string | null; region: string | null; country: string | null };

const geocodeCache = new Map<string, Point | null>();

async function geocode(label: string): Promise<Point | null> {
  const key = label.trim().toLowerCase();
  if (geocodeCache.has(key)) return geocodeCache.get(key) ?? null;
  const url = `${NOMINATIM}?format=jsonv2&limit=1&addressdetails=1&q=${encodeURIComponent(label)}`;
  const response = await providerFetch("openstreetmap", url, { headers: { "user-agent": USER_AGENT, accept: "application/json" }, timeoutMs: 12_000 });
  const results = (await response.json()) as Array<{ lat: string; lon: string; address?: Record<string, string> }>;
  const first = results[0];
  const point = first
    ? {
        lat: Number(first.lat),
        lng: Number(first.lon),
        city: first.address?.city ?? first.address?.town ?? first.address?.village ?? first.address?.state_district ?? null,
        region: first.address?.state ?? null,
        country: first.address?.country ?? null,
      }
    : null;
  geocodeCache.set(key, point);
  return point;
}

/** Letters, digits, spaces and a little punctuation only — safe inside an Overpass regex string. */
function escapeRegex(value: string) {
  return value.replace(/[^\p{L}\p{N} &'-]/gu, "").trim();
}

/** Builds the Overpass QL query for the categories (or keywords) around a point. */
export function buildOverpassQuery(criteria: Pick<LeadSearchCriteria, "categories" | "keywords">, point: { lat: number; lng: number }, radiusMeters: number, limit: number): string {
  const around = `(around:${Math.round(radiusMeters)},${point.lat.toFixed(5)},${point.lng.toFixed(5)})`;
  const filters = new Set<string>();
  for (const category of criteria.categories) {
    const tags = CATEGORY_TAGS[category];
    if (tags) {
      for (const [key, value] of tags) filters.add(`nwr["${key}"="${value}"]["name"]${around};`);
      continue;
    }
    // Free-text category: match the business name or its shop/amenity/office type.
    const term = escapeRegex((getCategory(category)?.keywords[0] ?? category).replace(/_/g, " ").toLowerCase());
    filters.add(`nwr["name"~"${term}",i]${around};`);
    filters.add(`nwr["shop"~"${term}",i]["name"]${around};`);
    filters.add(`nwr["amenity"~"${term}",i]["name"]${around};`);
    filters.add(`nwr["office"~"${term}",i]["name"]${around};`);
  }
  if (!filters.size) {
    for (const keyword of criteria.keywords.slice(0, 3)) {
      const term = escapeRegex(keyword.toLowerCase());
      filters.add(`nwr["name"~"${term}",i]["shop"]${around};`);
      filters.add(`nwr["name"~"${term}",i]["amenity"]${around};`);
      filters.add(`nwr["name"~"${term}",i]["office"]${around};`);
    }
  }
  // Ask for more than needed: unnamed and duplicate branches are dropped afterwards.
  return `[out:json][timeout:25];(${[...filters].join("")});out center tags ${Math.min(500, Math.max(60, limit * 3))};`;
}

function first(tags: Record<string, string>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = tags[key]?.trim();
    if (value) return value.split(";")[0]!.trim();
  }
  return null;
}

function normaliseWebsite(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || /^(mailto|tel):/i.test(trimmed)) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** Maps an Overpass element to a RawBusiness (null for unnamed or unlocated elements). */
export function toRawBusiness(element: OverpassElement, fallback: Point | null): RawBusiness | null {
  const tags = element.tags ?? {};
  const name = tags.name?.trim() || tags["name:en"]?.trim();
  const lat = element.lat ?? element.center?.lat ?? null;
  const lng = element.lon ?? element.center?.lon ?? null;
  if (!name || lat === null || lng === null) return null;
  const categories = [tags.amenity, tags.shop, tags.office, tags.tourism, tags.leisure, tags.craft, tags.healthcare, tags.cuisine].filter((value): value is string => Boolean(value)).flatMap((value) => value.split(";").map((part) => part.trim()));
  const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
  const locality = first(tags, "addr:suburb", "addr:neighbourhood", "addr:quarter", "addr:place");
  const city = first(tags, "addr:city", "addr:district") ?? fallback?.city ?? null;
  const address = [street || null, locality, city, first(tags, "addr:postcode")].filter(Boolean).join(", ") || null;
  const closed = tags.disused === "yes" || tags["disused:shop"] || tags["disused:amenity"] || tags.abandoned === "yes";
  return {
    externalId: `osm:${element.type}/${element.id}`,
    name,
    categories,
    primaryCategory: categories[0] ?? null,
    address,
    locality,
    city,
    region: first(tags, "addr:state") ?? fallback?.region ?? null,
    country: first(tags, "addr:country") ?? fallback?.country ?? null,
    postalCode: first(tags, "addr:postcode"),
    lat,
    lng,
    phone: first(tags, "contact:phone", "phone", "contact:mobile", "mobile"),
    website: normaliseWebsite(first(tags, "contact:website", "website", "url")),
    email: first(tags, "contact:email", "email"),
    rating: null,
    reviewCount: null,
    priceLevel: null,
    openingHours: tags.opening_hours ? [tags.opening_hours] : null,
    businessStatus: closed ? "CLOSED_PERMANENTLY" : "OPERATIONAL",
    sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
    raw: { type: element.type, id: element.id, tags },
  };
}

/** Businesses with a way to reach them come first; then those with more detail. */
function completeness(business: RawBusiness): number {
  return (business.website ? 3 : 0) + (business.phone ? 3 : 0) + (business.email ? 2 : 0) + (business.address ? 1 : 0) + (business.openingHours ? 1 : 0);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Map entries named only after their type ("Bakery", "Cafe") aren't useful leads. */
export const GENERIC_NAME = /^(the\s+)?(bakery|cafe|café|coffee shop|restaurant|dhaba|hotel|shop|store|salon|beauty parlou?r|gym|clinic|school|office|pharmacy|medical store|kirana store|general store)s?$/i;

interface NominatimPlace {
  osm_type: "node" | "way" | "relation";
  osm_id: number;
  lat: string;
  lon: string;
  name?: string;
  category?: string;
  type?: string;
  address?: Record<string, string>;
  extratags?: Record<string, string> | null;
}

/** Reshapes a Nominatim result into OSM-style tags so both sources share one mapper. */
export function nominatimToElement(place: NominatimPlace): OverpassElement {
  const address = place.address ?? {};
  const tags: Record<string, string> = { ...(place.extratags ?? {}) };
  if (place.name) tags.name = place.name;
  if (place.category && place.type) tags[place.category] = place.type;
  const pairs: Array<[string, string | undefined]> = [
    ["addr:housenumber", address.house_number],
    ["addr:street", address.road],
    ["addr:suburb", address.suburb ?? address.neighbourhood ?? address.quarter],
    ["addr:city", address.city ?? address.town ?? address.village ?? address.city_district],
    ["addr:postcode", address.postcode],
    ["addr:state", address.state],
    ["addr:country", address.country],
  ];
  for (const [key, value] of pairs) if (value && !tags[key]) tags[key] = value;
  return { type: place.osm_type, id: place.osm_id, lat: Number(place.lat), lon: Number(place.lon), tags };
}

/** The search terms Nominatim understands ("cafe", "fast food", "hairdresser"…) for the criteria. */
function nominatimTerms(criteria: Pick<LeadSearchCriteria, "categories" | "keywords">): string[] {
  const terms = new Set<string>();
  for (const category of criteria.categories) {
    const tags = CATEGORY_TAGS[category];
    if (tags) for (const [, value] of tags) terms.add(value.replace(/_/g, " "));
    else terms.add(escapeRegex((getCategory(category)?.keywords[0] ?? category).replace(/_/g, " ")));
  }
  if (!terms.size) for (const keyword of criteria.keywords.slice(0, 3)) terms.add(escapeRegex(keyword));
  return [...terms].filter(Boolean).slice(0, 4);
}

/** A lon/lat box around the point (Nominatim's viewbox order: left, top, right, bottom). */
function viewbox(point: { lat: number; lng: number }, radiusMeters: number): string {
  const dLat = radiusMeters / 111_320;
  const dLng = radiusMeters / (111_320 * Math.max(0.2, Math.cos((point.lat * Math.PI) / 180)));
  return [point.lng - dLng, point.lat + dLat, point.lng + dLng, point.lat - dLat].map((value) => value.toFixed(5)).join(",");
}

export class OpenStreetMapProvider implements LeadDataProvider {
  readonly name = "openstreetmap";
  readonly label = "OpenStreetMap";
  readonly isMock = false;

  /** Fast pass: Nominatim place search bounded to the radius, one term at a time (≤ 1 request a second). */
  private async searchNominatim(criteria: LeadSearchCriteria, point: Point, radiusMeters: number): Promise<OverpassElement[]> {
    const elements: OverpassElement[] = [];
    const box = viewbox(point, radiusMeters);
    for (const [index, term] of nominatimTerms(criteria).entries()) {
      if (index > 0) await sleep(NOMINATIM_GAP_MS);
      const url = `${NOMINATIM}?format=jsonv2&limit=40&extratags=1&addressdetails=1&bounded=1&viewbox=${box}&q=${encodeURIComponent(term)}`;
      const response = await providerFetch("openstreetmap", url, { headers: { "user-agent": USER_AGENT, accept: "application/json" }, timeoutMs: 15_000 });
      const places = (await response.json()) as NominatimPlace[];
      elements.push(...places.map(nominatimToElement));
    }
    return elements;
  }

  /** Deep pass: every tagged business in the radius, when an Overpass mirror answers before the deadline. */
  private async searchOverpass(criteria: LeadSearchCriteria, point: Point, radiusMeters: number, deadline: number): Promise<OverpassElement[] | null> {
    const query = buildOverpassQuery(criteria, point, radiusMeters, criteria.limit);
    for (const endpoint of OVERPASS) {
      const remaining = deadline - Date.now();
      if (remaining < 3_000) return null;
      try {
        const response = await providerFetch("openstreetmap", endpoint, {
          method: "POST",
          headers: { "user-agent": USER_AGENT, "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
          body: `data=${encodeURIComponent(query)}`,
          timeoutMs: remaining,
        });
        const data = (await response.json()) as { elements?: OverpassElement[]; remark?: string };
        // A server-side timeout still answers 200, with a remark and no elements.
        if (data.remark && !data.elements?.length) continue;
        return data.elements ?? [];
      } catch {
        // Try the next mirror.
      }
    }
    return null;
  }

  async search(criteria: LeadSearchCriteria): Promise<RawBusiness[]> {
    const location = criteria.location;
    if (!location) throw new IntegrationError("openstreetmap", "Add a place to search — for example “cafés in Pune”.", 400, false);
    // Named areas ("South Delhi") are geocoded as written; otherwise use the known city centre.
    const geocoded = location.localities?.length || location.lat === null || location.lng === null ? await geocode(location.label).catch(() => null) : null;
    const point: Point | null = geocoded ?? (location.lat !== null && location.lng !== null ? { lat: location.lat, lng: location.lng, city: location.city, region: null, country: null } : null);
    if (!point) throw new IntegrationError("openstreetmap", `Couldn't find “${location.label}” on the map. Try a city or neighbourhood name.`, 400, false);

    const radius = Math.min(50, Math.max(1, criteria.radiusKm)) * 1000;
    const deadline = Date.now() + OVERPASS_BUDGET_MS;
    const deep = this.searchOverpass(criteria, point, radius, deadline);
    const fast = await this.searchNominatim(criteria, point, radius).catch(() => [] as OverpassElement[]);
    // With plenty from the fast pass, don't hold the search for long.
    const waitFor = fast.length >= criteria.limit ? Math.min(8_000, deadline - Date.now()) : deadline - Date.now();
    const deepElements = await Promise.race([deep, sleep(Math.max(0, waitFor)).then(() => null)]);
    if (!fast.length && deepElements === null) throw new IntegrationError("openstreetmap", "The map service is busy. Try again in a minute.", 503, true);

    const seen = new Set<string>();
    const businesses: RawBusiness[] = [];
    // Overpass first: it carries the fullest tags.
    for (const element of [...(deepElements ?? []), ...fast]) {
      const business = toRawBusiness(element, point);
      if (!business || GENERIC_NAME.test(business.name.trim())) continue;
      // The same place from both sources, and chain branches on one street, collapse to one.
      const key = `${business.name.toLowerCase()}|${(business.address ?? `${business.lat?.toFixed(3)},${business.lng?.toFixed(3)}`).toLowerCase()}`;
      if (seen.has(business.externalId) || seen.has(key)) continue;
      seen.add(business.externalId);
      seen.add(key);
      if (criteria.requireWebsite && !business.website) continue;
      if (criteria.requirePhone && !business.phone) continue;
      businesses.push(business);
    }
    return businesses.sort((a, b) => completeness(b) - completeness(a)).slice(0, criteria.limit);
  }
}
