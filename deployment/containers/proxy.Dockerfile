FROM oven/bun:1.3.13 AS dependencies
WORKDIR /workspace
COPY package.json bun.lock turbo.json ./
COPY applications/engine/package.json applications/engine/package.json
COPY applications/proxy/package.json applications/proxy/package.json
COPY applications/web/package.json applications/web/package.json
COPY runner/package.json runner/package.json
COPY packages packages
COPY scripts/package.json scripts/package.json
COPY scripts/install-git-hooks.ts scripts/install-git-hooks.ts
RUN bun install --frozen-lockfile

FROM dependencies AS build
COPY . .
RUN bun run --cwd applications/proxy build

FROM oven/bun:1.3.13 AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3002
COPY --from=build /workspace/applications/proxy/dist ./dist
COPY --from=build /workspace/applications/proxy/package.json ./package.json
EXPOSE 3002
CMD ["bun", "dist/index.js"]
