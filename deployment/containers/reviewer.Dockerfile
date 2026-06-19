FROM oven/bun:1.3.13

WORKDIR /reviewer
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
RUN bun install --production --filter @tribunal/runner
COPY packages/agents ./packages/agents
COPY packages/review-core ./packages/review-core
COPY runner ./runner
CMD ["node", "runner/verify-image.mjs"]
