import { getEnv } from "@repo/config/env";
import {
  GooglePlacesProvider,
  OpenStreetMapProvider,
  MockEnrichmentProvider,
  MockLeadProvider,
  WebsiteEnrichmentProvider,
  type EnrichmentProvider,
  type LeadDataProvider,
} from "@repo/integrations";
import type { TenantContext } from "../context";
import { ProviderNotConfiguredError } from "../errors";
import { getConnectedIntegration } from "../integrations/credentials";

/**
 * Resolves the lead data source, in order: the workspace's own Google Places key → the
 * platform's Google Places key → OpenStreetMap (real businesses, no key) → generated demo
 * data only when LEAD_PROVIDER=mock (tests and the demo seed).
 */
export async function resolveLeadProvider(ctx: TenantContext): Promise<LeadDataProvider> {
  const env = getEnv();
  const integration = await getConnectedIntegration(ctx, "LEAD_DATA", "google_places");
  if (integration?.credentials.apiKey) return new GooglePlacesProvider(integration.credentials.apiKey);
  if (env.GOOGLE_PLACES_API_KEY && env.LEAD_PROVIDER !== "mock") return new GooglePlacesProvider(env.GOOGLE_PLACES_API_KEY);
  if (env.LEAD_PROVIDER === "mock") {
    if (!env.DEMO_MODE && env.APP_ENV === "production") throw new ProviderNotConfiguredError("lead data");
    return new MockLeadProvider();
  }
  return new OpenStreetMapProvider();
}

/**
 * Enrichment for a lead from a given source. Mock leads are enriched by the mock (their
 * websites are fictional); real leads use public-website enrichment when enabled.
 */
export function resolveEnrichmentProvider(sourceProvider: string): EnrichmentProvider | null {
  if (sourceProvider === "mock") return new MockEnrichmentProvider();
  if (getEnv().ENRICHMENT_WEBSITE_FETCH_ENABLED) return new WebsiteEnrichmentProvider();
  return null;
}
