FROM oven/bun:1.3.13

WORKDIR /reviewer
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git openssh-client \
  && printf '#!/bin/sh\nif [ "$1" = "--version" ] || [ "$1" = "-v" ]; then\n  printf "v%%s\\n" "$(/usr/local/bin/bun --version)"\n  exit 0\nfi\nexec /usr/local/bin/bun "$@"\n' > /usr/local/bin/node \
  && chmod +x /usr/local/bin/node \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV TRIBUNAL_RUNNER_MODE=sandbox
COPY runner/package.json ./runner/package.json
RUN cd runner && bun install --production
COPY runner ./runner
CMD ["node", "runner/verify-image.mjs"]
