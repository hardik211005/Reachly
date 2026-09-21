import { getEnv } from "@repo/config/env";
import {
  GooglePlacesProvider,
  MockEnrichmentProvider,
  MockLeadProvider,
  WebsiteEnrichmentProvider,
  type EnrichmentProvider,
  type LeadDataProvider,
} from "@repo/integrations";
import type { TenantContext } from "../context";
import { ProviderNotConfiguredError } from "../errors";
import { getConnectedIntegration } from "../integrations/credentials";

/** Resolves the lead data source: org integration → platform env → mock (demo) → error. */
export async function resolveLeadProvider(ctx: TenantContext): Promise<LeadDataProvider> {
  const env = getEnv();
  const integration = await getConnectedIntegration(ctx, "LEAD_DATA", "google_places");
  if (integration?.credentials.apiKey) return new GooglePlacesProvider(integration.credentials.apiKey);
  if (env.LEAD_PROVIDER === "google_places" && env.GOOGLE_PLACES_API_KEY) return new GooglePlacesProvider(env.GOOGLE_PLACES_API_KEY);
  if (env.DEMO_MODE || env.LEAD_PROVIDER === "mock") return new MockLeadProvider();
  throw new ProviderNotConfiguredError("lead data");
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
