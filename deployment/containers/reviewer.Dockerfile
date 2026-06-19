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
COPY package.json bun.lock turbo.json ./
COPY applications/engine/package.json applications/engine/package.json
COPY applications/proxy/package.json applications/proxy/package.json
COPY applications/web/package.json applications/web/package.json
COPY packages packages
COPY runner/package.json runner/package.json
COPY scripts/package.json scripts/package.json
COPY scripts/install-git-hooks.ts scripts/install-git-hooks.ts
RUN bun install --frozen-lockfile --production
COPY runner ./runner
CMD ["bun", "runner/verify-image.mjs"]
