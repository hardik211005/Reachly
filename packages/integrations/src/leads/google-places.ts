import { getCategory } from "@repo/config/taxonomy";
import { IntegrationError, providerFetch } from "../lib/errors";
import type { LeadDataProvider, LeadSearchCriteria, RawBusiness } from "./types";

/**
 * Google Places API (New) — Text Search.
 * https://developers.google.com/maps/documentation/places/web-service/text-search
 *
 * Compliance: Places content is subject to the Google Maps Platform terms (attribution,
 * caching limits — place IDs may be stored indefinitely, most other fields must be
 * refreshed). Operators must hold an appropriate licence before enabling this provider.
 */

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.addressComponents",
  "places.location",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.priceLevel",
  "places.regularOpeningHours.weekdayDescriptions",
  "places.businessStatus",
  "places.types",
  "places.primaryType",
  "places.googleMapsUri",
  "nextPageToken",
].join(",");

interface PlacesResponse {
  places?: Array<{
    id: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    addressComponents?: Array<{ longText?: string; types?: string[] }>;
    location?: { latitude?: number; longitude?: number };
    nationalPhoneNumber?: string;
    internationalPhoneNumber?: string;
    websiteUri?: string;
    rating?: number;
    userRatingCount?: number;
    priceLevel?: string;
    regularOpeningHours?: { weekdayDescriptions?: string[] };
    businessStatus?: string;
    types?: string[];
    primaryType?: string;
    googleMapsUri?: string;
  }>;
  nextPageToken?: string;
}

const PRICE_LEVELS: Record<string, number> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

function component(components: Array<{ longText?: string; types?: string[] }> | undefined, type: string): string | null {
  return components?.find((item) => item.types?.includes(type))?.longText ?? null;
}

export class GooglePlacesProvider implements LeadDataProvider {
  readonly name = "google_places";
  readonly label = "Google Places";
  readonly isMock = false;

  constructor(private readonly apiKey: string) {}

  private queries(criteria: LeadSearchCriteria): string[] {
    const where = criteria.location?.label ? ` in ${criteria.location.label}` : "";
    const terms = criteria.categories.length
      ? criteria.categories.map((value) => getCategory(value)?.keywords[0] ?? value.replace(/_/g, " "))
      : criteria.keywords.slice(0, 3);
    return (terms.length ? terms : ["business"]).map((term) => `${term}${where}`);
  }

  async search(criteria: LeadSearchCriteria): Promise<RawBusiness[]> {
    const results = new Map<string, RawBusiness>();
    const perQuery = Math.ceil(criteria.limit / Math.max(1, this.queries(criteria).length));

    for (const textQuery of this.queries(criteria)) {
      let pageToken: string | undefined;
      let fetched = 0;
      do {
        const body: Record<string, unknown> = { textQuery, pageSize: Math.min(20, perQuery - fetched) };
        if (pageToken) body.pageToken = pageToken;
        if (criteria.location?.lat !== null && criteria.location?.lat !== undefined && criteria.location.lng !== null) {
          body.locationBias = {
            circle: { center: { latitude: criteria.location.lat, longitude: criteria.location.lng }, radius: Math.min(50_000, criteria.radiusKm * 1000) },
          };
        }
        const response = await providerFetch("google_places", "https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey, "x-goog-fieldmask": FIELD_MASK },
          body: JSON.stringify(body),
        });
        const data = (await response.json()) as PlacesResponse;
        for (const place of data.places ?? []) {
          if (results.has(place.id)) continue;
          results.set(place.id, {
            externalId: place.id,
            name: place.displayName?.text ?? "Unnamed business",
            categories: place.types ?? [],
            primaryCategory: place.primaryType ?? null,
            address: place.formattedAddress ?? null,
            locality: component(place.addressComponents, "sublocality") ?? component(place.addressComponents, "neighborhood"),
            city: component(place.addressComponents, "locality"),
            region: component(place.addressComponents, "administrative_area_level_1"),
            country: component(place.addressComponents, "country"),
            postalCode: component(place.addressComponents, "postal_code"),
            lat: place.location?.latitude ?? null,
            lng: place.location?.longitude ?? null,
            phone: place.internationalPhoneNumber ?? place.nationalPhoneNumber ?? null,
            website: place.websiteUri ?? null,
            email: null,
            rating: place.rating ?? null,
            reviewCount: place.userRatingCount ?? null,
            priceLevel: place.priceLevel ? (PRICE_LEVELS[place.priceLevel] ?? null) : null,
            openingHours: place.regularOpeningHours?.weekdayDescriptions ?? null,
            businessStatus: (place.businessStatus as RawBusiness["businessStatus"]) ?? null,
            sourceUrl: place.googleMapsUri ?? null,
            raw: place as Record<string, unknown>,
          });
        }
        fetched += data.places?.length ?? 0;
        pageToken = data.nextPageToken;
      } while (pageToken && fetched < perQuery && results.size < criteria.limit);
    }

    if (results.size === 0 && !this.apiKey) throw new IntegrationError("google_places", "Missing API key", null, false);
    return [...results.values()].slice(0, criteria.limit);
  }
}
