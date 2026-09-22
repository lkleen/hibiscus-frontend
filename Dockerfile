# syntax=docker/dockerfile:1

# Stage 1: Build both packages
FROM node:22-alpine AS builder
WORKDIR /build

RUN corepack enable

# Install dependencies (cache-friendly layer)
COPY package.json pnpm-workspace.yaml turbo.json pnpm-lock.yaml ./
COPY packages/frontend/package.json packages/frontend/
COPY packages/backend/package.json packages/backend/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store,sharing=locked \
    pnpm install --frozen-lockfile --store-dir=/pnpm-store

# Build
COPY packages/ packages/
RUN --mount=type=cache,id=hibiscus-frontend-turbo,target=/build/.turbo/cache \
    pnpm run build

# Stage 2: Runtime — install backend production deps only
FROM node:22-alpine
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.15.1 --activate

COPY packages/backend/package.json ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store,sharing=locked \
    pnpm install --prod --store-dir=/pnpm-store

COPY --from=builder /build/packages/backend/dist ./dist
COPY --from=builder /build/packages/frontend/dist/frontend/browser ./public

# Not published by any Compose file in this repo — see docs/architecture.md#authentication.
# This EXPOSE is documentation for `docker inspect`/tooling, not a guarantee of reachability.
EXPOSE 3000

CMD ["node", "dist/server.js"]
