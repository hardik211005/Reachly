# ReachAI

**AI-powered B2B lead discovery, qualification and outreach.** Describe what you sell; ReachAI finds businesses likely to buy it, enriches and scores them with transparent reasoning, drafts personalised email/WhatsApp/call pitches, runs approval-based or automated sequences, tracks every conversation in a built-in CRM, and reports on what actually converts.

> "ReachAI" is a working name. All branding comes from [`packages/config/src/brand.ts`](packages/config/src/brand.ts) — renaming is a one-file change.

## Status

Built in phases (see [Roadmap](#roadmap)). Phases 1–7 are complete:

- **Foundation** — auth, workspaces, RBAC, design system, onboarding with AI business analysis, event-backed overview, copilot.
- **Lead engine** — natural-language discovery, provider abstraction (Google Places + demo data), compliant enrichment, dedupe, transparent AI-assisted scoring, lead table and workspace, CSV import/export.
- **Campaigns & outreach** — 5-step campaign builder with live audience and message previews, launch estimate (volume, reachability, AI credits, cost) with explicit confirmation, sequence engine (steps, delays, stop-on-reply), Manual / Assisted / Automated modes with a human review queue, email (Resend/SendGrid/SMTP) with unsubscribe + List-Unsubscribe, official WhatsApp Cloud API with templates, opt-in and the 24-hour window, signed provider webhooks, unified inbox with AI reply classification and suggested replies, per-lead pitch packs, email/WhatsApp channel dashboards, and copilot tools over campaigns, inbox and leads. See [docs/outreach.md](docs/outreach.md).
- **AI calling** — voice provider abstraction (Vapi hosted agent, Twilio with a turn-by-turn AI conversation over TwiML, labelled demo simulator), AI call briefs, explicit start confirmation, consent attestation / DND / suppression / calling-hours policy, live transcripts, post-call analysis (outcome, interest, objections, next step), meetings booked at the time the prospect said, voice-minute metering, campaign voice steps and a Calls workspace. See [docs/calling.md](docs/calling.md).
- **Automation** — workflow engine (event, schedule, webhook and manual triggers; 12 step types incl. waits, email, call prep, signed webhooks and n8n) with persisted per-step progress, exactly-once triggering, retries from the failed step and full run history; a visual builder with inline validation, variables and dry-run tests on real leads; ready-made templates; two-way n8n (signed calls out, callbacks that resume a waiting run, signed inbound trigger URLs, importable n8n templates); outbound webhook endpoints with signed, retried deliveries. See [docs/automation.md](docs/automation.md).
- **CRM & quotes** — drag-and-drop pipeline (New → Won/Lost) kept in step with lead statuses automatically, deal side panel (value, probability, owner, next steps, meetings with calendar invites, notes, activity), tasks and meetings views, contacts directory, and a quotation system: catalog + pricing rules (volume tiers, discounts, minimum orders, setup-fee waivers, GST) as the only source of prices, AI quote drafts from the conversation that never invent prices, live-priced editor, PDF, email / WhatsApp / share-link sending, and a public page where prospects accept or decline — which wins the deal. See [docs/crm.md](docs/crm.md).
- **Analytics & AI insights** — an analytics page with 20 defined metrics (rates per contacted lead, previous-period comparison, numerator and denominator on every rate), URL-shareable filters (period, campaign, channel, city, business type, source, score), funnel, trends, channel and segment breakdowns, reply heatmap, sequence-step performance, weekly contact cohorts, loss reasons, estimated costs (AI, channels, voice, prorated plan) with cost per lead / meeting and ROI, and CSV export. AI insights are computed in code with sample sizes and two-proportion significance tests, show their evidence, and may only be reworded by AI with the same numbers. See [docs/analytics.md](docs/analytics.md).
- **Public website** — a multi-page marketing site: home, platform overview, six product pages with live animated demos, four use-case pages, pricing with a full comparison table from the plan configuration, about, security, contact (a working form with spam controls), privacy and terms, a branded 404, sitemap and robots. Dropdown navigation, site-wide search (⌘K) and a theme switcher. Content describes the product only — no invented customers, logos or statistics.
- **Workspace administration** — settings for the workspace, your profile (password, sessions, theme), business & services (profile, catalog, pricing rules, AI ideal customer profile), team (email invitations with roles and seat limits), compliance (sending window, opt-outs, calling consent, block list) and API keys; an Integrations page to connect your own AI, lead data, email, WhatsApp, voice and Slack accounts with encrypted credentials; Billing with usage meters; and a System health page for admins. See [docs/workspace-admin.md](docs/workspace-admin.md).
- **Product UI** — scroll reveals, page transitions, count-up metrics, a gliding nav indicator, aurora page headers and spotlight cards throughout, a redesigned Discover page with search ideas from your profile and live progress, and an animated sign-in showcase. All motion respects `prefers-reduced-motion`.

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
  scripts/        dev helpers (e.g. Docker-free Postgres)
docs/             architecture, automation, calling, crm, outreach, analytics, workspace admin & public site
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

The seed builds **Demo Growth Agency** through the same services the app uses: ~100 leads discovered with the demo provider, three campaigns (*Delhi Cafés* — assisted email + WhatsApp, *Gurgaon Startups* — automated email, *Noida D2C Brands* — completed) with six weeks of backdated sends, deliveries, opens, AI-classified replies, opt-outs and a booked meeting, AI drafts waiting in the review queue, a dozen analysed AI calls (with transcripts, outcomes and booked meetings) plus calls waiting to be started, three live workflows whose run history comes from the real engine replaying those events (plus two drafts), a pipeline of deals from those replies and calls with quotes in every state (sent, viewed, accepted, declined, expired and an AI draft), next steps and upcoming meetings, a fresh *Restaurants in Gurgaon* segment to build a new campaign from, and AI insights computed from all of it. Every chart reads these stored records.

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
| 3. Campaigns | Campaign builder, outreach generation, email + WhatsApp, sequences, approvals, inbox, compliance | ✅ |
| 4. AI calling | Voice provider abstraction, call prep, compliance, live transcripts, call analysis | ✅ |
| 5. Automation | Workflow engine & builder, n8n integration, execution visibility | ✅ |
| 6. CRM | Pipeline, deals, tasks, notes, quotes + PDF | ✅ |
| 7. Analytics | Funnels, cohorts, heatmaps, costs & ROI, AI insights | ✅ |
| 8. Billing | Stripe checkout/portal/webhooks, plan limits | ⏳ |
| 9. Hardening | Security, observability/system health, e2e, Docker images, docs | ⏳ |
