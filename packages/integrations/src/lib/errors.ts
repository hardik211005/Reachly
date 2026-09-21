/** Error thrown by provider adapters. `retryable` drives queue retry behaviour. */
export class IntegrationError extends Error {
  override name = "IntegrationError";
  constructor(
    public readonly provider: string,
    message: string,
    public readonly status: number | null = null,
    public readonly retryable: boolean = true,
  ) {
    super(`${provider}: ${message}`);
  }
}

export function isRetryableHttp(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

/** fetch with timeout that throws IntegrationError on network failure or non-2xx. */
export async function providerFetch(
  provider: string,
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 30_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new IntegrationError(provider, `HTTP ${response.status}: ${detail.slice(0, 300)}`, response.status, isRetryableHttp(response.status));
    }
    return response;
  } catch (error) {
    if (error instanceof IntegrationError) throw error;
    throw new IntegrationError(provider, error instanceof Error ? error.message : String(error), null, true);
  } finally {
    clearTimeout(timer);
  }
}
