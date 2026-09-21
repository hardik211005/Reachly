import { getEnv } from "@repo/config/env";
import { MockVoiceProvider, TwilioVoiceProvider, VapiVoiceProvider, type VoiceProvider } from "@repo/integrations";
import type { TenantContext } from "../context";
import { ProviderNotConfiguredError } from "../errors";
import { getConnectedIntegration } from "../integrations/credentials";

/**
 * Voice provider per organisation:
 * connected integration → platform env → mock (DEMO_MODE only) → ProviderNotConfiguredError.
 */

type GlobalWithMock = typeof globalThis & { __reachMockVoice?: MockVoiceProvider };

function mockVoice(): MockVoiceProvider {
  const g = globalThis as GlobalWithMock;
  g.__reachMockVoice ??= new MockVoiceProvider();
  return g.__reachMockVoice;
}

export async function resolveVoiceProvider(ctx: TenantContext): Promise<VoiceProvider> {
  const env = getEnv();
  const integration = await getConnectedIntegration(ctx, "VOICE");
  if (integration?.provider === "vapi" && integration.credentials.apiKey && integration.config.phoneNumberId) {
    return new VapiVoiceProvider({ apiKey: integration.credentials.apiKey, phoneNumberId: String(integration.config.phoneNumberId), webhookSecret: integration.credentials.webhookSecret });
  }
  if (integration?.provider === "twilio" && integration.credentials.accountSid && integration.credentials.authToken && integration.config.fromNumber) {
    return new TwilioVoiceProvider({ accountSid: integration.credentials.accountSid, authToken: integration.credentials.authToken, fromNumber: String(integration.config.fromNumber) });
  }
  if (env.VOICE_PROVIDER === "vapi" && env.VAPI_API_KEY && env.VAPI_PHONE_NUMBER_ID) {
    return new VapiVoiceProvider({ apiKey: env.VAPI_API_KEY, phoneNumberId: env.VAPI_PHONE_NUMBER_ID, webhookSecret: env.VAPI_WEBHOOK_SECRET });
  }
  if (env.VOICE_PROVIDER === "twilio" && env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER) {
    return new TwilioVoiceProvider({ accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN, fromNumber: env.TWILIO_FROM_NUMBER });
  }
  if (env.DEMO_MODE) return mockVoice();
  throw new ProviderNotConfiguredError("voice");
}

export async function voiceAvailability(ctx: TenantContext) {
  return resolveVoiceProvider(ctx)
    .then((provider) => ({ ok: true as const, provider: provider.name, simulated: provider.isMock, hostedAgent: provider.capabilities.hostedAgent }))
    .catch(() => ({ ok: false as const, provider: null, simulated: false, hostedAgent: false }));
}
