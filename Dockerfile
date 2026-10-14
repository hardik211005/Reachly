# syntax=docker/dockerfile:1.7
#
# Reachly production images — one Dockerfile, three targets:
#   docker build --target web     -t reachly-web .
#   docker build --target worker  -t reachly-worker .
#   docker build --target migrate -t reachly-migrate .
# See docs/deployment.md. Runtime configuration comes from environment variables only;
# nothing secret is baked into an image.

ARG NODE_VERSION=22.12-alpine

# ---------------------------------------------------------------------------- deps
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json .npmrc ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/ai/package.json packages/ai/
COPY packages/config/package.json packages/config/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/integrations/package.json packages/integrations/
COPY packages/queue/package.json packages/queue/
COPY packages/tsconfig/package.json packages/tsconfig/
COPY packages/ui/package.json packages/ui/
# Scripts are skipped here (postinstall generates the Prisma client, which needs the schema);
# the client is generated in the build stage once the source is present.
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts --no-audit --no-fund

# ---------------------------------------------------------------------------- build
FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production \
    NEXT_OUTPUT=standalone
# Placeholders so env validation passes at build time; real values are supplied at runtime.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build \
    BETTER_AUTH_SECRET=build-time-placeholder-not-used-at-runtime-000 \
    ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= \
    SIGNING_SECRET=build-time-placeholder-not-used-at-runtime-000
RUN npm run db:generate \
 && npm run build -w @repo/web \
 && npm run build -w @repo/worker

# ---------------------------------------------------------------------------- prod-deps
# Production node_modules for the worker (its bundle keeps native/heavy deps external).
FROM deps AS prod-deps
RUN npm prune --omit=dev --no-audit --no-fund

# ---------------------------------------------------------------------------- web
FROM node:${NODE_VERSION} AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S -g 1001 reachly && adduser -S -u 1001 -G reachly reachly
COPY --from=build --chown=reachly:reachly /app/apps/web/.next/standalone ./
COPY --from=build --chown=reachly:reachly /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=reachly:reachly /app/apps/web/public ./apps/web/public
COPY --from=build --chown=reachly:reachly /app/packages/core/assets ./packages/core/assets
# Local file storage (STORAGE_DRIVER=local); standalone server.js runs from apps/web.
RUN mkdir -p apps/web/.storage && chown reachly:reachly apps/web/.storage
USER reachly
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "apps/web/server.js"]

# ---------------------------------------------------------------------------- worker
FROM node:${NODE_VERSION} AS worker
WORKDIR /app
ENV NODE_ENV=production QUEUE_DRIVER=bullmq
RUN addgroup -S -g 1001 reachly && adduser -S -u 1001 -G reachly reachly
COPY --from=prod-deps --chown=reachly:reachly /app/node_modules ./node_modules
COPY --from=build --chown=reachly:reachly /app/packages/db/src/generated ./packages/db/src/generated
COPY --from=build --chown=reachly:reachly /app/apps/worker/dist ./apps/worker/dist
COPY --from=build --chown=reachly:reachly /app/apps/worker/package.json ./apps/worker/package.json
COPY --from=build --chown=reachly:reachly /app/packages/core/assets ./packages/core/assets
COPY --from=build --chown=reachly:reachly /app/package.json ./package.json
RUN mkdir -p .storage && chown reachly:reachly .storage
USER reachly
CMD ["node", "--enable-source-maps", "apps/worker/dist/index.js"]

# ---------------------------------------------------------------------------- migrate
# One-shot: applies pending Prisma migrations, then exits. Run before rolling out web/worker.
FROM deps AS migrate
COPY packages/db packages/db
COPY packages/config packages/config
WORKDIR /app/packages/db
CMD ["npx", "prisma", "migrate", "deploy"]
