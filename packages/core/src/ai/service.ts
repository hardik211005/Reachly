import {
  AIProviderError,
  MockAIProvider,
  createProvider,
  toStrictJsonSchema,
  type AIGenerateRequest,
  type AIGenerateResult,
  type AIMessage,
  type AIProvider,
  type AIToolDefinition,
} from "@repo/ai";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  FALLBACK_MODEL_BY_PROVIDER,
  aiCreditsForCost,
  estimateCostMicroUsd,
  type AIProviderName,
  type PricingOverrides,
} from "@repo/config";
import { getEnv } from "@repo/config/env";
import type { Prisma } from "@repo/db";
import type { TenantContext } from "../context";
import { fingerprint } from "../crypto";
import { AppError, ProviderError, ProviderNotConfiguredError } from "../errors";
import { recordEvent } from "../events";
import { getConnectedIntegration } from "../integrations/credentials";
import { logger } from "../logger";
import { checkUsage, consumeUsage, isLimitError } from "../billing/usage";
import type { AgentDefinition } from "./agent";

/**
 * AIService: the only path from domain code to an LLM.
 *
 *   route → cache lookup → credit pre-check → provider call (retries, backoff)
 *        → fallback model → schema validation (+1 repair attempt) → record AIRequest
 *        → consume AI credits → cache store
 */

export interface AIRoute {
  provider: AIProvider;
  providerName: AIProviderName;
  model: string;
  fallbackModel: string | null;
  source: "integration" | "platform" | "mock";
}

export interface AgentRunOptions {
  campaignId?: string | null;
  leadId?: string | null;
  workflowExecutionId?: string | null;
  /** Skip the cache even when the agent is cacheable. */
  fresh?: boolean;
}

export interface AgentRunMeta {
  aiRequestId: string;
  provider: AIProviderName;
  model: string;
  cached: boolean;
  usedFallback: boolean;
  costMicroUsd: number;
  credits: number;
  latencyMs: number;
}

const MAX_ATTEMPTS_PER_MODEL = 3;

// Mock responders are registered by agents at import time (see ./agents/index.ts).
const mockProvider = new MockAIProvider();
const mockAgents = new Map<string, AgentDefinition<unknown, unknown>>();

export function registerMockAgent<I, O>(agent: AgentDefinition<I, O>): void {
  mockAgents.set(agent.name, agent as AgentDefinition<unknown, unknown>);
  mockProvider.register(agent.name, (request) => ({ json: agent.mock(request.agentInput as I) }));
}

export function getMockProvider(): MockAIProvider {
  return mockProvider;
}

function pricingOverrides(): PricingOverrides {
  const raw = getEnv().AI_PRICING_OVERRIDES;
  if (!raw) return {};
  try {
    return JSON.parse(raw) as PricingOverrides;
  } catch {
    logger.warn("AI_PRICING_OVERRIDES is not valid JSON; ignoring");
    return {};
  }
}

function platformKey(provider: Exclude<AIProviderName, "mock">): string | undefined {
  const env = getEnv();
  switch (provider) {
    case "openai":
      return env.OPENAI_API_KEY;
    case "anthropic":
      return env.ANTHROPIC_API_KEY;
    case "google":
      return env.GOOGLE_AI_API_KEY;
  }
}

/** Resolves which provider/model serves an organisation's AI requests. */
export async function resolveAIRoute(ctx: TenantContext): Promise<AIRoute> {
  const env = getEnv();

  const integration = await getConnectedIntegration(ctx, "AI");
  if (integration && integration.provider !== "mock") {
    const name = integration.provider as Exclude<AIProviderName, "mock">;
    const provider = createProvider(name, { apiKey: integration.credentials.apiKey });
    if (provider) {
      const model = (integration.config.model as string | undefined) ?? DEFAULT_MODEL_BY_PROVIDER[name];
      const fallback = (integration.config.fallbackModel as string | undefined) ?? FALLBACK_MODEL_BY_PROVIDER[name];
      return { provider, providerName: name, model, fallbackModel: fallback !== model ? fallback : null, source: "integration" };
    }
  }

  if (env.AI_DEFAULT_PROVIDER !== "mock") {
    const name = env.AI_DEFAULT_PROVIDER;
    const provider = createProvider(name, { apiKey: platformKey(name) });
    if (provider) {
      const model = env.AI_DEFAULT_MODEL ?? DEFAULT_MODEL_BY_PROVIDER[name];
      const fallback = env.AI_FALLBACK_MODEL ?? FALLBACK_MODEL_BY_PROVIDER[name];
      return { provider, providerName: name, model, fallbackModel: fallback !== model ? fallback : null, source: "platform" };
    }
  }

  if (env.DEMO_MODE || env.AI_DEFAULT_PROVIDER === "mock") {
    return { provider: mockProvider, providerName: "mock", model: "mock-1", fallbackModel: null, source: "mock" };
  }
  throw new ProviderNotConfiguredError("AI");
}

async function callWithRetries(provider: AIProvider, request: AIGenerateRequest): Promise<{ result: AIGenerateResult; attempts: number }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_MODEL; attempt += 1) {
    try {
      return { result: await provider.generate(request), attempts: attempt };
    } catch (error) {
      lastError = error;
      const retryable = error instanceof AIProviderError ? error.retryable : true;
      if (!retryable || attempt === MAX_ATTEMPTS_PER_MODEL) break;
      const delay = 400 * 3 ** (attempt - 1) + Math.random() * 200;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

interface ExecuteResult {
  result: AIGenerateResult;
  attempts: number;
  usedFallback: boolean;
}

/** Calls the primary model, then the fallback model if the primary keeps failing. */
async function executeWithFallback(route: AIRoute, request: Omit<AIGenerateRequest, "model">): Promise<ExecuteResult> {
  try {
    const { result, attempts } = await callWithRetries(route.provider, { ...request, model: route.model });
    return { result, attempts, usedFallback: false };
  } catch (primaryError) {
    const canFallback =
      route.fallbackModel && !(primaryError instanceof AIProviderError && primaryError.status === 200);
    if (!canFallback || !route.fallbackModel) throw primaryError;
    logger.warn({ err: primaryError, model: route.model, fallback: route.fallbackModel }, "AI primary model failed; using fallback");
    const { result, attempts } = await callWithRetries(route.provider, { ...request, model: route.fallbackModel });
    return { result, attempts: attempts + MAX_ATTEMPTS_PER_MODEL, usedFallback: true };
  }
}

async function recordRequest(
  ctx: TenantContext,
  data: Omit<Prisma.AIRequestUncheckedCreateInput, "organizationId">,
): Promise<string> {
  const row = await ctx.db.aIRequest.create({ data: { ...data, organizationId: ctx.organizationId } });
  return row.id;
}

async function chargeCredits(ctx: TenantContext, credits: number, aiRequestId: string, campaignId?: string | null) {
  try {
    await consumeUsage(ctx, "AI_CREDITS", credits, {
      sourceType: "ai_request",
      sourceId: aiRequestId,
      campaignId: campaignId ?? null,
      idempotencyKey: `ai:${aiRequestId}`,
    });
  } catch (error) {
    // The provider call already happened; record the overage rather than failing the result.
    if (isLimitError(error)) logger.warn({ aiRequestId, credits }, "AI credits exhausted after request completed");
    else throw error;
  }
}

async function ensureCredits(ctx: TenantContext): Promise<void> {
  const snapshot = await checkUsage(ctx, "AI_CREDITS", 1);
  if (snapshot.limit !== null && snapshot.used + 1 > snapshot.limit) {
    throw new AppError("LIMIT_EXCEEDED", "You've used all AI credits for this billing period.", 402, {
      metric: "AI_CREDITS",
      limit: snapshot.limit,
      used: snapshot.used,
      requested: 1,
    });
  }
}

/** Runs a structured-output agent and returns validated output plus cost metadata. */
export async function runAgent<I, O>(
  ctx: TenantContext,
  agent: AgentDefinition<I, O>,
  input: I,
  options: AgentRunOptions = {},
): Promise<{ output: O; meta: AgentRunMeta }> {
  const env = getEnv();
  const route = await resolveAIRoute(ctx);
  if (route.providerName === "mock" && !mockAgents.has(agent.name)) registerMockAgent(agent);
  const cacheKey = fingerprint({ agent: agent.name, version: agent.version, model: route.model, input });
  const common = {
    userId: ctx.userId,
    campaignId: options.campaignId ?? null,
    leadId: options.leadId ?? null,
    workflowExecutionId: options.workflowExecutionId ?? null,
    agent: agent.name,
    promptVersion: agent.version,
    provider: route.providerName,
  };

  // 1. Cache
  if (agent.cacheable && !options.fresh && env.AI_CACHE_TTL_SECONDS > 0) {
    const hit = await ctx.db.aICacheEntry.findFirst({ where: { cacheKey, expiresAt: { gt: new Date() } } });
    if (hit) {
      const parsed = agent.output.safeParse(hit.output);
      if (parsed.success) {
        await ctx.db.aICacheEntry.update({ where: { id: hit.id }, data: { hits: { increment: 1 } } });
        const aiRequestId = await recordRequest(ctx, {
          ...common,
          model: hit.model,
          status: "CACHED",
          cacheKey,
          latencyMs: 0,
          attempts: 0,
        });
        return {
          output: parsed.data,
          meta: { aiRequestId, provider: route.providerName, model: hit.model, cached: true, usedFallback: false, costMicroUsd: 0, credits: 0, latencyMs: 0 },
        };
      }
    }
  }

  // 2. Credits pre-check (before spending provider money)
  await ensureCredits(ctx);

  // 3. Provider call with retries, fallback and one schema-repair attempt
  const prompt = agent.buildPrompt(input);
  const jsonSchema = { name: agent.name, schema: toStrictJsonSchema(agent.output) };
  const messages: AIMessage[] = [{ role: "user", content: prompt.user }];
  const started = Date.now();
  let inputTokens = 0;
  let outputTokens = 0;
  let attempts = 0;
  let usedFallback = false;
  let servedModel = route.model;

  try {
    let output: O | undefined;
    for (let repair = 0; repair < 2 && output === undefined; repair += 1) {
      const execution = await executeWithFallback(route, {
        system: prompt.system,
        messages,
        jsonSchema,
        maxTokens: agent.maxTokens,
        effort: agent.effort,
        agent: agent.name,
        agentInput: input,
      });
      attempts += execution.attempts;
      usedFallback ||= execution.usedFallback;
      servedModel = execution.result.model;
      inputTokens += execution.result.usage.inputTokens;
      outputTokens += execution.result.usage.outputTokens;

      const parsed = agent.output.safeParse(execution.result.json);
      if (parsed.success) {
        output = parsed.data;
      } else if (repair === 0) {
        messages.push({ role: "assistant", content: execution.result.text });
        messages.push({
          role: "user",
          content: `Your previous response did not match the required schema: ${parsed.error.message.slice(0, 800)}. Return only corrected JSON.`,
        });
      } else {
        throw new ProviderError(route.providerName, "Model output failed schema validation", false);
      }
    }
    if (output === undefined) throw new ProviderError(route.providerName, "No valid output", false);

    const latencyMs = Date.now() - started;
    const costMicroUsd = estimateCostMicroUsd(servedModel, inputTokens, outputTokens, pricingOverrides());
    const credits = aiCreditsForCost(costMicroUsd);
    const aiRequestId = await recordRequest(ctx, {
      ...common,
      model: servedModel,
      status: "SUCCESS",
      inputTokens,
      outputTokens,
      costMicroUsd,
      credits,
      latencyMs,
      attempts,
      usedFallback,
      cacheKey: agent.cacheable ? cacheKey : null,
    });
    await chargeCredits(ctx, credits, aiRequestId, options.campaignId);
    await recordEvent(ctx, {
      type: "ai_request",
      leadId: options.leadId,
      campaignId: options.campaignId,
      workflowExecutionId: options.workflowExecutionId,
      actor: { type: "AI", id: aiRequestId },
      properties: { agent: agent.name, model: servedModel, provider: route.providerName, costMicroUsd, credits, status: "SUCCESS" },
    });

    if (agent.cacheable && env.AI_CACHE_TTL_SECONDS > 0) {
      await ctx.db.aICacheEntry.upsert({
        where: { organizationId_cacheKey: { organizationId: ctx.organizationId, cacheKey } },
        create: {
          organizationId: ctx.organizationId,
          cacheKey,
          agent: agent.name,
          model: servedModel,
          output: output as Prisma.InputJsonValue,
          inputTokens,
          outputTokens,
          expiresAt: new Date(Date.now() + env.AI_CACHE_TTL_SECONDS * 1000),
        },
        update: {
          output: output as Prisma.InputJsonValue,
          model: servedModel,
          expiresAt: new Date(Date.now() + env.AI_CACHE_TTL_SECONDS * 1000),
        },
      });
    }

    return {
      output,
      meta: { aiRequestId, provider: route.providerName, model: servedModel, cached: false, usedFallback, costMicroUsd, credits, latencyMs },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordRequest(ctx, {
      ...common,
      model: servedModel,
      status: "FAILED",
      inputTokens,
      outputTokens,
      latencyMs: Date.now() - started,
      attempts,
      usedFallback,
      error: message.slice(0, 1000),
    }).catch((recordError: unknown) => logger.error({ err: recordError }, "failed to record AI failure"));
    logger.error({ err: error, agent: agent.name, organizationId: ctx.organizationId }, "AI agent failed");
    if (error instanceof AppError) throw error;
    const retryable = error instanceof AIProviderError ? error.retryable : true;
    throw new ProviderError(route.providerName, message, retryable);
  }
}

/**
 * Free-form generation with tools (used by the copilot's tool loop). Records usage the
 * same way as runAgent but leaves the loop to the caller.
 */
export async function generateWithTools(
  ctx: TenantContext,
  params: { agent: string; version: string; system: string; messages: AIMessage[]; tools: AIToolDefinition[]; agentInput?: unknown },
): Promise<{ result: AIGenerateResult; meta: AgentRunMeta }> {
  const route = await resolveAIRoute(ctx);
  await ensureCredits(ctx);
  const started = Date.now();
  const execution = await executeWithFallback(route, {
    system: params.system,
    messages: params.messages,
    tools: params.tools,
    agent: params.agent,
    agentInput: params.agentInput,
    effort: "medium",
  });
  const latencyMs = Date.now() - started;
  const { inputTokens, outputTokens } = execution.result.usage;
  const costMicroUsd = estimateCostMicroUsd(execution.result.model, inputTokens, outputTokens, pricingOverrides());
  const credits = aiCreditsForCost(costMicroUsd);
  const aiRequestId = await recordRequest(ctx, {
    userId: ctx.userId,
    agent: params.agent,
    promptVersion: params.version,
    provider: route.providerName,
    model: execution.result.model,
    status: "SUCCESS",
    inputTokens,
    outputTokens,
    costMicroUsd,
    credits,
    latencyMs,
    attempts: execution.attempts,
    usedFallback: execution.usedFallback,
  });
  await chargeCredits(ctx, credits, aiRequestId);
  return {
    result: execution.result,
    meta: {
      aiRequestId,
      provider: route.providerName,
      model: execution.result.model,
      cached: false,
      usedFallback: execution.usedFallback,
      costMicroUsd,
      credits,
      latencyMs,
    },
  };
}

export function isMockAgentRegistered(name: string): boolean {
  return mockAgents.has(name);
}
