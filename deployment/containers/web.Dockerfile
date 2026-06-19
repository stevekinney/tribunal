FROM oven/bun:1.3.13 AS dependencies
WORKDIR /workspace
COPY package.json bun.lock turbo.json ./
COPY applications/engine/package.json applications/engine/package.json
COPY applications/proxy/package.json applications/proxy/package.json
COPY applications/web/package.json applications/web/package.json
COPY runner/package.json runner/package.json
COPY packages packages
COPY runner/package.json runner/package.json
COPY scripts/package.json scripts/package.json
COPY scripts/install-git-hooks.ts scripts/install-git-hooks.ts
RUN bun install --frozen-lockfile

FROM dependencies AS build
COPY . .
ENV DATABASE_URL=postgres://placeholder:placeholder@localhost:5432/placeholder
RUN bun run --cwd applications/web build

FROM oven/bun:1.3.13 AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=build /workspace/applications/web/build ./build
COPY --from=build /workspace/applications/web/package.json ./package.json
COPY --from=dependencies /workspace/node_modules ./node_modules
EXPOSE 3000
CMD ["bun", "build/index.js"]
