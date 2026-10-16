# Deployment

Reachly runs as three processes that share one PostgreSQL database and one Redis:

| Process | Image target | What it does |
|---|---|---|
| **web** | `web` | Next.js app: pages, `/api/v1` REST API, auth, provider webhooks. Stateless — run as many as you need behind a load balancer. |
| **worker** | `worker` | BullMQ workers for discovery, enrichment, scoring, sends, calls, workflows, analytics and the learned-model retrain. Scale by running more replicas. |
| **migrate** | `migrate` | One-shot `prisma migrate deploy`. Run it before each rollout; it exits when done. |

All three come from the root [`Dockerfile`](../Dockerfile). Configuration is environment variables only (see [`.env.example`](../.env.example)); nothing secret is baked into an image.

## Quick start with Docker Compose

[`infra/docker/docker-compose.prod.yml`](../infra/docker/docker-compose.prod.yml) runs the full stack on one host: Postgres, Redis, migrate, web and worker.

```bash
cp .env.example .env.production
# edit .env.production: secrets, APP_URL, BETTER_AUTH_URL, providers (see the checklist below)
export POSTGRES_PASSWORD='a-long-random-password'
docker compose -f infra/docker/docker-compose.prod.yml --env-file .env.production up -d --build
```

The web app listens on `:3000` (override with `WEB_PORT`). Put a TLS-terminating reverse proxy (Caddy, nginx, a cloud load balancer) in front of it. Compose sets `DATABASE_URL`, `REDIS_URL`, `QUEUE_DRIVER=bullmq` and `DEMO_MODE=false` for you.

## Building images yourself

```bash
docker build --target web     -t reachly-web .
docker build --target worker  -t reachly-worker .
docker build --target migrate -t reachly-migrate .
```

- **web** is a Next.js standalone server (`node apps/web/server.js`) running as a non-root user, with a `HEALTHCHECK` on `/api/health`.
- **worker** is the tsup bundle plus production `node_modules`. It refuses to start unless `QUEUE_DRIVER=bullmq`.
- **migrate** contains the Prisma CLI and migrations.

Rollout order: `migrate` → `worker` → `web`. Migrations are additive, so old web pods keep working while they drain.

## Managed platforms

Any container platform works (Fly.io, Railway, Render, ECS, Cloud Run, Kubernetes):

1. **Postgres 15+** (managed). Set `DATABASE_URL`. If you use a pooler such as PgBouncer, set `DIRECT_URL` to the direct, non-pooled URL for migrations.
2. **Redis 7+** with `maxmemory-policy noeviction`. BullMQ must never have jobs evicted. Set `REDIS_URL`.
3. Run `migrate` as a release or pre-deploy job.
4. Run `web` with health checks on `GET /api/health`, and `worker` as a background service with no port.
5. Point provider webhooks at `https://<APP_URL>/api/webhooks/...` (see the provider sections of `.env.example` and [billing.md](billing.md), [outreach.md](outreach.md), [calling.md](calling.md)).

Without Redis you *can* run a single web instance with `QUEUE_DRIVER=inline`, but production boot rejects it (`APP_ENV=production`). It is only for local development.

## Production checklist

**Required**

- [ ] `APP_ENV=production`, `NODE_ENV=production`, `DEMO_MODE=false` (boot fails otherwise).
- [ ] `APP_URL` and `BETTER_AUTH_URL` set to the public `https://` origin. Cookies, CSRF origin checks, unsubscribe links and webhooks depend on it.
- [ ] Fresh secrets, generated with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`:
  - `BETTER_AUTH_SECRET` (sessions)
  - `ENCRYPTION_KEY` (AES-256-GCM for stored provider credentials). **Back it up.** Losing it makes connected integrations unreadable.
  - `SIGNING_SECRET` (unsubscribe, callback and share-link tokens)
- [ ] `QUEUE_DRIVER=bullmq` with a worker running.
- [ ] `AUTH_REQUIRE_EMAIL_VERIFICATION=true` and a working email provider for auth mail.
- [ ] `NEXT_PUBLIC_BRAND_SUPPORT_EMAIL` and `NEXT_PUBLIC_BRAND_WEBSITE` set to your own domain.
- [ ] `PLATFORM_ADMIN_EMAILS` set to the operators who may open `/admin` (everyone else gets a 404).

**Storage**

- [ ] `STORAGE_DRIVER=s3` with `S3_*` set, for multiple web instances or ephemeral disks (quote PDFs, logos). `local` only works with one instance and a persistent volume. Compose mounts a shared volume for this.

**Providers** (each is optional; set the ones you use)

- [ ] AI: `AI_DEFAULT_PROVIDER` and its key. Without one, qualification and drafts use the built-in rules.
- [ ] Email (`EMAIL_PROVIDER` + key + webhook secret), WhatsApp (`WHATSAPP_*`), voice (`VOICE_PROVIDER`, Twilio/Vapi keys), payments (`STRIPE_*`, `RAZORPAY_*`). Configure each provider's webhook with its signing secret.
- [ ] Workspaces can also connect their own providers in **Integrations**; those credentials are encrypted with `ENCRYPTION_KEY`.

## Health and observability

| Endpoint | Auth | Use |
|---|---|---|
| `GET /api/health` | none | Liveness/readiness. `200 {"status":"ok"}` when the database answers, `503` otherwise. Reveals nothing else. |
| `GET /api/v1/system/health` | platform admin session | Detailed view behind the admin portal’s **Server health** page: database, Redis, queues (waiting/failed counts), worker heartbeats, dead letters, provider modes. |

- **Logs** are structured JSON (pino) on stdout from both processes; ship them with your platform's log driver. Set `LOG_LEVEL=info` in production. Every API response carries an `x-request-id`, which also appears in the logs and the audit log.
- **Worker liveness.** Workers write a heartbeat to Redis. The admin portal’s Server health page flags a missing heartbeat, so alert on it, or on the failed-jobs count.
- **Dead letters.** Jobs that exhaust their retries are kept in the `reachai:dead-letter` Redis list (latest 1,000) and shown on the admin portal’s Server health page.

## Backups and recovery

- Postgres holds everything durable: leads, events, messages, deals, quotes, audit log, encrypted credentials and the learned scoring models. Use your provider's point-in-time recovery, or schedule `pg_dump`.
- Redis holds only queues, rate-limit counters and caches. Losing it loses in-flight jobs, but scheduled work (sequence ticks, workflow resumes, retrains) is re-created by the worker's schedulers.
- Keep `ENCRYPTION_KEY` in a secret manager alongside your database backups.

## Security notes

- Security headers (HSTS in production, `X-Frame-Options: DENY`, `nosniff`, a strict `Referrer-Policy` and `Permissions-Policy`) are set in `apps/web/next.config.ts`.
- Cookie-authenticated writes require a same-origin `Origin` header. API keys (`Bearer rk_live_…`) are the supported way to call the API from other services.
- Rate limits use Redis when `REDIS_URL` is reachable, else in-memory per instance.
- Provider webhooks are signature-verified and idempotent; outbound webhooks and n8n calls are HMAC-signed.
- See [architecture.md](architecture.md#security-model-summary) for the full model.
