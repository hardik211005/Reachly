import type { AIProviderName } from "@repo/config";
import type { AIProvider } from "../types";
import { AnthropicProvider } from "./anthropic";
import { GoogleProvider } from "./google";
import { MockAIProvider } from "./mock";
import { OpenAIProvider } from "./openai";

export { AnthropicProvider, GoogleProvider, MockAIProvider, OpenAIProvider };

export interface ProviderCredentials {
  apiKey?: string;
  baseUrl?: string;
}

/** Builds a real provider adapter; returns null when credentials are missing. */
export function createProvider(name: Exclude<AIProviderName, "mock">, credentials: ProviderCredentials): AIProvider | null {
  if (!credentials.apiKey) return null;
  switch (name) {
    case "anthropic":
      return new AnthropicProvider(credentials.apiKey);
    case "openai":
      return new OpenAIProvider(credentials.apiKey, credentials.baseUrl);
    case "google":
      return new GoogleProvider(credentials.apiKey, credentials.baseUrl);
  }
}
