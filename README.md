# ReachAI

**AI-powered B2B lead discovery, qualification and outreach.** Describe what you sell; ReachAI finds businesses likely to buy it, enriches and scores them with transparent reasoning, drafts personalised email/WhatsApp/call pitches, runs approval-based or automated sequences, tracks every conversation in a built-in CRM, and reports on what actually converts.

> "ReachAI" is a working name. All branding comes from [`packages/config/src/brand.ts`](packages/config/src/brand.ts) — renaming is a one-file change.

## Status

Built in phases (see [Roadmap](#roadmap)). Phases 1–2 are complete: foundation (auth, workspaces, RBAC, design system, onboarding with AI business analysis, event-backed overview, copilot) and the lead engine (natural-language discovery, provider abstraction with Google Places + demo data, compliant enrichment, dedupe, transparent AI-assisted scoring, lead table and lead workspace, CSV import/export).

## Tech stack

| Layer | Choice |
|---|---|
| Web | Next.js 16 (App Router, RSC, Turbopack), React 19, TypeScript (strict) |
| UI | Tailwind CSS v4, Radix primitives (shadcn-style components in `@repo/ui`), lucide, Recharts, cmdk, TanStack Query/Table, React Hook Form + Zod |
| Auth | Better Auth — email/password, email verification, password reset, Google OAuth, DB sessions |
| Data | PostgreSQL + Prisma 7 (driver adapter) with a tenant-scoping client extension |
| Jobs | BullMQ on Redis (`apps/worker`), or an inline driver for Redis-less local dev |
| AI | Provider-agnostic layer: Anthropic (official SDK), OpenAI, Google Gemini, deterministic Mock |
| Integrations | Resend / SendGrid / SMTP · Meta WhatsApp Cloud API · Twilio / Vapi · Stripe · n8n · S3-compatible storage |
| Monorepo | Turborepo + npm workspaces |
| Tests | Vitest (unit + Postgres-backed integration), Playwright (e2e) |

## Repository layout

```
apps/
  web/            Next.js app: pages, /api/v1 REST, auth, webhooks
  worker/         BullMQ worker process
packages/
  config/         brand, plans, model catalogue, env schema, domain vocabularies
  db/             Prisma schema + migrations, client, tenant extension
  core/           domain services, agents, analytics, jobs, seed
  ai/             AIProvider interface + adapters
  integrations/   email/WhatsApp/voice/leads/billing/n8n/storage adapters, webhook signatures
  queue/          job catalogue + BullMQ/inline drivers
  ui/             design system
  tsconfig/       shared TS configs
infra/
  docker/         docker-compose (Postgres, Redis, n8n, Mailpit, MinIO)
  n8n/            importable n8n workflow templates
  scripts/        dev helpers (e.g. Docker-free Postgres)
docs/             architecture, database, integrations, automation, analytics, ai, deployment
```

## Local setup

Prerequisites: Node.js ≥ 22.12, npm ≥ 10. Docker is optional.

```bash
npm install
cp .env.example .env        # then fill the three secrets (commands in the file)
```

### Database — pick one

**Docker (recommended):**
```bash
npm run infra:up            # Postgres :54329, Redis :6379, n8n :5678, Mailpit :8025
```

**No Docker:** runs a real PostgreSQL server from npm (`embedded-postgres`) on port 54329:
```bash
npm run db:local            # keep this terminal open
```
Without Redis, set `QUEUE_DRIVER=inline` in `.env` so background jobs run inside the web process.

### Migrate, seed, run
```bash
npm run db:deploy           # apply migrations (db:migrate for development changes)
npm run db:seed             # demo workspace — prints the demo login
npm run dev                 # web on http://localhost:3000 (+ worker when QUEUE_DRIVER=bullmq)
```

Demo login (seeded): `demo@reachai.dev` / `demo-password-2026`.

### Demo mode

`DEMO_MODE=true` lets the whole product run without paid APIs: missing providers fall back to clearly-labelled mock adapters (AI, lead data, email, WhatsApp, voice), and a persistent **Demo mode** badge lists which categories are simulated. Mock outreach is never sent anywhere. `DEMO_MODE` must be `false` in production (enforced at boot).

## Environment variables

Documented inline in [`.env.example`](.env.example). Required: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`, `SIGNING_SECRET`. Everything else is optional and enables a provider when set.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Web + worker in watch mode |
| `npm run build` | Production builds (Next.js + worker bundle) |
| `npm run typecheck` / `lint` / `test` | Across all workspaces (Turborepo) |
| `npm run test:integration` | Postgres-backed integration tests (uses `TEST_DATABASE_URL`) |
| `npm run test:e2e` | Playwright end-to-end tests against a running app (uses installed Chrome locally) |
| `npm run db:migrate` / `db:deploy` / `db:seed` / `db:studio` | Database lifecycle |
| `npm run infra:up` / `infra:down` | Docker services |

## Architecture

See [docs/architecture.md](docs/architecture.md). In short: a modular monolith (Next.js app + domain packages) with a BullMQ worker; every query is tenant-scoped by a Prisma extension; the immutable event log powers timelines and analytics; every external capability sits behind a provider interface with a labelled mock.

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1. Foundation | Monorepo, DB, auth, workspaces/RBAC, design system, shell, onboarding + ICP, overview, copilot, usage metering | ✅ |
| 2. Lead engine | Discovery (NL → criteria), provider abstraction, enrichment, dedupe, transparent scoring, lead table & workspace | ✅ |
| 3. Campaigns | Campaign builder, outreach generation, email + WhatsApp, sequences, approvals, compliance | ⏳ |
| 4. AI calling | Voice provider abstraction, call prep, transcripts, call analysis | ⏳ |
| 5. Automation | Workflow engine & builder, n8n integration, execution visibility | ⏳ |
| 6. CRM | Pipeline, deals, tasks, notes, quotes + PDF | ⏳ |
| 7. Analytics | Funnels, cohorts, heatmaps, AI insights | ⏳ |
| 8. Billing | Stripe checkout/portal/webhooks, plan limits | ⏳ |
| 9. Hardening | Security, observability/system health, e2e, Docker images, docs | ⏳ |
