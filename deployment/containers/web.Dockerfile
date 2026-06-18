FROM oven/bun:1.3.2 AS dependencies
WORKDIR /workspace
COPY package.json bun.lock turbo.json ./
COPY applications/web/package.json applications/web/package.json
COPY packages packages
COPY scripts/package.json scripts/package.json
RUN bun install --frozen-lockfile

FROM dependencies AS build
COPY . .
ENV DATABASE_URL=postgres://placeholder:placeholder@localhost:5432/placeholder
RUN bun run --cwd applications/web build

FROM oven/bun:1.3.2 AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=build /workspace/applications/web/build ./build
COPY --from=build /workspace/applications/web/package.json ./package.json
EXPOSE 3000
CMD ["bun", "build/index.js"]
