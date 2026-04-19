FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

# ── builder ────────────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app

# Install dependencies (package manifests only — no source yet)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/db/package.json           ./packages/db/
COPY apps/api/package.json              ./apps/api/
RUN pnpm install --no-frozen-lockfile

# Copy source (selective — avoids accidentally picking up local node_modules/dist)
COPY packages/ packages/
COPY apps/api/ apps/api/

# Compile workspace packages first (API depends on their JS output at runtime)
RUN pnpm --filter @mycase-hubspot/shared-types run build
RUN pnpm --filter @mycase-hubspot/db run build

# Build the NestJS API
RUN pnpm --filter @mycase-hubspot/api run build

# ── runner ─────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

# Production dependency install
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/db/package.json           ./packages/db/
COPY apps/api/package.json              ./apps/api/
RUN pnpm install --no-frozen-lockfile --prod

# Copy compiled output from builder
COPY --from=builder /app/apps/api/dist          ./apps/api/dist
COPY --from=builder /app/packages/db/dist       ./packages/db/dist
COPY --from=builder /app/packages/shared-types/dist ./packages/shared-types/dist

EXPOSE 3001
CMD ["node", "apps/api/dist/main"]
