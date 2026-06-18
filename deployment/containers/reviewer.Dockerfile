FROM oven/bun:1.3.13

WORKDIR /reviewer
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git openssh-client \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV TRIBUNAL_RUNNER_MODE=sandbox
COPY runner ./runner
CMD ["node", "runner/verify-image.mjs"]
