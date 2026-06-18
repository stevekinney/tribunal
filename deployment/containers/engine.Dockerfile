FROM oven/bun:1.3.2 AS dependencies
WORKDIR /workspace
COPY package.json bun.lock turbo.json ./
COPY applications/engine/package.json applications/engine/package.json
COPY packages packages
COPY scripts/package.json scripts/package.json
RUN bun install --frozen-lockfile

FROM dependencies AS build
COPY . .
RUN bun run --cwd applications/engine build

FROM oven/bun:1.3.2 AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
COPY --from=build /workspace/applications/engine/dist ./dist
COPY --from=build /workspace/applications/engine/package.json ./package.json
EXPOSE 3001
CMD ["bun", "dist/index.js"]
