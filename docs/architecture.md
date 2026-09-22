# Architecture

Reachly is a **modular monolith plus background workers**. One Next.js application serves the UI and the REST API; one worker process runs queued jobs. Domain logic lives in workspace packages with clear boundaries, so any module can later be extracted into its own service without rewriting callers.

```
                ┌──────────────────────────── apps/web (Next.js 16) ─────────────────────────────┐
 Browser ──────▶│ React Server Components  │  /api/v1 REST (route wrapper)  │  /api/webhooks/*     │
                │ Client islands (TanStack)│  auth · RBAC · zod · rate limit│  signature + idempot.│
                └──────────────┬───────────┴──────────────┬─────────────────┴─────────┬───────────┘
                               │ TenantContext            │                           │
                               ▼                          ▼                           ▼
                ┌──────────────────────────── packages/core (domain) ─────────────────────────────┐
                │ organizations · business · leads · discovery · scoring · campaigns · outreach  │
                │ conversations · calls · crm · quotes · workflows · analytics · billing · copilot│
                └───────┬──────────────────┬───────────────────┬──────────────────┬─────────────┘
                        │                  │                   │                  │
                 packages/db         packages/ai        packages/integrations  packages/queue
                 Prisma 7 + tenant   provider-agnostic  email/WhatsApp/voice/   BullMQ | inline
                 scoping extension   LLM layer          leads/billing/n8n       job contracts
                        │                  │                   │                  │
                   PostgreSQL        OpenAI/Anthropic/     Resend/SendGrid/SMTP,  Redis
                                     Google/Mock           Meta, Twilio/Vapi,       │
                                                           Stripe, n8n, S3          ▼
                                                                          apps/worker (BullMQ)
```

## Packages

| Package | Responsibility | Depends on |
|---|---|---|
| `@repo/config` | Branding, plan catalogue, model catalogue, domain vocabularies, env schema | — |
| `@repo/db` | Prisma schema, client, tenant-scoping extension, generated types | config |
| `@repo/ai` | `AIProvider` interface; OpenAI / Anthropic / Google / Mock adapters; strict JSON schema | config |
| `@repo/integrations` | Provider interfaces + adapters (email, WhatsApp, voice, lead data, billing, n8n, storage); webhook signature verification | config |
| `@repo/queue` | Job catalogue (Zod payloads), BullMQ driver, inline driver, schedules | config |
| `@repo/core` | All business logic: services take a `TenantContext` | all of the above |
| `@repo/ui` | Design system (tokens, primitives, data components, charts) | — |
| `apps/web` | Pages, API route handlers, auth, webhooks | core, ui |
| `apps/worker` | BullMQ workers dispatching to core processors | core, queue |

Internal packages ship as TypeScript source (`exports` → `src/*.ts`); Next.js transpiles them and the worker is bundled with tsup.

## Key decisions

- **Modular monolith, not microservices.** A single deployable web app and a worker keep operations simple. Module boundaries are package/folder boundaries; cross-module calls go through service functions, never through another module's tables.
- **Tenancy = Organization** (labelled *Workspace* in the UI, like Linear). Every tenant-owned table carries `organizationId`. Services only use `ctx.db`, a Prisma client extended to inject `organizationId` into every query and create, and to throw `TenantViolationError` on explicit cross-tenant filters. Integration tests prove isolation.
- **Lead doubles as the CRM company.** A prospect business is one `Lead` row (with `Contact`s); CRM views (companies, pipeline) are projections over leads plus `Deal`/`Task`/`Note`. One source of truth per business avoids lead→account sync drift.
- **Event log is the analytics source of truth.** `Event` is append-only. Timelines, funnels, KPIs, channel/campaign performance and AI insights are all SQL over events (plus current deal/lead snapshots). No dashboard card is computed independently of stored data.
- **Provider abstraction everywhere.** Resolution order per capability: organisation-connected integration → platform env credentials → mock (only when `DEMO_MODE=true`) → "Connect provider". The current mode for each category is visible in Integrations and the demo badge. Lead data is the exception that always works: without a Google Places key it uses OpenStreetMap (Nominatim for a fast first pass, Overpass mirrors for depth, within a time budget), and `LEAD_PROVIDER=mock` is only for tests and the seed.
- **Payments are optional and verified server-side.** Stripe (card subscriptions) and Razorpay (UPI, prepaid months) switch on with their keys; every payment is re-read from the provider and webhooks are signature-checked and recorded once. See [billing.md](billing.md).
- **Two dev servers, two modes.** `npm run dev` (:3000) uses real providers from `.env`; the Playwright suite starts its own server on :3100 in demo mode with a separate build folder (`NEXT_DIST_DIR=.next-e2e`).
- **Nothing pretends to work.** Mock providers are labelled; simulated inbound events are flagged `simulated`; missing credentials surface as `PROVIDER_NOT_CONFIGURED` (HTTP 424) with a "Connect provider" state.
- **Queues for anything slow or external.** Discovery, enrichment, scoring, sends, webhooks, analytics and workflows run as jobs with retries, exponential backoff and dead-lettering. `QUEUE_DRIVER=inline` runs the same processors in-process for Redis-less local development.
- **n8n is an integration layer, not the core.** The app owns data, auth, billing and business rules; workflows can call n8n and n8n can call back (signed) or use the REST API with an API key.

## Request lifecycle (REST)

1. `proxy.ts` gates page routes on session-cookie presence and assigns a request id.
2. `route()` in `apps/web/lib/api.ts` authenticates (session cookie or `Bearer rk_live_…` API key), enforces same-origin for cookie writes (CSRF), applies rate limits (a per-endpoint bucket — method + path with ids collapsed — plus an overall per-actor ceiling, so strict limits like campaign launch aren't consumed by ordinary reads), checks the RBAC permission, validates body/query with Zod, runs the handler with a `TenantContext`, and maps errors to a consistent envelope.
3. Services validate business rules (plan features, usage limits, compliance), write through `ctx.db`, record events and audit logs, and enqueue jobs.

## Background processing

- Job contracts: `packages/queue/src/jobs.ts` (queue, Zod schema per job).
- Processors: registered in `packages/core/src/jobs/*` via `registerProcessor`.
- Worker: `apps/worker` starts one BullMQ `Worker` per queue with processors, upserts cron schedulers, writes heartbeats and dead-letters final failures.
- Non-retryable application errors (validation, limits, not found) skip retries.
- Outreach runs on jobs too: `sequences.tick` (every minute) → `outreach.prepare-step` → `messages.send`, plus `conversations.analyze-inbound`, `webhooks.process` and, in demo mode, `demo.simulate`. See [outreach.md](outreach.md).
- Calls: `calls.start` hands a confirmed call to the voice provider and `calls.analyze` turns the transcript into an outcome. Voice webhooks share the `WebhookEvent` store and are applied through a registered `voice` handler. See [calling.md](calling.md).
- Workflows: the `workflows` event subscriber starts matching runs, `workflows.execute` runs steps until a run finishes or waits, and `workflows.resume-due` (every minute) resumes waits, times out n8n waits and starts scheduled workflows. The `outbound-webhooks` subscriber queues `webhooks.deliver` for subscribed endpoints. See [automation.md](automation.md).
- CRM: the `crm` event subscriber opens or advances a lead's deal when its status becomes Interested, Meeting, Quote sent, Won or Lost; `quotes.expire` (hourly) expires sent quotes past their validity. See [crm.md](crm.md).
- Analytics: `analytics.insights-all` (daily, 06:00) queues one `analytics.insights` job per workspace with recent activity and the AI insights feature; each job recomputes that workspace's insights. See [analytics.md](analytics.md).

## Security model (summary)

Better Auth sessions (httpOnly cookies, DB-backed) · RBAC permissions checked in services · tenant-scoped Prisma client · Zod on every input · CSRF origin checks · per-actor rate limiting (Redis or in-memory) · AES-256-GCM encrypted provider credentials · HMAC-signed unsubscribe/callback tokens · webhook signature verification + idempotency · audit log · security headers. See [deployment.md](deployment.md) for production hardening.
