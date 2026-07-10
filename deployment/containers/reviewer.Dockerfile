FROM oven/bun:1.3.13 AS build

WORKDIR /workspace
COPY package.json bun.lock ./
COPY applications/engine/package.json ./applications/engine/package.json
COPY applications/proxy/package.json ./applications/proxy/package.json
COPY applications/web/package.json ./applications/web/package.json
COPY runner/package.json ./runner/package.json
COPY packages ./packages
COPY scripts/package.json ./scripts/package.json
COPY scripts/install-git-hooks.ts ./scripts/install-git-hooks.ts
# Filtered install: this stage only builds @tribunal/review-core and
# @tribunal/agents. Installing the full workspace (web/engine dev graphs)
# exceeds the 1024 MB RAM cap of the Tensorlake builder sandbox that
# rebuilds this Dockerfile at publish time.
RUN bun install --frozen-lockfile --filter tribunal --filter @tribunal/review-core --filter @tribunal/agents
RUN bun run --cwd packages/review-core build
RUN bun run --cwd packages/agents build

FROM oven/bun:1.3.13

WORKDIR /workspace
ARG PROXY_CA_CERT=""
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git openssh-client \
  && if [ -n "$PROXY_CA_CERT" ]; then printf '%s\n' "$PROXY_CA_CERT" > /usr/local/share/ca-certificates/tribunal-proxy-ca.crt && update-ca-certificates; fi \
  && printf '#!/bin/sh\nif [ "$1" = "--version" ] || [ "$1" = "-v" ]; then\n  printf "v%%s\\n" "$(/usr/local/bin/bun --version)"\n  exit 0\nfi\nexec /usr/local/bin/bun "$@"\n' > /usr/local/bin/node \
  && chmod +x /usr/local/bin/node \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV TRIBUNAL_RUNNER_MODE=sandbox
COPY package.json bun.lock ./
COPY applications/engine/package.json ./applications/engine/package.json
COPY applications/proxy/package.json ./applications/proxy/package.json
COPY applications/web/package.json ./applications/web/package.json
COPY runner/package.json ./runner/package.json
COPY packages/agents/package.json ./packages/agents/package.json
COPY packages/cost/package.json ./packages/cost/package.json
COPY packages/database/package.json ./packages/database/package.json
COPY packages/github/package.json ./packages/github/package.json
COPY packages/review-core/package.json ./packages/review-core/package.json
COPY packages/sandbox/package.json ./packages/sandbox/package.json
COPY packages/test/package.json ./packages/test/package.json
COPY packages/typescript/package.json ./packages/typescript/package.json
COPY scripts/package.json ./scripts/package.json
RUN bun install --production --frozen-lockfile --filter @tribunal/runner
COPY --from=build /workspace/packages/agents/dist ./packages/agents/dist
COPY --from=build /workspace/packages/review-core/dist ./packages/review-core/dist
COPY runner ./runner
CMD ["bun", "runner/verify-image.mjs"]
