import { IntegrationError, providerFetch } from "../lib/errors";
import { signHmacSha256 } from "../lib/signatures";

/**
 * n8n is an integration layer, not the core: Reachly owns data and rules and hands work
 * to n8n through signed webhook calls; n8n calls back (signed) or uses the REST API.
 */

export interface N8nWorkflowSummary {
  id: string;
  name: string;
  active: boolean;
  updatedAt: string | null;
  tags: string[];
  /** Webhook paths exposed by the workflow's Webhook trigger nodes. */
  webhookPaths: string[];
}

export interface N8nTriggerResult {
  status: number;
  /** n8n's response (e.g. from a "Respond to Webhook" node), if JSON. */
  body: unknown;
}

export interface N8nClient {
  readonly isMock: boolean;
  readonly baseUrl: string | null;
  health(): Promise<{ ok: boolean; detail: string }>;
  listWorkflows(): Promise<N8nWorkflowSummary[]>;
  /** POSTs a signed JSON payload to a production webhook path (`/webhook/<path>`). */
  triggerWebhook(path: string, payload: unknown): Promise<N8nTriggerResult>;
}

export const N8N_SIGNATURE_HEADER = "x-reachai-signature";

interface N8nApiWorkflow {
  id: string;
  name: string;
  active: boolean;
  updatedAt?: string;
  tags?: Array<{ name: string }>;
  nodes?: Array<{ type: string; parameters?: { path?: string } }>;
}

export class HttpN8nClient implements N8nClient {
  readonly isMock = false;

  constructor(private readonly options: { baseUrl: string; apiKey?: string | null; webhookSecret?: string | null }) {}

  get baseUrl(): string {
    return this.options.baseUrl.replace(/\/+$/, "");
  }

  async health() {
    try {
      const response = await fetch(`${this.baseUrl}/healthz`, { signal: AbortSignal.timeout(5_000) });
      return response.ok ? { ok: true, detail: "Reachable" } : { ok: false, detail: `HTTP ${response.status}` };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }

  async listWorkflows(): Promise<N8nWorkflowSummary[]> {
    if (!this.options.apiKey) throw new IntegrationError("n8n", "An n8n API key is needed to list workflows", null, false);
    const response = await providerFetch("n8n", `${this.baseUrl}/api/v1/workflows?limit=100`, { headers: { "X-N8N-API-KEY": this.options.apiKey, accept: "application/json" } });
    const data = (await response.json()) as { data?: N8nApiWorkflow[] };
    return (data.data ?? []).map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      active: workflow.active,
      updatedAt: workflow.updatedAt ?? null,
      tags: (workflow.tags ?? []).map((tag) => tag.name),
      webhookPaths: (workflow.nodes ?? []).filter((node) => node.type === "n8n-nodes-base.webhook" && node.parameters?.path).map((node) => node.parameters?.path as string),
    }));
  }

  async triggerWebhook(path: string, payload: unknown): Promise<N8nTriggerResult> {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.options.webhookSecret) headers[N8N_SIGNATURE_HEADER] = signHmacSha256(this.options.webhookSecret, body, Math.floor(Date.now() / 1000));
    const response = await providerFetch("n8n", `${this.baseUrl}/webhook/${path.replace(/^\/+/, "")}`, { method: "POST", headers, body, timeoutMs: 20_000 });
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // n8n "Respond immediately" returns plain text.
    }
    return { status: response.status, body: parsed };
  }
}

/** Demo-mode stand-in: records nothing externally, answers like a successful webhook. */
export class MockN8nClient implements N8nClient {
  readonly isMock = true;
  readonly baseUrl = null;

  async health() {
    return { ok: true, detail: "Demo — no n8n instance connected" };
  }

  async listWorkflows(): Promise<N8nWorkflowSummary[]> {
    return [];
  }

  async triggerWebhook(path: string): Promise<N8nTriggerResult> {
    return { status: 200, body: { simulated: true, message: `Workflow started (demo — no n8n call was made to /webhook/${path})` } };
  }
}
