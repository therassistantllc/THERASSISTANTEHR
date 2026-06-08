# File: Dockerfile
FROM node:24-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1

RUN corepack enable
RUN corepack prepare pnpm@10.32.1 --activate

WORKDIR /workspace

FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY artifacts/therassistant-ehr ./artifacts/therassistant-ehr
COPY tsconfig.base.json tsconfig.json replit.md ./

RUN pnpm config set ignore-scripts false \
 && pnpm config set onlyBuiltDependencies sharp \
 && pnpm install --frozen-lockfile --filter @workspace/therassistant-ehr...

FROM deps AS build

WORKDIR /workspace

ENV NODE_ENV=production
ENV NODE_OPTIONS=--max-old-space-size=4096
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PRIVATE_BUILD_WORKER=1

RUN pnpm --filter @workspace/therassistant-ehr... run build:ci

FROM node:24-slim AS runner

ENV NODE_ENV=production
ENV PORT=8080
ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs --create-home appuser

# Copy the standalone output
COPY --from=build --chown=1001:1001 /workspace/artifacts/therassistant-ehr/.next/standalone ./
COPY --from=build --chown=1001:1001 /workspace/artifacts/therassistant-ehr/.next/static ./artifacts/therassistant-ehr/.next/static
COPY --from=build --chown=1001:1001 /workspace/artifacts/therassistant-ehr/public ./artifacts/therassistant-ehr/public

USER 1001:1001

EXPOSE 8080

# The standalone server.js is located within the workspace subfolder
CMD ["node", "artifacts/therassistant-ehr/server.js"]
