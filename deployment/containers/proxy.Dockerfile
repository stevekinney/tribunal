FROM oven/bun:1.3.2 AS dependencies
WORKDIR /workspace
COPY package.json bun.lock turbo.json ./
COPY applications/proxy/package.json applications/proxy/package.json
COPY packages packages
COPY scripts/package.json scripts/package.json
RUN bun install --frozen-lockfile

FROM dependencies AS build
COPY . .
RUN bun run --cwd applications/proxy build

FROM oven/bun:1.3.2 AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3002
COPY --from=build /workspace/applications/proxy/dist ./dist
COPY --from=build /workspace/applications/proxy/package.json ./package.json
EXPOSE 3002
CMD ["bun", "dist/index.js"]
